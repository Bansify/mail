// =============================================================================
// Bulk mailbox actions: the batch endpoint and "Empty Trash".
//
// A phone selects twenty messages and then swipes, stars or deletes them. Doing
// that one request at a time is slow on mobile data, so both operations here
// work on a list of ids in ONE statement.
//
// Isolation rule (the same one every other query follows): `username` comes
// from the verified session and is the first condition of the WHERE clause, so a
// batch can never touch a row that belongs to somebody else — not even if the
// caller sends a valid id from another mailbox. Nothing is reported back about
// ids that were not theirs; the response only carries a count.
// =============================================================================

import type { Db, DbParam } from './db';
import { HttpError } from './http';
import { parseId } from './mail-types';

/** A phone never selects more than a screenful; this keeps one query bounded. */
export const MAX_BATCH_IDS = 100;

export interface BatchInput {
  ids: string[];
  isRead?: boolean;
  isStarred?: boolean;
  moveToTrash?: boolean;
  moveToArchive?: boolean;
  moveToInbox?: boolean;
  deleteFromTrash?: boolean;
}

const BATCH_FIELDS = ['ids', 'isRead', 'isStarred', 'moveToTrash', 'moveToArchive', 'moveToInbox', 'deleteFromTrash'];

function readBoolean(b: Record<string, unknown>, key: keyof BatchInput): boolean | undefined {
  const value = b[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new HttpError(400, 'bad_field', `${key} must be boolean.`);
  return value;
}

/** Validates the body once, so both the SQL and the errors stay predictable. */
export function parseBatch(body: unknown): BatchInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'bad_body', 'Body must be an object.');
  }
  const b = body as Record<string, unknown>;
  for (const key of Object.keys(b)) {
    if (!BATCH_FIELDS.includes(key)) {
      throw new HttpError(400, 'bad_field', `Field "${key}" cannot be changed.`);
    }
  }

  if (!Array.isArray(b.ids)) throw new HttpError(400, 'bad_ids', 'ids must be a list of message ids.');
  if (b.ids.length === 0) throw new HttpError(400, 'bad_ids', 'Select at least one message.');
  if (b.ids.length > MAX_BATCH_IDS) {
    throw new HttpError(400, 'bad_ids', `Select at most ${MAX_BATCH_IDS} messages at a time.`);
  }
  const ids: string[] = [];
  for (const raw of b.ids) {
    if (typeof raw !== 'string') throw new HttpError(400, 'bad_ids', 'ids must be strings.');
    const id = parseId(raw.trim());
    // A phone can send the same id twice; one UPDATE row per id is enough.
    if (!ids.includes(id)) ids.push(id);
  }

  const isRead = readBoolean(b, 'isRead');
  const isStarred = readBoolean(b, 'isStarred');
  const moveToTrash = readBoolean(b, 'moveToTrash');
  const moveToArchive = readBoolean(b, 'moveToArchive');
  const moveToInbox = readBoolean(b, 'moveToInbox');
  const deleteFromTrash = readBoolean(b, 'deleteFromTrash');

  if (moveToTrash && moveToInbox) {
    throw new HttpError(400, 'bad_field', 'A batch cannot move to Trash and the Inbox at once.');
  }
  if (deleteFromTrash) {
    const others = [isRead, isStarred, moveToTrash, moveToInbox].some((v) => v !== undefined && v !== false);
    if (others) {
      throw new HttpError(400, 'bad_field', 'deleteFromTrash cannot be combined with other actions.');
    }
  } else if (isRead === undefined && isStarred === undefined && !moveToTrash && !moveToArchive && !moveToInbox) {
    throw new HttpError(400, 'empty_patch', 'Nothing to change.');
  }

  const out: BatchInput = { ids };
  if (isRead !== undefined) out.isRead = isRead;
  if (isStarred !== undefined) out.isStarred = isStarred;
  if (moveToTrash !== undefined) out.moveToTrash = moveToTrash;
  if (moveToArchive !== undefined) out.moveToArchive = moveToArchive;
  if (moveToInbox !== undefined) out.moveToInbox = moveToInbox;
  if (deleteFromTrash !== undefined) out.deleteFromTrash = deleteFromTrash;
  return out;
}

export interface BatchResult {
  ok: true;
  updated: number;
}

/**
 * Applies one action to every selected message this user owns.
 *
 * `updated` counts real row changes. Permanent delete is limited to messages
 * already in Trash, exactly like the single-message DELETE route, so a batch can
 * never destroy Inbox mail by accident.
 */
export async function batchMessages(db: Db, username: string, input: BatchInput): Promise<BatchResult> {
  const placeholders = input.ids.map(() => '?').join(', ');

  if (input.deleteFromTrash) {
    const deleted = await db.runCount(
      `DELETE FROM mail_messages WHERE to_username = ? AND folder = 'trash' AND id IN (${placeholders})`,
      username,
      ...input.ids
    );
    return { ok: true, updated: deleted };
  }

  const sets: string[] = [];
  const params: DbParam[] = [];
  if (input.isRead !== undefined) {
    sets.push('is_read = ?');
    params.push(input.isRead ? 1 : 0);
  }
  if (input.isStarred !== undefined) {
    sets.push('is_starred = ?');
    params.push(input.isStarred ? 1 : 0);
  }
  if (input.moveToTrash) sets.push("folder = 'trash'");
  if (input.moveToArchive) sets.push("folder = 'archive'");
  if (input.moveToInbox) sets.push("folder = 'inbox'");

  const updated = await db.runCount(
    `UPDATE mail_messages SET ${sets.join(', ')} WHERE to_username = ? AND id IN (${placeholders})`,
    ...params,
    username,
    ...input.ids
  );
  return { ok: true, updated };
}

/** Empties this user's Trash. Other mailboxes (and other users) are untouched. */
export async function emptyTrash(db: Db, username: string): Promise<{ ok: true; deleted: number }> {
  const deleted = await db.runCount(
    "DELETE FROM mail_messages WHERE to_username = ? AND folder = 'trash'",
    username
  );
  return { ok: true, deleted };
}
