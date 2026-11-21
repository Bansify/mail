/**
 * =============================================================================
 * LOCAL FULL-STACK PREVIEW SERVER (`npm run preview:api`)
 * =============================================================================
 * WHY: in production `env.DB` is Cloudflare D1. The local preview gives the
 * REAL SQLite driver (node:sqlite) a D1-shaped adapter and runs the same Worker
 * entry point (`worker/src/index.ts`) that production runs, so there is no
 * second Express/server.js to keep in sync.
 *
 *   browser (Vite :3000) --/api--> this server (:8787) --> LocalD1 (SQLite)
 *
 * Auth: a preview browser has no Accounts cookie, so the Worker's dev-only
 * bypass (`DEV_AUTH_USERNAME`) is used. If a request DOES carry an Accounts
 * cookie (`gothwad_*` or the renamed `bansify_*`; the UI smoke test sends one),
 * this server answers as a LOCAL Accounts stub instead, so the 401 and 503
 * branches are testable too. The Resend call is faked locally as well: no real
 * email is ever sent and no real key is needed.
 * =============================================================================
 */

import http from 'node:http';
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { createLocalD1 } from './local-d1.mjs';
import worker from '../worker/src/index.ts';
import { Db } from '../worker/src/db.ts';
import { insertMessage } from '../worker/src/mail.ts';
import { getSettings } from '../worker/src/retention.ts';

const PORT = Number(process.env.PREVIEW_API_PORT || 8787);
const USERNAME = (process.env.DEV_AUTH_USERNAME || 'pawan').toLowerCase();

const db = createLocalD1(process.env.DEV_D1_FILE || ':memory:');

const env = {
  DB: db,
  APP_DOMAIN: process.env.APP_DOMAIN || 'bansify.com',
  AUTH_HUB_URL: process.env.AUTH_HUB_URL || 'https://api.bansify.com',
  // Browser-facing Accounts host. Locally that is this server: it serves the
  // widget stub at /widget/account-menu.js and the sign-in stub pages, so the
  // dev preview follows exactly the same code path as production.
  AUTH_SIGNIN_URL: process.env.AUTH_SIGNIN_URL || `http://localhost:${PORT}`,
  MAIL_URL: process.env.MAIL_URL || 'http://localhost:3000',
  ENVIRONMENT: 'development',
  DEV_AUTH_USERNAME: USERNAME,
  RESEND_API_KEY: 're_local_preview_only',
  ALLOWED_ORIGINS:
    'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173',
  DAILY_SEND_LIMIT: '30',
  MAX_INBOUND_BYTES: '10485760',
};

// Local only: a two-account Accounts stub that mirrors the live v2.3 contract
// (per-slot cookies, the authuser header, single-call /auth/me with accounts).
// The active account is still a cookie (`gothwad_active` / `bansify_active`),
// exactly like the real service, so a switch survives a reload and the rest of
// the Worker code is untouched. Both cookie prefixes and both authuser header
// spellings are accepted, because Accounts today issues the Gothwad ones.
const LOCAL_ACCOUNTS = [
  { id: 'a', authuser: 0, username: 'alice', firstName: 'Alice', lastName: 'Sharma' },
  { id: 'b', authuser: 1, username: 'bob', firstName: 'Bob', lastName: 'Verma' },
];

/** Slots the local "browser" has signed out of (the stub keeps no real sessions). */
const signedOutSlots = new Set();
const liveAccounts = () => LOCAL_ACCOUNTS.filter((a) => !signedOutSlots.has(a.id));

function activeSlot(cookie) {
  const match = /(?:gothwad|bansify)_active=([a-f])/.exec(cookie || '');
  const id = match && match[1];
  return liveAccounts().some((a) => a.id === id) ? id : liveAccounts()[0]?.id ?? 'a';
}

