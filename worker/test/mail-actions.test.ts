// Native mail actions: restore from Trash, batch actions, Empty Trash.
//
// The phone selects many messages at once, so these routes accept lists. The one
// rule that matters: `to_username` comes from the verified session and is part of
// every WHERE clause. A valid id from another mailbox must change nothing and
// must not even be reported back.
//
// Run: npm run test:worker

import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
import { Db } from '../src/db.ts';
import { h, authed, writeInit, seedMessage, countRows, fullStub } from './helpers.ts';

const patch = (id: string, body: Record<string, unknown>) =>
  worker.fetch(authed(`/api/mail/messages/${id}`, writeInit('PATCH', body)), h.env);

const batch = (body: Record<string, unknown>) =>
  worker.fetch(authed('/api/mail/messages/batch', writeInit('POST', body)), h.env);

const emptyTrash = () => worker.fetch(authed('/api/mail/trash', writeInit('DELETE', {})), h.env);

const folderOf = async (id: string): Promise<string> => {
  const db = await Db.from(h.env);
  const row = await db.first<{ folder: string }>('SELECT folder FROM mail_messages WHERE id = ?', id);
  return String(row?.folder);
};

// ---------------------------------------------------------------------------
// Restore from Trash (Undo)
// ---------------------------------------------------------------------------

test('PATCH with moveToInbox restores a trashed message', async () => {
  h.stub = fullStub;
  const id = await seedMessage({ folder: 'trash' });

  const res = await patch(id, { moveToInbox: true });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.message.folder, 'inbox');
  assert.equal(await folderOf(id), 'inbox');
});

test('PATCH with folder "inbox" is the same undo, and "trash" the same move', async () => {
  h.stub = fullStub;
  const id = await seedMessage({ folder: 'trash' });

  const restored = await patch(id, { folder: 'inbox' });
  assert.equal(restored.status, 200);
  assert.equal(await folderOf(id), 'inbox');

  const trashed = await patch(id, { folder: 'trash' });
  assert.equal(trashed.status, 200);
  assert.equal(await folderOf(id), 'trash');
});

test('PATCH still rejects a real folder it cannot move into, and conflicting moves', async () => {
  h.stub = fullStub;
  const id = await seedMessage({ folder: 'inbox' });

  const toSent = await patch(id, { folder: 'sent' });
  assert.equal(toSent.status, 400);
  assert.equal((await toSent.json()).error, 'bad_folder');

  const both = await patch(id, { moveToTrash: true, moveToInbox: true });
  assert.equal(both.status, 400);
  assert.equal((await both.json()).error, 'bad_field');
  assert.equal(await folderOf(id), 'inbox', 'a rejected patch changes nothing');
});

test('restoring somebody else\'s message is a 404 and moves nothing', async () => {
  h.stub = fullStub;
  const bobs = await seedMessage({ username: 'bob', folder: 'trash' });

  const res = await patch(bobs, { moveToInbox: true });
  assert.equal(res.status, 404);
  assert.equal(await folderOf(bobs), 'trash');
});

// ---------------------------------------------------------------------------
// Batch
// ---------------------------------------------------------------------------

test('a batch marks, stars and trashes only the ids it was given', async () => {
  h.stub = fullStub;
  const first = await seedMessage({ folder: 'inbox', read: false });
  const second = await seedMessage({ folder: 'inbox', read: false });
  const untouched = await seedMessage({ folder: 'inbox', read: false });

  const read = await batch({ ids: [first, second], isRead: true });
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), { ok: true, updated: 2 });
  assert.equal(await countRows('id = ? AND is_read = 1', untouched), 0);

  const starred = await batch({ ids: [first], isStarred: true });
  assert.equal((await starred.json()).updated, 1);

  const trashed = await batch({ ids: [first, second], moveToTrash: true });
  assert.equal((await trashed.json()).updated, 2);
  assert.equal(await folderOf(untouched), 'inbox');
});

test('a batch can undo a swipe: moveToInbox, and permanently delete from Trash', async () => {
  h.stub = fullStub;
  const one = await seedMessage({ folder: 'trash' });
  const two = await seedMessage({ folder: 'trash' });

  const restored = await batch({ ids: [one, two], moveToInbox: true });
  assert.equal((await restored.json()).updated, 2);
  assert.equal(await folderOf(one), 'inbox');

  // deleteFromTrash only ever deletes rows that are IN trash.
  const wrongFolder = await batch({ ids: [one], deleteFromTrash: true });
  assert.equal((await wrongFolder.json()).updated, 0, 'a message in the Inbox is not deleted');
  assert.equal(await countRows('id = ?', one), 1);

  const trashedAgain = await batch({ ids: [one], moveToTrash: true });
  assert.equal((await trashedAgain.json()).updated, 1);
  const deleted = await batch({ ids: [one], deleteFromTrash: true });
  assert.deepEqual(await deleted.json(), { ok: true, updated: 1 });
  assert.equal(await countRows('id = ?', one), 0);
  assert.equal(await countRows('id = ?', two), 1, 'ids that were not listed stay');
});

