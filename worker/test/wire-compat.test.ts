// =============================================================================
// Wire compatibility with `Bansify/accounts`.
//
// Accounts issues the Gothwad names today: `gothwad_*` cookies, the
// `X-Gothwad-Authuser` selector header, and OAuth tokens minted for the
// `gothwad-mail` client. A rename on either side must never break the other, so
// these tests pin the dual behaviour down:
//
//   1. rotated `gothwad_*` cookies are forwarded to the browser (the live case),
//   2. rotated `bansify_*` cookies are forwarded too (the future case),
//   3. anything else from upstream is never forwarded,
//   4. either authuser header spelling is accepted on the way in,
//   5. both spellings are sent upstream, so Accounts can rename first,
//   6. a Bearer token for either client id is accepted, a foreign one is not.
//
// Run: npm run test:worker
// =============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
import { h, authed, oauthUserInfo, req, type Stub } from './helpers.ts';

const BEARER = { authorization: 'Bearer goodtoken' };

/** Accounts' `/auth/me` answer, optionally rotating cookies back to us. */
function meStub(setCookies: string[] = []): Stub {
  return (s) => {
    if (s.url.pathname === '/api/auth/me') {
      const res = Response.json({
        authenticated: true,
        user: { username: 'alice', first_name: 'Alice', last_name: 'Sharma' },
      });
      for (const cookie of setCookies) res.headers.append('set-cookie', cookie);
      return res;
    }
    return new Response('x', { status: 599 });
  };
}

/** Accounts' `/oauth/userinfo` answer for one token. */
function userinfoStub(body: Record<string, unknown>): Stub {
  return (s) =>
    s.url.pathname === '/api/oauth/userinfo' ? Response.json(body) : new Response('x', { status: 599 });
}

const session = (init: Parameters<typeof req>[1] = {}) =>
  worker.fetch(req('/api/session?meta=0', init), h.env);

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

test('rotated gothwad_* cookies from Accounts reach the browser', async () => {
  h.stub = meStub(['gothwad_sess_a=rotated; Path=/', 'gothwad_active=a; Path=/']);
  const res = await session({ cookie: 'gothwad_at=good' });
  assert.equal(res.status, 200);
  const cookies = res.headers.getSetCookie();
  assert.ok(cookies.some((c) => c.startsWith('gothwad_sess_a=rotated')));
  assert.ok(cookies.some((c) => c.startsWith('gothwad_active=a')));
});

test('rotated bansify_* cookies are forwarded too, so a rename cannot sign anyone out', async () => {
  h.stub = meStub(['bansify_sess_a=rotated; Path=/', 'bansify_active=a; Path=/']);
  const res = await session({ cookie: 'gothwad_at=good' });
  assert.equal(res.status, 200);
  const cookies = res.headers.getSetCookie();
  assert.ok(cookies.some((c) => c.startsWith('bansify_sess_a=rotated')));
  assert.ok(cookies.some((c) => c.startsWith('bansify_active=a')));
});

test('an unrelated upstream cookie is never forwarded to the browser', async () => {
  h.stub = meStub(['analytics_id=1; Path=/', 'evil_thing=2; Path=/']);
  const res = await session({ cookie: 'gothwad_at=good' });
  assert.equal(res.status, 200);
  const joined = res.headers.getSetCookie().join('|');
  assert.equal(joined.includes('analytics_id'), false);
  assert.equal(joined.includes('evil_thing'), false);
});

// ---------------------------------------------------------------------------
// The per-tab selector header
// ---------------------------------------------------------------------------

test('either authuser header spelling selects the tab account, and both go upstream', async () => {
  for (const header of ['X-Gothwad-Authuser', 'X-Bansify-Authuser']) {
    h.seen.length = 0;
    h.stub = meStub();
    const res = await session({ cookie: 'gothwad_at=good', headers: { [header]: '1' } });
    assert.equal(res.status, 200, `${header} must be accepted`);

    const me = h.seen.find((s) => s.url.pathname === '/api/auth/me');
    assert.ok(me, 'Accounts was called');
    // Accounts reads the Gothwad name today; the Bansify one is sent alongside so
    // a rename on either side needs no Mail release.
    assert.equal(me!.headers.get('x-gothwad-authuser'), '1');
    assert.equal(me!.headers.get('x-bansify-authuser'), '1');
  }
});

test('a request with no selector sends no selector header at all', async () => {
  h.stub = meStub();
  const res = await worker.fetch(authed('/api/session?meta=0'), h.env);
  assert.equal(res.status, 200);
  const me = h.seen.find((s) => s.url.pathname === '/api/auth/me');
  assert.equal(me!.headers.get('x-gothwad-authuser'), null);
  assert.equal(me!.headers.get('x-bansify-authuser'), null);
});

// ---------------------------------------------------------------------------
// The OAuth client id
// ---------------------------------------------------------------------------

test('a Bearer token minted for bansify-mail is accepted (client id rename)', async () => {
  h.stub = userinfoStub(
    oauthUserInfo({ client_id: 'bansify-mail', aud: 'bansify-mail', scope: 'profile email mail' })
  );
  const res = await worker.fetch(req('/api/session?meta=0', { headers: BEARER }), h.env);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user?: { username?: string } };
  assert.equal(body.user?.username, 'alice');
});

test('the legacy gothwad-mail token still works', async () => {
  h.stub = userinfoStub(oauthUserInfo());
  const res = await worker.fetch(req('/api/session?meta=0', { headers: BEARER }), h.env);
  assert.equal(res.status, 200);
});

test('a token for another app is still 403 insufficient_scope', async () => {
  h.stub = userinfoStub(
    oauthUserInfo({ client_id: 'kiwi-store', aud: 'kiwi-store', scope: 'profile email mail' })
  );
  const res = await worker.fetch(req('/api/session?meta=0', { headers: BEARER }), h.env);
  assert.equal(res.status, 403);
  assert.equal(((await res.json()) as { error: string }).error, 'insufficient_scope');
});
