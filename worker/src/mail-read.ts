// =============================================================================
// Mail reads: the folder list, one message, and the ETag used for 304s.
//
// Every query filters on `username` from the VERIFIED session, so one user can
// never see another user's rows.
//
// Listing also carries the server-side search the native clients need:
//
//   folder     inbox | starred | sent | drafts | trash | all
//              `all` = inbox + sent + drafts (never Trash), and it is what you
//              get when `q` or a filter is present and no folder was named.
//   q          1..200 chars, case-insensitive over subject, from, to, snippet
//   unread     1/true   -> is_read = 0
//   starred    1/true   -> is_starred = 1
//   hasAttachment 1/true -> attachments is not the empty list
//   limit, before      unchanged (1..100, ISO cursor)
//
// Filters combine with AND, and every one of them is applied inside the same
// `to_username = ?` scope, so search can never reach into another mailbox.
// =============================================================================

import { type Db, type DbParam } from './db';
import { HttpError } from './http';
import { type Folder, type MailRow, type MessageDto, parseFolder, toDto, toDetailDto, LIST_COLUMNS, DETAIL_COLUMNS } from './mail-types';

// ---------------------------------------------------------------------------
// Query parsing
// ---------------------------------------------------------------------------

/** `all` is a view, not a stored folder: it spans inbox + sent + drafts. */
export type ListFolder = Folder | 'all';

export interface ListOptions {
  folder: ListFolder;
  limit: number;
  before: string | null;
  /** Trimmed search text, or null when this is a plain folder listing. */
  q: string | null;
  unread: boolean;
  starred: boolean;
  hasAttachment: boolean;
}

export const MAX_QUERY_CHARS = 200;

/** `1`/`true` = on, `0`/`false`/absent = off, anything else is a client bug. */
function parseFlag(raw: string | null, name: string): boolean {
  if (raw === null || raw === '') return false;
  const value = raw.trim().toLowerCase();
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  throw new HttpError(400, 'bad_filter', `${name} must be 1, true, 0 or false.`);
}

function parseQuery(raw: string | null): string | null {
  if (raw === null) return null;
  const q = raw.trim();
  if (q === '') return null;
  if (q.length > MAX_QUERY_CHARS) {
    throw new HttpError(400, 'bad_query', `q must be at most ${MAX_QUERY_CHARS} characters.`);
  }
  return q;
}

export function parseListOptions(url: URL): ListOptions {
  const params = url.searchParams;
  const q = parseQuery(params.get('q'));
  const unread = parseFlag(params.get('unread'), 'unread');
  const starred = parseFlag(params.get('starred'), 'starred');
  const hasAttachment = parseFlag(params.get('hasAttachment'), 'hasAttachment');

  const rawFolder = (params.get('folder') ?? '').trim();
  // No folder + a search/filter means "search everywhere I can see", which is
  // what the Android search screen expects. No folder and no filter keeps the
  // historical default (inbox), so the web client is unaffected.
  const folder: ListFolder =
    rawFolder === 'all'
      ? 'all'
      : rawFolder !== ''
        ? parseFolder(rawFolder)
        : q || unread || starred || hasAttachment
          ? 'all'
          : 'inbox';

  const rawLimit = Number.parseInt(params.get('limit') || '50', 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50;
  const before = params.get('before');
  if (before !== null && Number.isNaN(Date.parse(before))) {
    throw new HttpError(400, 'bad_before', 'before must be an ISO date.');
  }
  return { folder, limit, before, q, unread, starred, hasAttachment };
}

/**
 * `%` and `_` are LIKE wildcards, so user text must be escaped before it is
 * turned into a pattern. Otherwise `q=100%` would match every message.
 */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

// ---------------------------------------------------------------------------
// Scoped queries
// ---------------------------------------------------------------------------

export async function listMessages(db: Db, username: string, opts: ListOptions): Promise<MessageDto[]> {
  const params: DbParam[] = [username];
  let sql = `SELECT ${LIST_COLUMNS} FROM mail_messages WHERE to_username = ?`;

  if (opts.folder === 'starred') {
    // Starred view is the "important" mix, not Trash.
    sql += ` AND is_starred = 1 AND folder IN ('inbox', 'sent')`;
  } else if (opts.folder === 'all') {
    sql += ` AND folder IN ('inbox', 'sent', 'drafts')`;
  } else {
    sql += ' AND folder = ?';
    params.push(opts.folder);
  }

  if (opts.q) {
    const pattern = likePattern(opts.q);
    // One backslash as the ESCAPE character: SQLite string literals do not use
    // backslash escapes, so "ESCAPE '\'" is a single character to it.
    const likes = ["subject", "from_email", "from_name", "to_email", "snippet"]
      .map((column) => `${column} LIKE ? ESCAPE '\\'`)
      .join(" OR ");
    sql += ` AND (${likes})`;
    params.push(pattern, pattern, pattern, pattern, pattern);
  }
  if (opts.unread) sql += ' AND is_read = 0';
  if (opts.starred) sql += ' AND is_starred = 1';
  if (opts.hasAttachment) sql += " AND attachments != '[]' AND attachments != ''";

  if (opts.before) {
    sql += ' AND received_at < ?';
    params.push(new Date(opts.before).toISOString());
  }
  sql += ' ORDER BY received_at DESC LIMIT ?';
  params.push(opts.limit);

  const rows = await db.all<MailRow>(sql, ...params);
  return rows.map(toDto);
}

/** The raw row, without decompressing the body. */
export async function getMessageRow(db: Db, username: string, id: string): Promise<MailRow> {
  const row = await db.first<MailRow>(
    `SELECT ${DETAIL_COLUMNS} FROM mail_messages WHERE id = ? AND to_username = ? LIMIT 1`,
    id,
    username
  );
  if (!row) throw new HttpError(404, 'not_found', 'Message not found.');
  return row;
}

/**
 * Validator for conditional requests. WHY: opening an already-seen mail should
 * not cost Cloudflare a gzip decompression. The tag is built from cheap columns
 * (never the body), so a client that sends If-None-Match can get a 304 and the
 * Worker stops before decompressing anything.
 */
export function messageEtag(row: MailRow): string {
  return `"m-${row.id}-${row.is_read}-${row.is_starred}-${row.size_bytes}-${row.received_at}"`;
}

export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch
    .split(',')
    .map((part) => part.trim().replace(/^W\//, ''))
    .some((part) => part === '*' || part === etag);
}

export async function getMessage(db: Db, username: string, id: string): Promise<MessageDto> {
  return toDetailDto(await getMessageRow(db, username, id));
}