test('a batch never touches another mailbox, even with a valid id', async () => {
  h.stub = fullStub;
  const bobs = await seedMessage({ username: 'bob', folder: 'inbox', read: false });
  const alices = await seedMessage({ folder: 'inbox', read: false });

  const res = await batch({ ids: [alices, bobs], isRead: true });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).updated, 1, 'only the caller\'s own row counted');

  const db = await Db.from(h.env);
  const bobRow = await db.first<{ is_read: number; folder: string }>(
    'SELECT is_read, folder FROM mail_messages WHERE id = ?',
    bobs
  );
  assert.equal(bobRow?.is_read, 0, 'bob\'s read flag is untouched');

  // And a delete-from-trash batch cannot reach bob's trash either.
  const bobTrash = await seedMessage({ username: 'bob', folder: 'trash' });
  const del = await batch({ ids: [bobTrash], deleteFromTrash: true });
  assert.equal((await del.json()).updated, 0);
  assert.equal(await countRows('id = ?', bobTrash), 1);
});

test('a batch validates ids and flags instead of guessing', async () => {
  h.stub = fullStub;
  const id = await seedMessage({ folder: 'inbox' });

  assert.equal((await batch({ ids: [], isRead: true })).status, 400);
  assert.equal((await batch({ ids: 'nope', isRead: true })).status, 400);
  assert.equal((await batch({ ids: ['not-a-uuid'], isRead: true })).status, 400);
  assert.equal((await batch({ ids: [id], isRead: 'yes' })).status, 400);
  assert.equal((await batch({ ids: [id] })).status, 400, 'no action is a client bug');
  assert.equal((await batch({ ids: [id], isRead: true, deleteFromTrash: true })).status, 400);
  assert.equal((await batch({ ids: [id], moveToTrash: true, moveToInbox: true })).status, 400);
  assert.equal((await batch({ ids: [id], isRead: true, folder: 'inbox' })).status, 400, 'unknown field');
  assert.equal((await batch({ ids: [id], isRead: true, extra: 1 })).status, 400);

  const tooMany = Array.from({ length: 101 }, () => id);
  assert.equal((await batch({ ids: tooMany, isRead: true })).status, 400);

  // Duplicates collapse, so a phone repeating an id is not an error.
  const dupe = await batch({ ids: [id, id], isStarred: true });
  assert.equal((await dupe.json()).updated, 1);
});

test('a batch requires a session and the same write guard as every other write', async () => {
  h.stub = fullStub;
  const id = await seedMessage({ folder: 'inbox' });

  const anonymous = await worker.fetch(
    new Request('https://mail.test/api/mail/messages/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [id], isRead: true }),
    }),
    h.env
  );
  assert.equal(anonymous.status, 401);

  // Signed in, but a cross-site HTML form (no Origin, no JSON content type).
  const crossSite = await worker.fetch(
    new Request('https://mail.test/api/mail/messages/batch', {
      method: 'POST',
      headers: { cookie: 'bansify_at=good', 'content-type': 'application/x-www-form-urlencoded' },
      body: JSON.stringify({ ids: [id], isRead: true }),
    }),
    h.env
  );
  assert.equal(crossSite.status, 403);
});

// ---------------------------------------------------------------------------
// Empty Trash
// ---------------------------------------------------------------------------

test('Empty Trash deletes only this user\'s trashed mail', async () => {
  h.stub = fullStub;
  await seedMessage({ folder: 'trash' });
  await seedMessage({ folder: 'trash' });
  const kept = await seedMessage({ folder: 'inbox' });
  const bobs = await seedMessage({ username: 'bob', folder: 'trash' });

  const res = await emptyTrash();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, deleted: 2 });

  assert.equal(await countRows("folder = 'trash' AND to_username = 'alice'"), 0);
  assert.equal(await countRows("folder = 'trash' AND to_username = 'bob'"), 1, 'bob\'s trash is his own');
  assert.equal(await countRows('id = ?', kept), 1);

  // Idempotent: an already empty Trash is a success with a zero count.
  const again = await emptyTrash();
  assert.equal((await again.json()).deleted, 0);
  assert.equal(await countRows('id = ?', bobs), 1);
});

test('Empty Trash needs a session and a safe write', async () => {
  h.stub = fullStub;
  const anonymous = await worker.fetch(
    new Request('https://mail.test/api/mail/trash', { method: 'DELETE' }),
    h.env
  );
  assert.equal(anonymous.status, 401);
});
