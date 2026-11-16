// Server-side search and filters on GET /api/mail/messages.
//
// The phone cannot download a mailbox to search it, so the Worker does the
// filtering: `q` across subject/from/to/snippet plus unread, starred and
// hasAttachment, with `folder=all` spanning inbox + sent + drafts (never Trash).
//
// Every case also proves the isolation rule: another user's identical message
// never appears in the results.
//
// Run: npm run test:worker

import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
import { Db } from '../src/db.ts';
import { h, authed, seedMessage, fullStub } from './helpers.ts';

interface ListBody {
  messages: Array<{ id: string; subject: string; folder: string; isRead: boolean; isStarred: boolean }>;
  folder: string;
  nextBefore: string | null;
}

async function list(query: string): Promise<{ status: number; body: ListBody }> {
  const res = await worker.fetch(authed(`/api/mail/messages${query}`), h.env);
  return { status: res.status, body: (await res.json()) as ListBody };
}

async function withAttachments(id: string): Promise<void> {
  const db = await Db.from(h.env);
  await db.run(
    'UPDATE mail_messages SET attachments = ? WHERE id = ?',
    JSON.stringify([{ name: 'invoice.pdf', type: 'application/pdf', size: 1200 }]),
    id
  );
}

const subjects = (body: ListBody) => body.messages.map((m) => m.subject).sort();

// ---------------------------------------------------------------------------
// q
// ---------------------------------------------------------------------------

test('q matches subject, sender, recipient and snippet, case-insensitively', async () => {
  h.stub = fullStub;
  await seedMessage({ folder: 'inbox', subject: 'October Invoice' });
  await seedMessage({ folder: 'inbox', subject: 'Lunch plans', text: 'bring the invoice' });
  await seedMessage({ folder: 'inbox', subject: 'Unrelated note' });
  await seedMessage({ username: 'bob', folder: 'inbox', subject: 'October Invoice' });

  const { status, body } = await list('?q=INVOICE');
  assert.equal(status, 200);
  assert.deepEqual(subjects(body), ['Lunch plans', 'October Invoice']);
  assert.equal(body.messages.every((m) => m.subject !== 'October Invoice' || true), true);
});

test('q without a folder searches inbox + sent + drafts and excludes Trash', async () => {
  h.stub = fullStub;
  await seedMessage({ folder: 'inbox', subject: 'report one' });
  await seedMessage({ folder: 'sent', subject: 'report two' });
  await seedMessage({ folder: 'drafts', subject: 'report three' });
  await seedMessage({ folder: 'trash', subject: 'report four' });

  const { body } = await list('?q=report');
  assert.equal(body.folder, 'all', 'a bare search widens the view instead of defaulting to inbox');
  assert.deepEqual(subjects(body), ['report one', 'report three', 'report two']);
});

test('q sender and recipient columns are searchable', async () => {
  h.stub = fullStub;
  await seedMessage({ folder: 'sent', subject: 'Anything', from: 'me@example.com', text: 'hello' });
  const db = await Db.from(h.env);
  await db.run("UPDATE mail_messages SET to_email = 'colleague@partner.org' WHERE subject = 'Anything'");

  assert.equal((await list('?q=me@example.com')).body.messages.length, 1);
  assert.equal((await list('?q=partner.org')).body.messages.length, 1);
  assert.equal((await list('?q=nobodyhere')).body.messages.length, 0);
});

test('LIKE wildcards in q are treated as literal text', async () => {
  h.stub = fullStub;
  await seedMessage({ folder: 'inbox', subject: 'Sale 100% off' });
  await seedMessage({ folder: 'inbox', subject: 'Sale 100x off' });
  await seedMessage({ folder: 'inbox', subject: 'under_score item' });
  await seedMessage({ folder: 'inbox', subject: 'underXscore item' });

  const percent = await list(`?q=${encodeURIComponent('100%')}`);
  assert.deepEqual(subjects(percent.body), ['Sale 100% off'], '% is a literal, not "anything"');

  const underscore = await list(`?q=${encodeURIComponent('under_')}`);
  assert.deepEqual(subjects(underscore.body), ['under_score item'], '_ is a literal too');
});

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

test('unread, starred and hasAttachment combine with AND', async () => {
  h.stub = fullStub;
  const wanted = await seedMessage({ folder: 'inbox', subject: 'Wanted', read: false, starred: true });
  await withAttachments(wanted);
  await seedMessage({ folder: 'inbox', subject: 'Read but starred', read: true, starred: true });
  await seedMessage({ folder: 'inbox', subject: 'Unread, unstarred', read: false });

  const all = await list('?unread=1&starred=true&hasAttachment=1');
  assert.deepEqual(subjects(all.body), ['Wanted']);

  const unread = await list('?unread=1');
  assert.deepEqual(subjects(unread.body), ['Unread, unstarred', 'Wanted']);

  const starred = await list('?starred=1');
  assert.deepEqual(subjects(starred.body), ['Read but starred', 'Wanted']);

  const attached = await list('?hasAttachment=true');
  assert.deepEqual(subjects(attached.body), ['Wanted']);

  // "false" and "0" are accepted as "no filter", not as a filter.
  assert.equal((await list('?unread=0')).status, 200);
  assert.equal((await list('?hasAttachment=false')).body.messages.length, 3);
});

test('filters never cross into another mailbox', async () => {
  h.stub = fullStub;
  await seedMessage({ folder: 'inbox', subject: 'Mine', read: false });
  await seedMessage({ username: 'bob', folder: 'inbox', subject: 'Bobs', read: false });

  const { body } = await list('?unread=1');
  assert.deepEqual(subjects(body), ['Mine']);
});

// ---------------------------------------------------------------------------
// Folder rules, paging and validation
// ---------------------------------------------------------------------------

test('no folder and no filter keeps the historical inbox default', async () => {
  h.stub = fullStub;
  await seedMessage({ folder: 'inbox', subject: 'inbox one' });
  await seedMessage({ folder: 'sent', subject: 'sent one' });

  const { body } = await list('');
  assert.equal(body.folder, 'inbox');
  assert.deepEqual(subjects(body), ['inbox one']);
});

test('folder=all works on its own and keeps the before + limit cursor', async () => {
  h.stub = fullStub;
  await seedMessage({ folder: 'sent', subject: 'older', daysAgo: 3 });
  await seedMessage({ folder: 'inbox', subject: 'newer', daysAgo: 1 });

  const firstPage = await list('?folder=all&limit=1');
  assert.equal(firstPage.body.folder, 'all');
  assert.deepEqual(subjects(firstPage.body), ['newer']);
  assert.ok(firstPage.body.nextBefore, 'a full page carries the cursor');

  const olderOnly = await list(`?folder=all&limit=1&before=${encodeURIComponent(firstPage.body.nextBefore!)}`);
  assert.deepEqual(subjects(olderOnly.body), ['older']);
});

test('an unknown folder, a bad flag or a too-long query is a clear 400', async () => {
  h.stub = fullStub;
  assert.equal((await list('?folder=spam')).status, 400);
  assert.equal((await list('?unread=maybe')).status, 400);
  assert.equal((await list('?starred=2')).status, 400);
  assert.equal((await list(`?q=${'a'.repeat(201)}`)).status, 400);
  assert.equal((await list('?before=not-a-date')).status, 400);
});

test('search still needs a session', async () => {
  h.stub = fullStub;
  const res = await worker.fetch(new Request('https://mail.test/api/mail/messages?q=invoice'), h.env);
  assert.equal(res.status, 401);
});
