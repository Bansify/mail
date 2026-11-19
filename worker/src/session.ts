// =============================================================================
// Session resolution: "who is this request for?"
//
// Source of truth = Bansify Accounts (AUTH_HUB_URL). Mail never stores
// passwords and never mints its own login.
//
//  1. Cookie path (normal web use): forward the browser's Cookie header to
//     GET {AUTH_HUB_URL}/api/auth/me. Accounts sets the cookies on
//     .bansify.com, so they reach this Worker on mail.bansify.com.
//  2. Bearer path (native clients, e.g. the Android app): GET
//     {AUTH_HUB_URL}/api/oauth/userinfo with the access token. The token must
//     have been minted for THIS app (client_id/aud = `gothwad-mail`) AND carry
//     the `mail` scope. A token for another Bansify app is a 403
//     `insufficient_scope`, never a session.
//
// AUTH_HUB_URL must be a host that reaches the Accounts Worker for a
// server-to-server call (Accounts' Custom Domain, e.g. api.bansify.com).
// AUTH_SIGNIN_URL is used only for the browser-facing sign-in link; see
// signinBaseUrl() below and the note in config.ts.
//
// Email is DERIVED here as username@APP_DOMAIN (Accounts stores username only).
//
// Status rule (see docs/MAIL.md, "If Accounts keeps showing the chooser"):
//   401/403 from Accounts = really signed out -> Mail 401 + signinUrl.
//   Anything else that Mail cannot read (3xx, HTML, missing authenticated flag,
//   unusable username, 5xx, timeout) = 503 with its own code, NEVER a 401.
//   A 401 must mean "signed out", otherwise the browser bounces back to the
//   Accounts chooser in a loop.
// =============================================================================

import type { Config } from './config';
import { HttpError } from './http';
import { authUserFromRequest, authUserIndex } from './authuser';
import { parseAccounts, pickAccount, type PublicAccount } from './accountList';

// Codes Mail returns when the Accounts handoff itself is broken. The web app
// shows a retry message for these and must never redirect to Accounts.
export const AUTH_UNAVAILABLE = 'auth_unavailable';
export const ACCOUNTS_UNEXPECTED_RESPONSE = 'accounts_unexpected_response';
export const ACCOUNTS_USER_INVALID = 'accounts_user_invalid';
export const INSUFFICIENT_SCOPE = 'insufficient_scope';

/** The OAuth client this Worker serves (Bansify Accounts `ecosystem_apps`). */
export const MAIL_OAUTH_CLIENT_ID = 'gothwad-mail';
/** The scope that allows reading and sending a mailbox through this API. */
export const MAIL_OAUTH_SCOPE = 'mail';

export interface Session {
  username: string;
  email: string;
  name: string | null;
  /** Parts of the name, so the account widget can render initials like Accounts. */
  firstName: string;
  lastName: string;
  /** Accounts' profile photo URL (already resolved upstream), or null. */
  avatarUrl: string | null;
  /** Google-style tab account index (0..5) this request belongs to. */
  authuser: number;
  /** Accounts' slot id for that index ("a".."f"), null for bearer/dev. */
  activeId: string | null;
  /** Every account signed in in this browser, in stable 0..n order. */
  accounts: PublicAccount[];
  /** Accounts' own profile page for THIS account. */
  accountUrl: string;
  source: 'cookie' | 'bearer' | 'dev';
}

// Username rule: lowercase letters, digits, dot, dash, underscore. This keeps
// the derived email address safe to put in SQL filters and in the From header.
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const u = raw.trim().toLowerCase();
  return USERNAME_RE.test(u) ? u : null;
}

export function deriveEmail(username: string, appDomain: string): string {
  return `${username}@${appDomain}`;
}

const UPSTREAM_TIMEOUT_MS = 5000;

// Accounts can rotate the refresh token on /auth/me and send new Set-Cookie
// headers. If we dropped them, the browser would keep a revoked refresh token
// and the user would be signed out of Accounts everywhere. So we remember the
// Accounts cookies per request, and handleRequest copies them to the browser.
const upstreamCookies = new WeakMap<Request, string[]>();

/** Returns (and clears) the Accounts cookies to pass on to the browser. */
export function takeUpstreamCookies(request: Request): string[] {
  const list = upstreamCookies.get(request) ?? [];
  upstreamCookies.delete(request);
  return list;
}

/** Re-exported for the account switcher (see accounts.ts): it must forward the
 * rotated Accounts cookies exactly like the session check does. */
