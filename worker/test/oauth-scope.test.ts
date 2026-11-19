// OAuth Bearer requests: right app, right scope, right mailbox.
//
// The Android client signs in through Accounts and calls this Worker with an
// access token. A token is only usable here when Accounts issued it to
// `gothwad-mail` AND it carries the `mail` scope — otherwise a token minted for
// another Bansify app (Store, Tube) would open somebody's mailbox.
//
// The fixture body mirrors the live `/api/oauth/userinfo` response in
// Bansify/accounts (routes/oauth.ts + migration 0014).
//
// Run: npm run test:worker

import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
import { Db } from '../src/db.ts';
import {
  h,
  MAIL_TOKEN,
  authed,
  oauthUserInfo,
  req,
  seedMessage,
  fullStub,
  writeInit,
  makeEnv,
  type Stub,
} from './helpers.ts';

/** Only answers Accounts' userinfo, so every test says what it grants. */
function userinfoStub(body: Record<string, unknown>): Stub {
  return (s) => {
    if (s.url.pathname === '/api/oauth/userinfo') return Response.json(body);
    if (s.url.host === 'api.resend.com') return Response.json({ id: 're_bearer' });
    return new Response('x', { status: 599 });
  };
}

const bearer = (path: string, init: RequestInit = {}) =>
  req(path, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: MAIL_TOKEN } });

async function setAttachments(id: string, attachments: unknown[]): Promise<void> {
  const db = await Db.from(h.env);
  await db.run('UPDATE mail_messages SET attachments = ? WHERE id = ?', JSON.stringify(attachments), id);
}

// ---------------------------------------------------------------------------
// Accepted tokens
// ---------------------------------------------------------------------------

test('a gothwad-mail token with the mail scope reads the mailbox', async () => {
  h.stub = fullStub;
  await seedMessage({ folder: 'inbox', subject: 'Mobile hello' });

  const res = await worker.fetch(bearer('/api/mail/messages?folder=inbox'), h.env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].subject, 'Mobile hello');
  // The token never goes anywhere except Accounts.
  const upstream = h.seen.find((s) => s.url.pathname === '/api/oauth/userinfo');
  assert.equal(upstream?.headers.get('authorization'), MAIL_TOKEN);
});

test('the session payload for a bearer caller names one account and the real names', async () => {
  h.stub = fullStub;
  const res = await worker.fetch(bearer('/api/session'), h.env);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.user.username, 'alice');
  assert.equal(body.user.email, 'alice@bansify.com');
  assert.equal(body.user.firstName, 'Alice', 'given_name is preferred');
  assert.equal(body.user.lastName, 'Sharma', 'family_name is preferred');
  assert.equal(body.authuser, 0);
  assert.equal(body.accountUrl, 'https://accounts.test/me');
  assert.deepEqual(
    body.accounts.map((a: { id: string; authuser: number; username: string; lastUsedAt: unknown }) => [
      a.id,
      a.authuser,
      a.username,
      a.lastUsedAt,
    ]),
    [['bearer', 0, 'alice', null]]
  );
});

test('bearer metadata carries the unread count for the token owner only', async () => {
  h.stub = fullStub;
  await seedMessage({ folder: 'inbox', read: false });
  await seedMessage({ folder: 'inbox', read: false });
  // Another mailbox must not leak into the count.
  await seedMessage({ username: 'bob', folder: 'inbox', read: false });

  const session = await (await worker.fetch(bearer('/api/session'), h.env)).json();
  assert.deepEqual(session.unread, { alice: 2 });

  const meta = await (await worker.fetch(bearer('/api/session/meta'), h.env)).json();
  assert.deepEqual(meta.unread, { alice: 2 });
  assert.equal(meta.authuser, 0);
  assert.equal(typeof meta.limits.dailySendLimit, 'number');
});

