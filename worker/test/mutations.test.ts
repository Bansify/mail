// PATCH and DELETE: ownership, CSRF and trash rules.
//
// Split out of worker.test.ts so no test file grows past a few hundred
// lines; the harness in helpers.ts is shared. Run: npm run test:worker

import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { handleRequest } from '../src/index.ts';
import { textToHtml, cleanRecipients } from '../src/mail.ts';
import { localPartForDomain } from '../src/inbound.ts';
import { Db } from '../src/db.ts';
import {
  h,
  MAIL_ORIGIN,
  req,
  authed,
  writeInit,
  seedMessage,
  countRows,
  fullStub,
  accountsStub,
  accountsMeStub,
  hubOnlyStub,
  sessionResponse,
  inboundMessage,
  makeEnv,
  ACCOUNTS_TOKEN,
  RESEND_KEY,
  parsePatch,
  type Seen,
  type Stub,
  type Env,
} from './helpers.ts';

// ---------------------------------------------------------------------------
// PATCH / DELETE
// ---------------------------------------------------------------------------

test('PATCH is refused from an unknown origin (CSRF guard)', async () => {
  h.stub = fullStub;
  const id = await seedMessage();
  const res = await worker.fetch(
    req(`/api/mail/messages/${id}`, {
      method: 'PATCH',
      cookie: 'gothwad_at=good',
      origin: 'https://evil.example',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isStarred: true }),
    }),
    h.env
  );
  assert.equal(res.status, 403);
  const row = await (await Db.from(h.env)).first<{ is_starred: number }>(
    'SELECT is_starred FROM mail_messages WHERE id = ?',
    id
  );
  assert.equal(row?.is_starred, 0, 'the write was refused');
});

test('PATCH needs JSON content-type even from our own origin', async () => {
  h.stub = fullStub;
  const id = await seedMessage();
  const res = await worker.fetch(
    req(`/api/mail/messages/${id}`, {
      method: 'PATCH',
      cookie: 'gothwad_at=good',
      origin: MAIL_ORIGIN,
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ isStarred: true }),
    }),
    h.env
  );
  assert.equal(res.status, 415);
});

test('PATCH updates only the session user’s row', async () => {
  h.stub = fullStub;
  const id = await seedMessage();
  const bobId = await seedMessage({ username: 'bob' });

  const res = await worker.fetch(authed(`/api/mail/messages/${id}`, writeInit('PATCH', { isStarred: true, isRead: true })), h.env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.message.isStarred, true);
  assert.equal(body.message.isRead, true);

  const row = await (await Db.from(h.env)).first<{ is_starred: number; is_read: number }>(
    'SELECT is_starred, is_read FROM mail_messages WHERE id = ?',
    id
  );
  assert.deepEqual({ ...row }, { is_starred: 1, is_read: 1 });

  const other = await worker.fetch(authed(`/api/mail/messages/${bobId}`, writeInit('PATCH', { isStarred: true })), h.env);
  assert.equal(other.status, 404);
});

test('moveToTrash moves the row into the Trash folder', async () => {
  h.stub = fullStub;
  const id = await seedMessage();
  const res = await worker.fetch(authed(`/api/mail/messages/${id}`, writeInit('PATCH', { moveToTrash: true })), h.env);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).message.folder, 'trash');
});

test('DELETE is only allowed for items already in Trash', async () => {
  h.stub = fullStub;
  const inboxId = await seedMessage();
  const trashId = await seedMessage({ folder: 'trash' });

  const refused = await worker.fetch(authed(`/api/mail/messages/${inboxId}`, writeInit('DELETE', {})), h.env);
  assert.equal(refused.status, 404);
  assert.equal(await countRows('id = ?', inboxId), 1, 'inbox mail is not deleted');

  const ok = await worker.fetch(authed(`/api/mail/messages/${trashId}`, writeInit('DELETE', {})), h.env);
  assert.equal(ok.status, 200);
  assert.equal(await countRows('id = ?', trashId), 0);
});

test('PATCH rejects fields the client may not change', () => {
  assert.throws(() => parsePatch({ to_username: 'bob' }), /cannot be changed/);
  assert.throws(() => parsePatch({ moveToTrash: false }), /moveToTrash/);
  assert.throws(() => parsePatch({}), /Nothing to change/);
  // `folder` is the same intent in one field, for the three real targets only.
  assert.deepEqual(parsePatch({ folder: 'inbox' }), { moveToInbox: true });
  assert.deepEqual(parsePatch({ folder: 'trash' }), { moveToTrash: true });
  assert.deepEqual(parsePatch({ folder: 'archive' }), { moveToArchive: true });
  assert.throws(() => parsePatch({ folder: 'sent' }), /inbox.*archive.*trash/);
  // Two targets at once is ambiguous, never silently one of them.
  assert.throws(() => parsePatch({ moveToTrash: true, moveToInbox: true }), /one folder/);
});

test('archive: the Archive button really moves the row out of the Inbox', async () => {
  h.stub = fullStub;
  const id = await seedMessage({ folder: 'inbox', subject: 'Keepsake' });

  // This is exactly what the web client sends when the user taps Archive.
  const res = await worker.fetch(authed(`/api/mail/messages/${id}`, writeInit('PATCH', { moveToArchive: true })), h.env);
  assert.equal(res.status, 200, 'moveToArchive is an accepted PATCH field');
  assert.equal((await res.json()).message.folder, 'archive', 'the answer carries the new folder');

  const listed = await worker.fetch(authed('/api/mail/messages?folder=archive'), h.env);
  const body = await listed.json();
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].subject, 'Keepsake');

  const inbox = await worker.fetch(authed('/api/mail/messages?folder=inbox'), h.env);
  assert.equal((await inbox.json()).messages.length, 0, 'it left the Inbox');

  // And `folder: "archive"` is the same thing in one field.
  const back = await worker.fetch(authed(`/api/mail/messages/${id}`, writeInit('PATCH', { folder: 'inbox' })), h.env);
  assert.equal(back.status, 200);
  const archived = await worker.fetch(authed(`/api/mail/messages/${id}`, writeInit('PATCH', { folder: 'archive' })), h.env);
  assert.equal((await archived.json()).message.folder, 'archive');
});