export function keepAccountsCookies(request: Request, res: Response): void {
  // Only Accounts' own gothwad_* cookies. Anything else from upstream is ignored.
  // getSetCookie() gives each Set-Cookie separately (get() would join them).
  // Our worker type lib does not declare it yet, so we cast.
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  const all = h.getSetCookie ? h.getSetCookie() : [];
  const cookies = all.filter((c) => /^gothwad_[a-z_]+=/i.test(c));
  if (cookies.length > 0) upstreamCookies.set(request, cookies);
}

export async function resolveSession(request: Request, config: Config): Promise<Session | null> {
  // Dev-only bypass for local testing without Accounts. Never active in production.
  if (config.devAuthUsername) {
    const username = normalizeUsername(config.devAuthUsername);
    if (!username) throw new HttpError(500, 'bad_dev_user', 'DEV_AUTH_USERNAME is invalid.');
    return {
      username,
      email: deriveEmail(username, config.appDomain),
      name: null,
      firstName: '',
      lastName: '',
      avatarUrl: null,
      authuser: 0,
      activeId: null,
      accounts: [],
      accountUrl: `${config.authSigninUrl}/me`,
      source: 'dev',
    };
  }

  const cookie = request.headers.get('cookie');
  const auth = request.headers.get('authorization');

  if (auth && /^bearer\s+/i.test(auth)) {
    return resolveBearer(auth, config);
  }
  if (cookie) {
    return resolveCookie(request, cookie, config);
  }
  return null;
}

// Shape of Accounts' /api/auth/me body that Mail relies on. Everything is
// optional here until it has been checked: a misrouted /api/* answers with
// HTML, not with this.
interface AccountsMeBody {
  authenticated?: boolean;
  user?: {
    username?: unknown;
    first_name?: unknown;
    last_name?: unknown;
    // Accounts sends both spellings; the widget accepts either.
    avatar_url?: unknown;
    avatarUrl?: unknown;
  };
  activeId?: unknown;
  authuser?: unknown;
  accounts?: unknown;
}

const AUTH_UNAVAILABLE_MESSAGE = 'Accounts is not reachable right now.';
const ACCOUNTS_UNEXPECTED_MESSAGE =
  'Accounts did not answer with a session Mail can read. This is an Accounts routing problem, not a signed-out user. Try again in a minute, or contact the admin.';
const ACCOUNTS_USER_INVALID_MESSAGE =
  'Your Bansify Account is signed in, but Mail could not read your username. Try again in a minute, or contact the admin.';

async function resolveCookie(request: Request, cookie: string, config: Config): Promise<Session | null> {
  // The per-tab selector is what makes /u/0 and /u/1 independent: Accounts
  // resolves that slot and does NOT touch the browser-wide active cookie.
  const selector = authUserFromRequest(request);
  const headers: Record<string, string> = { cookie, accept: 'application/json' };
  if (selector) headers['x-gothwad-authuser'] = selector;

  const res = await upstream(`${config.authHubUrl}/api/auth/me`, headers);
  keepAccountsCookies(request, res);

  // Only 401/403 means Accounts checked and the user really is signed out.
  if (isSignedOut(res.status)) return null;
  assertAccountsUsable(res);

  const body = (await res.json().catch(() => null)) as AccountsMeBody | null;
  // A 200 that is not Mail's JSON (e.g. the HTML a misrouted /api/* serves) or
  // that has no authenticated flag is a broken handoff, not a signed-out user.
  if (!body || typeof body.authenticated !== 'boolean') {
    throw unexpectedResponseError(res);
  }
  if (!body.authenticated) return null;

  const username = normalizeUsername(body.user?.username);
  if (!username) {
    // Accounts says the user IS signed in. Mail just cannot read the username,
    // so a 401 here would only restart the chooser loop. 503 with its own code.
    warnUpstreamFailure(ACCOUNTS_USER_INVALID, res);
    throw new HttpError(503, ACCOUNTS_USER_INVALID, ACCOUNTS_USER_INVALID_MESSAGE);
  }

  const firstName = typeof body.user?.first_name === 'string' ? body.user.first_name.trim() : '';
  const lastName = typeof body.user?.last_name === 'string' ? body.user.last_name.trim() : '';
  const name = `${firstName} ${lastName}`.trim() || null;
  const avatarUrl = textOrNull(body.user?.avatar_url) ?? textOrNull(body.user?.avatarUrl);

  // One upstream call now also returns the switcher list (Accounts v2.3), so
  // /api/session can boot the whole app without a second round trip.
  const accounts = parseAccounts(body.accounts, config, (n) => `${config.authSigninUrl}/u/${n}/me`);
  const upstreamIndex = typeof body.authuser === 'number' ? body.authuser : authUserIndex(selector);
  // Prefer the slot Accounts actually resolved; fall back to the list position.
  const activeId = typeof body.activeId === 'string' ? body.activeId.toLowerCase() : null;
  const matched = accounts.findIndex((a) => a.id === activeId);
  const authuser = matched >= 0 ? matched : Math.min(Math.max(upstreamIndex, 0), Math.max(accounts.length - 1, 0));
  const account = pickAccount(accounts, authuser);

  return {
    username,
    email: deriveEmail(username, config.appDomain),
    name,
    firstName,
    lastName,
    avatarUrl,
    authuser,
    activeId: account?.id ?? activeId,
    accounts,
    accountUrl: account?.accountUrl ?? `${config.authSigninUrl}/u/${authuser}/me`,
    source: 'cookie',
  };
}