test('a bearer caller can send, with no Cookie and no Origin header', async () => {
  h.stub = fullStub;
  const res = await worker.fetch(
    bearer('/api/mail/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: ['bob@example.com'], subject: 'From the phone', body: 'Hi' }),
    }),
    h.env
  );
  assert.equal(res.status, 201, 'a bearer request is not CSRF-able, so no Origin is required');
  const body = await res.json();
  assert.equal(body.sent, true);
  assert.equal(h.seen.filter((s) => s.url.host === 'api.resend.com').length, 1);
});

test('the legacy space-separated scope string is accepted too', async () => {
  h.stub = userinfoStub({ preferred_username: 'alice', client_id: 'gothwad-mail', scope: 'profile email mail' });
  const res = await worker.fetch(bearer('/api/mail/messages'), h.env);
  assert.equal(res.status, 200);
});

test('an audience-only body passes (client_id absent, aud names Mail)', async () => {
  h.stub = userinfoStub({ preferred_username: 'alice', aud: 'gothwad-mail', scopes: ['profile', 'mail'] });
  const res = await worker.fetch(bearer('/api/mail/messages'), h.env);
  assert.equal(res.status, 200);
});

// ---------------------------------------------------------------------------
// Rejected tokens
// ---------------------------------------------------------------------------

test('a token for another client is 403 insufficient_scope, not a signed-out bounce', async () => {
  h.stub = userinfoStub(oauthUserInfo({ client_id: 'kiwi-store', aud: 'kiwi-store' }));
  const res = await worker.fetch(bearer('/api/session'), h.env);
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, 'insufficient_scope');
  assert.equal(body.requiredClient, 'gothwad-mail');
  assert.equal(body.signinUrl, undefined, 'never a sign-in redirect for a valid foreign token');
});

test('a gothwad-mail token without the mail scope is refused', async () => {
  h.stub = userinfoStub(oauthUserInfo({ scopes: ['profile', 'email', 'offline_access'], scope: 'profile email offline_access' }));
  const res = await worker.fetch(bearer('/api/mail/messages'), h.env);
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, 'insufficient_scope');
  assert.equal(body.requiredScope, 'mail');
});

test('a token with no audience and no scopes is refused, and no mailbox is read', async () => {
  h.stub = userinfoStub({ preferred_username: 'alice' });
  const res = await worker.fetch(bearer('/api/mail/messages'), h.env);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'insufficient_scope');
  assert.equal(
    h.seen.some((s) => s.url.pathname.startsWith('/api/internal/')),
    false,
    'nothing beyond the userinfo check was called'
  );
});

test('a token Accounts rejects is still an ordinary 401 with the sign-in link', async () => {
  h.stub = (s) => {
    if (s.url.pathname === '/api/oauth/userinfo') return Response.json({ error: 'invalid_token' }, { status: 401 });
    return new Response('x', { status: 599 });
  };
  const res = await worker.fetch(bearer('/api/session'), h.env);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, 'unauthenticated');
  assert.equal(body.signinUrl, 'https://accounts.test/signin?choose=1');
  // A 401 must never be a 403: the client has to be able to refresh the token.
  assert.equal(body.requiredScope, undefined);
});

test('a broken Accounts answer for a bearer token stays a 503', async () => {
  h.stub = () => new Response('<html>nope</html>', { status: 200, headers: { 'content-type': 'text/html' } });
  const res = await worker.fetch(bearer('/api/session'), h.env);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'accounts_unexpected_response');
});

test('the web cookie path is untouched by the bearer rules', async () => {
  h.stub = fullStub;
  const res = await worker.fetch(authed('/api/mail/messages'), h.env);
  assert.equal(res.status, 200);
  assert.equal(h.seen.some((s) => s.url.pathname === '/api/oauth/userinfo'), false, 'cookie calls never touch userinfo');
});

test('a bearer session works on a development-shaped env too', async () => {
  h.stub = userinfoStub(oauthUserInfo());
  const dev = makeEnv({ ENVIRONMENT: 'development' });
  const res = await worker.fetch(bearer('/api/mail/messages', { headers: { 'content-type': 'application/json' } }), dev);
  assert.equal(res.status, 200);
});