/** The tab's selector wins over the browser-wide active cookie (multi-tab). */
function selectedAccount(cookie, selector) {
  const raw = (selector || '').trim().toLowerCase();
  const live = liveAccounts();
  if (raw) {
    // Numeric selectors are positions in the CURRENT list, like the live
    // service: after a sign out, index 0 is whoever is left.
    if (/^\d+$/.test(raw)) return live[Number(raw)];
    if (/^[a-f]$/.test(raw)) return live.find((a) => a.id === raw);
    return live.find((a) => a.username === raw);
  }
  return live.find((a) => a.id === activeSlot(cookie));
}

function publicAccounts() {
  // Number from the CURRENT list, exactly like the live service: after a sign
  // out, the remaining account is re-slotted and its /u/<n>/ page follows.
  return liveAccounts().map((a, index) => ({
    id: a.id,
    authuser: index,
    username: a.username,
    firstName: a.firstName,
    lastName: a.lastName,
    email: `${a.username}@${env.APP_DOMAIN}`,
    avatarUrl: null,
    accountUrl: `${env.AUTH_SIGNIN_URL}/u/${index}/me`,
    lastUsedAt: new Date().toISOString(),
  }));
}

function accountsResponse(account, extra = {}) {
  const res = Response.json({
    activeId: account.id,
    authuser: account.authuser,
    accounts: publicAccounts(),
    ...extra,
  });
  res.headers.append('set-cookie', `gothwad_active=${account.id}; Path=/; SameSite=Lax`);
  res.headers.append('set-cookie', `bansify_active=${account.id}; Path=/; SameSite=Lax`);
  return res;
}

// Local only: pretend Resend accepted the mail, and answer Accounts' session
// endpoints locally so the signed-out / broken-session branches are testable.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('https://api.resend.com/')) {
    return Response.json({ id: `local_${Date.now()}` }, { status: 200 });
  }
  if (url.startsWith(`${env.AUTH_HUB_URL}/api/auth/me`)) {
    const headers = new Headers(init?.headers);
    const cookie = headers.get('cookie') || '';
    if (/(?:gothwad|bansify)_at=good/.test(cookie)) {
      const account = selectedAccount(
        cookie,
        headers.get('x-gothwad-authuser') ?? headers.get('x-bansify-authuser')
      );
      if (!account) return Response.json({ authenticated: false }, { status: 401 });
      return accountsResponse(account, {
        authenticated: true,
        user: {
          username: account.username,
          first_name: account.firstName,
          last_name: account.lastName,
          email: `${account.username}@${env.APP_DOMAIN}`,
        },
      });
    }
    if (/(?:gothwad|bansify)_at=no_username/.test(cookie)) {
      return Response.json({ authenticated: true, user: { username: '' } });
    }
    return Response.json({ authenticated: false }, { status: 401 });
  }
  if (url.startsWith(`${env.AUTH_HUB_URL}/api/auth/accounts/`)) {
    // POST /api/auth/accounts/:id/signout — drop that slot for this process,
    // and promote the current account only if it was the one that left.
    const headers = new Headers(init?.headers);
    const cookie = headers.get('cookie') || '';
    const id = url.split('/api/auth/accounts/')[1].split('/')[0];
    signedOutSlots.add(id);
    const live = liveAccounts();
    if (live.length === 0) {
      return Response.json({ ok: true, signedOutAll: true, activeId: null, authuser: 0, accounts: [] });
    }
    const next = live.some((a) => a.id === activeSlot(cookie)) ? activeSlot(cookie) : live[0].id;
    return accountsResponse(
      live.find((a) => a.id === next),
      { ok: true, signedOutAll: false }
    );
  }
  if (url.startsWith(`${env.AUTH_HUB_URL}/api/auth/accounts`)) {
    const cookie = new Headers(init?.headers).get('cookie') || '';
    return accountsResponse(liveAccounts().find((a) => a.id === activeSlot(cookie)));
  }
  if (url.startsWith(`${env.AUTH_HUB_URL}/api/auth/switch`)) {
    let target = null;
    try {
      const body = JSON.parse(String(init?.body || '{}'));
      const live = liveAccounts();
      target =
        (body.id && live.find((a) => a.id === body.id)) ||
        (body.authuser !== undefined && live.find((a) => a.authuser === Number(body.authuser))) ||
        null;
    } catch {
      target = null;
    }
    if (!target) return Response.json({ error: 'account_not_signed_in' }, { status: 409 });
    return accountsResponse(target, { ok: true });
  }
  if (url.startsWith(`${env.AUTH_HUB_URL}/api/oauth/userinfo`)) {
    return Response.json({ sub: '1', preferred_username: 'alice', name: 'Alice' });
  }
  if (url.startsWith(`${env.AUTH_HUB_URL}/api/internal/usernames/`)) {
    return Response.json({ exists: true });
  }
  return realFetch(input, init);
};