interface OAuthUserInfoBody {
  client_id?: unknown;
  aud?: unknown;
  scopes?: unknown;
  scope?: unknown;
  preferred_username?: unknown;
  name?: unknown;
  given_name?: unknown;
  family_name?: unknown;
  picture?: unknown;
}

/**
 * Granted scopes from Accounts' `/api/oauth/userinfo`.
 *
 * Accounts sends both `scopes` (array) and `scope` (space-separated string). We
 * accept either, but only entries that are plain strings: a malformed value must
 * not be able to look like a grant.
 */
function grantedScopes(body: OAuthUserInfoBody): string[] {
  if (Array.isArray(body.scopes)) {
    return body.scopes.filter((s): s is string => typeof s === 'string');
  }
  if (typeof body.scope === 'string') {
    return body.scope.trim().split(/\s+/).filter(Boolean);
  }
  return [];
}

/**
 * Rejects a token that is valid for Accounts but was not issued to Bansify Mail.
 *
 * WHY this is not a normal 401: the token IS valid, it simply is not allowed
 * here. A 401 would make the native client throw the token away and ask the user
 * to sign in again, in a loop. 403 `insufficient_scope` is the OAuth answer, and
 * the app can show "this account was not granted Mail access".
 */
function assertMailToken(body: OAuthUserInfoBody, res: Response): void {
  const clientId = typeof body.client_id === 'string' ? body.client_id.trim() : '';
  const audience = typeof body.aud === 'string' ? body.aud.trim() : '';
  const scopes = grantedScopes(body);

  if (clientId !== MAIL_OAUTH_CLIENT_ID && audience !== MAIL_OAUTH_CLIENT_ID) {
    warnUpstreamFailure(INSUFFICIENT_SCOPE, res);
    throw new HttpError(403, INSUFFICIENT_SCOPE, 'OAuth token is not authorized for Bansify Mail.', {
      requiredClient: MAIL_OAUTH_CLIENT_ID,
    });
  }
  if (!scopes.includes(MAIL_OAUTH_SCOPE)) {
    warnUpstreamFailure(INSUFFICIENT_SCOPE, res);
    throw new HttpError(403, INSUFFICIENT_SCOPE, 'OAuth token is not authorized for Bansify Mail.', {
      requiredScope: MAIL_OAUTH_SCOPE,
    });
  }
}