/** Seeds a small, clearly-labelled local mailbox so the UI has something to show. */
async function seed() {
  const mailDb = await Db.from(env);
  // `pawan` = browser preview (dev bypass). `alice` = the user the UI smoke
  // test's local Accounts stub signs in as.
  for (const username of [USERNAME, 'alice', 'bob']) await seedMailbox(mailDb, username);
  await seedAccountMarkers(mailDb);
}

async function seedMailbox(mailDb, username) {
  await getSettings(mailDb, username);
  const count = await mailDb.first('SELECT COUNT(*) AS n FROM mail_messages WHERE to_username = ?', username);
  if (Number(count?.n ?? 0) > 0) return;

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const welcome = [
    {
      subject: 'Welcome to Bansify Mail (local preview)',
      fromEmail: 'team@bansify.com',
      fromName: 'Bansify Team',
      text: 'Welcome. This is a local preview: the D1 database is real SQLite, and the data lives only in your browser session.\nOpen Settings to try retention 500 / 1500 / Store All.',
      html: '<h2>Welcome 🙏</h2><p>This is the <b>local preview</b>. Message bodies are gzipped and stored in D1 (SQLite).</p>',
      isStarred: true,
      ageDays: 1,
    },
    {
      subject: 'Invoice for October',
      fromEmail: 'billing@example.org',
      fromName: 'Example Billing',
      text: 'कृपया अक्टूबर का इनवॉइस देखें। धन्यवाद 🙏',
      html: '<p>कृपया <b>अक्टूबर</b> का इनवॉइस देखें। धन्यवाद 🙏</p>',
      isStarred: false,
      ageDays: 3,
    },
    {
      subject: 'Deploy report ✅',
      fromEmail: 'ci@example.org',
      fromName: 'CI Bot',
      text: 'Build #218 passed. All 42 checks green.',
      html: '<p>Build <b>#218</b> passed ✅</p>',
      isStarred: false,
      ageDays: 6,
    },
    {
      subject: 'Old newsletter (already in Trash)',
      fromEmail: 'news@example.org',
      fromName: 'Newsletter',
      text: 'This one sits in Trash and is older than 30 days, so retention will purge it.',
      html: '<p>Old newsletter.</p>',
      isStarred: false,
      ageDays: 45,
      folder: 'trash',
    },
  ];

  for (const item of welcome) {
    await insertMessage(mailDb, {
      username,
      folder: item.folder || 'inbox',
      fromEmail: item.fromEmail,
      fromName: item.fromName,
      to: [`${username}@${env.APP_DOMAIN}`],
      subject: item.subject,
      text: item.text,
      html: item.html,
      isRead: false,
      isStarred: item.isStarred,
      providerId: null,
      receivedAt: new Date(now - item.ageDays * day).toISOString(),
    });
  }

  // One sent mail, so the Sent folder is not empty.
  await insertMessage(mailDb, {
    username,
    folder: 'sent',
    fromEmail: `${username}@${env.APP_DOMAIN}`,
    fromName: 'Pawan',
    to: ['hello@example.com'],
    subject: 'Testing Bansify Mail',
    text: 'Hi! This mail was sent from the local preview (Resend is faked).',
    html: '<p>Hi! This mail was sent from the local preview.</p>',
    isRead: true,
    providerId: 'local_seed',
    receivedAt: new Date(now - 2 * day).toISOString(),
  });
}