async function resolveBearer(authHeader: string, config: Config): Promise<Session | null> {
  const res = await upstream(`${config.authHubUrl}/api/oauth/userinfo`, {
    authorization: authHeader,
    accept: 'application/json',
  });
  // Same rule as the cookie path: a real 401/403 is signed out, everything else
  // Mail cannot read is an upstream failure and gets a 503.
  if (isSignedOut(res.status)) return null;
  assertAccountsUsable(res);

  const body = (await res.json().catch(() => null)) as OAuthUserInfoBody | null;
  if (!body || typeof body !== 'object') {
    throw unexpectedResponseError(res);
  }
  // Audience + scope BEFORE anything else: a token minted for another app must
  // never reach a mailbox query, even for its own user.
  assertMailToken(body, res);

  const username = normalizeUsername(body.preferred_username);
  if (!username) {
    warnUpstreamFailure(ACCOUNTS_USER_INVALID, res);
    throw new HttpError(503, ACCOUNTS_USER_INVALID, ACCOUNTS_USER_INVALID_MESSAGE);
  }

  // Accounts returns given/family name with the `profile` scope; fall back to
  // splitting `name` so the payload stays the same shape for every client.
  const fullName = typeof body.name === 'string' ? body.name.trim() : '';
  const given = typeof body.given_name === 'string' ? body.given_name.trim() : '';
  const family = typeof body.family_name === 'string' ? body.family_name.trim() : '';
  const firstName = given || fullName.split(/\s+/)[0] || '';
  const lastName = family || fullName.split(/\s+/).slice(1).join(' ');
  const name = `${firstName} ${lastName}`.trim() || null;
  const email = deriveEmail(username, config.appDomain);
  const avatarUrl = textOrNull(body.picture);
  const accountUrl = `${config.authSigninUrl}/me`;

  return {
    username,
    email,
    name,
    firstName,
    lastName,
    avatarUrl,
    authuser: 0,
    activeId: null,
    // A bearer token names one user, so the "account list" is that single
    // account. loadSessionMeta() therefore computes unread for exactly it.
    accounts: [
      {
        id: 'bearer',
        authuser: 0,
        username,
        name,
        firstName,
        lastName,
        email,
        avatarUrl,
        accountUrl,
        lastUsedAt: null,
      },
    ],
    accountUrl,
    source: 'bearer',
  };
}

/** A trimmed string, or null. Keeps a stray object out of the session payload. */
function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** 401/403 only: Accounts looked at the credentials and said "not signed in". */
function isSignedOut(status: number): boolean {
  return status === 401 || status === 403;
}

/**
 * Turns an Accounts answer Mail cannot use into a 503. Callers handle the
 * signed-out cases first, so reaching here means Mail does not know who the
 * user is: that must never be reported to the browser as a 401.
 */
function assertAccountsUsable(res: Response): void {
  // We always send redirect: 'manual'. A 3xx therefore means the request never
  // reached the Accounts Worker (/api/* route missing) or Accounts is
  // redirecting. Following it would also hand the user's cookies to the host
  // the redirect points at.
  if (res.status >= 300 && res.status < 400) {
    throw unexpectedResponseError(res);
  }
  if (!res.ok) {
    warnUpstreamFailure(AUTH_UNAVAILABLE, res);
    throw new HttpError(503, AUTH_UNAVAILABLE, AUTH_UNAVAILABLE_MESSAGE);
  }
}

/**
 * The 503 `accounts_unexpected_response`, with what Accounts actually answered.
 * Status and content-type only: enough for the browser's DevTools to show
 * "Accounts answered 200 text/html" without opening the Worker log. The
 * upstream body and its Set-Cookie/token values never leave the Worker.
 */
function unexpectedResponseError(res: Response): HttpError {
  warnUpstreamFailure(ACCOUNTS_UNEXPECTED_RESPONSE, res);
  return new HttpError(503, ACCOUNTS_UNEXPECTED_RESPONSE, ACCOUNTS_UNEXPECTED_MESSAGE, {
    upstreamStatus: res.status,
    upstreamContentType: res.headers.get('content-type') || null,
  });
}

/**
 * One warn line per failed upstream check: our error code, the upstream status
 * and its content-type. That is enough to tell the branches apart in the Worker
 * log. Never log the cookie, tokens, or the response body.
 */
function warnUpstreamFailure(code: string, res: Response | null): void {
  const status = res ? String(res.status) : 'none';
  const contentType = res?.headers.get('content-type') || 'none';
  console.warn(`accounts_check_failed code=${code} status=${status} content-type=${contentType}`);
}

async function upstream(url: string, headers: Record<string, string>): Promise<Response> {
  try {
    return await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'manual', // a redirect here is an Accounts routing problem; do not follow it
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    // Network error or timeout: there is no upstream status to report.
    warnUpstreamFailure(AUTH_UNAVAILABLE, null);
    throw new HttpError(503, AUTH_UNAVAILABLE, AUTH_UNAVAILABLE_MESSAGE);
  }
}

/**
 * Where to send an unauthenticated browser. The browser appends its own ?next=.
 *
 * This is a BROWSER link, not a server-side call, so it uses AUTH_SIGNIN_URL
 * (the Accounts host people sign in on). AUTH_HUB_URL is the server-to-server
 * host; sending users there would work only by accident, and on a Custom
 * Domain such as api.bansify.com it would not be the sign-in page.
 */
export function signinBaseUrl(config: Config): string {
  return `${config.authSigninUrl}/signin?choose=1`;
}