/**
 * One message only THAT account's inbox holds. Two accounts have otherwise
 * identical seeded mail (that is realistic), so this marker is what lets the
 * isolation tests prove a switch never paints the previous account's rows.
 */
async function seedAccountMarkers(mailDb) {
  for (const username of [USERNAME, 'alice', 'bob']) {
    const subject = `Only ${username}'s account sees this`;
    const existing = await mailDb.first(
      'SELECT id FROM mail_messages WHERE to_username = ? AND subject = ?',
      username,
      subject
    );
    if (existing) continue;
    await insertMessage(mailDb, {
      username,
      folder: 'inbox',
      fromEmail: 'notes@bansify.com',
      fromName: 'Account Marker',
      to: [`${username}@${env.APP_DOMAIN}`],
      subject,
      text: 'This row exists in exactly one mailbox.',
      html: '<p>This row exists in exactly one mailbox.</p>',
      isRead: false,
      isStarred: false,
      providerId: null,
      receivedAt: new Date().toISOString(),
    });
  }
}

await seed();

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// The shared account widget lives in the Accounts repo in production. Locally we
// serve the same API from tools/account-menu-widget.stub.js, so the dev preview
// and the jsdom tests exercise the real `${accountsWebOrigin}/widget/...` path.
const WIDGET_STUB = readFileSync(new URL('./account-menu-widget.stub.js', import.meta.url), 'utf8');

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/widget/account-menu.js') {
      // Same headers the real Accounts host sends for /widget/*: cross-origin
      // module loads are CORS requests, so without this the import fails.
      res.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'access-control-allow-origin': '*',
        'cross-origin-resource-policy': 'cross-origin',
        'cache-control': 'no-store',
      });
      res.end(WIDGET_STUB);
      return;
    }

    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) for (const v of value) headers.append(key, v);
      else if (value !== undefined) headers.set(key, value);
    }
    // The browser's Origin is the preview host; the Worker only allowlists
    // localhost in development, so normalise it here (dev-only file).
    if (headers.get('origin') && !headers.get('origin').includes('localhost')) {
      headers.set('origin', 'http://localhost:3000');
    }

    // A request that carries any cookie is decided by the local Accounts stub
    // above (so the signed-out branches are testable). The plain browser preview
    // has no Accounts cookie, so give it the stub session instead of the dev
    // bypass: that way the account switcher is visible locally, and the request
    // still goes through the real cookie path the production browser uses.
    const worksWithCookies = Boolean(req.headers.cookie);
    // Both cookie prefixes are set, so the local stub exercises the dual
    // `gothwad_*` / `bansify_*` support instead of only the legacy name.
    if (!worksWithCookies) headers.set('cookie', 'gothwad_at=good; bansify_at=good');

    // Local test hook: forget the simulated sign-outs so each UI test starts
    // with alice and bob signed in. Never part of the Worker's API surface.
    if (req.url === '/__local/reset-accounts' && req.method === 'POST') {
      signedOutSlots.clear();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    const url = `http://localhost:${PORT}${req.url}`;
    const request = new Request(url, {
      method: req.method,
      headers,
      body: body && body.length > 0 ? body : undefined,
    });

    // Every preview request now has a cookie (injected above when the browser
    // had none), so the dev bypass must stay off: otherwise /api/session says
    // one user while /api/mail/accounts says another.
    const requestEnv = { ...env, DEV_AUTH_USERNAME: undefined };

    const response = await worker.fetch(request, requestEnv);
    res.statusCode = response.status;
    for (const [key, value] of response.headers) {
      if (key === 'content-encoding' || key === 'transfer-encoding') continue;
      res.setHeader(key, value);
    }
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error('preview_server_error', error);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'preview_server_error' }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Mail API (local D1) listening on http://0.0.0.0:${PORT} for "${USERNAME}@${env.APP_DOMAIN}"`);
});
