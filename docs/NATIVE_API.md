# Native app support: OAuth, search, bulk actions and App Links

`Bansify/mailapp` (Android, package `com.bansify.mail`) uses this Worker as its only backend.
The web app keeps using cookie SSO and nothing here changes its behaviour: a request with an
`Authorization` header never reads cookies, and a cookie request never calls the OAuth endpoint.

## OAuth contract (owned by Bansify Accounts)

Registration in `Bansify/accounts` (`migrations/0014_first_party_native.sql`):

| Field | Value |
| --- | --- |
| `client_id` | `gothwad-mail` (the id Accounts registers today; `bansify-mail` is accepted too) |
| `android_package` | `com.bansify.mail` |
| `redirect_uris` | `https://mail.bansify.com/oauth/callback`, `com.gothwad.mail:/oauth/callback` |
| `allowed_scopes` | `profile`, `email`, `offline_access`, `mail` |

`GET {AUTH_HUB_URL}/api/oauth/userinfo` with the access token answers:

```json
{
  "sub": "<uuid>",
  "client_id": "gothwad-mail",
  "aud": "gothwad-mail",
  "scope": "email mail offline_access profile",
  "scopes": ["email", "mail", "offline_access", "profile"],
  "preferred_username": "alice",
  "name": "Alice Sharma",
  "given_name": "Alice",
  "family_name": "Sharma",
  "email": "alice@bansify.com",
  "email_verified": true,
  "picture": "https://…"
}
```

`given_name` / `family_name` arrive only with the `profile` scope; `email` only with `email`;
`preferred_username` with `profile` or `mail`.

### What Mail enforces (`worker/src/session.ts`)

| Check | Failure |
| --- | --- |
| Accounts answers 401/403 | Mail **401 `unauthenticated`** with `signinUrl` — the app may refresh its token |
| `client_id` **or** `aud` is neither `gothwad-mail` nor `bansify-mail` | **403 `insufficient_scope`** (`requiredClient`) |
| Scopes (array `scopes` or string `scope`) do not include `mail` | **403 `insufficient_scope`** (`requiredScope`) |
| Network error, timeout, 3xx, 5xx, HTML or a body Mail cannot read | **503** (`auth_unavailable` / `accounts_unexpected_response`) |

A valid token for another Bansify app (Store, Tube) is a 403, never a 401: it is not a
signed-out user, and a 401 would make the app throw the token away and loop through sign-in.
`preferred_username` still has to pass the same username rule as the cookie path, and the email
is always derived as `username@APP_DOMAIN`.

A bearer session carries exactly one account:

```json
{ "id": "bearer", "authuser": 0, "username": "alice", "email": "alice@bansify.com",
  "accountUrl": "https://accounts.bansify.com/me", "lastUsedAt": null }
```

That is what makes `GET /api/session` and `GET /api/session/meta` return
`unread: { "alice": <count> }` for the token owner.

## Mailbox operations

### List with search and filters

`GET /api/mail/messages`

| Parameter | Meaning |
| --- | --- |
| `q` | 1..200 characters, case-insensitive, matched against `subject`, `from_email`, `from_name`, `to_email` and `snippet`. `%` and `_` are escaped, so they are literal text. |
| `unread=1` | Only unread messages (`0`/`false` = no filter). |
| `starred=1` | Only starred messages. |
| `hasAttachment=1` | Only messages whose attachment list is not empty. |
| `folder` | `inbox` \| `starred` \| `sent` \| `drafts` \| `trash` \| `all`. Omitted **with** `q` or a filter means `all`; omitted without means `inbox` (the historical default, so the web client is unaffected). |
| `limit`, `before` | Unchanged: 1..100 (default 50) and the ISO cursor from `nextBefore`. |

Filters combine with AND and are applied inside `WHERE to_username = ?`, so search can never
reach another mailbox. A bad flag value, a query over 200 characters or an unknown folder is a
**400**, never a silently empty result.

### Restore from Trash (Undo)

`PATCH /api/mail/messages/:id`

```json
{ "moveToInbox": true }
```

`{ "folder": "inbox" }` is the same intent in one field; `{ "folder": "trash" }` trashes. Only
those two targets exist — a message cannot be patched straight into Sent or Drafts (400
`bad_folder`), and asking for Trash *and* the Inbox in one call is 400 `bad_field`. The web
client keeps working with `{ isRead?, isStarred?, moveToTrash? }`.

### Batch actions

`POST /api/mail/messages/batch`

```json
{ "ids": ["<uuid>", "…"], "isRead": true }
{ "ids": ["<uuid>", "…"], "isStarred": false }
{ "ids": ["<uuid>", "…"], "moveToTrash": true }
{ "ids": ["<uuid>", "…"], "moveToInbox": true }
{ "ids": ["<uuid>", "…"], "deleteFromTrash": true }
```

* 1..100 ids, each a valid UUID; duplicates collapse; anything else is 400 `bad_ids`.
* One statement, always `WHERE to_username = ? AND id IN (…)`. A valid id from another mailbox
  changes nothing and is not reported back — the response is only `{ ok: true, updated }`.
* `deleteFromTrash` additionally requires `folder = 'trash'`, exactly like the single-message
  DELETE, and cannot be combined with other actions.
* No action, an unknown field, or Trash + Inbox together is a 400.

### Empty Trash

`DELETE /api/mail/trash` → `{ ok: true, deleted }`. It only deletes the caller's own
`folder = 'trash'` rows, and an already empty Trash is a success with `deleted: 0`.

## App Links bridge (`/oauth/callback`)

| File | Job |
| --- | --- |
| `public/oauth/callback/index.html` | Static page: reads the query Accounts returned, then forwards it unchanged to `com.bansify.mail:/oauth/callback` (Chrome on Android also gets an `intent://` hop). A second, labelled button also offers the legacy `com.gothwad.mail:/oauth/callback`. It never exchanges the code, never stores anything, and always offers a button plus "continue in the browser". |
| `public/.well-known/assetlinks.json` | Android App Links verification for `com.bansify.mail` (the current APK id) and `com.gothwad.mail` (legacy installs), each with the SHA-256 certificate fingerprint. |

Both paths are pinned ahead of the SPA rewrite in `public/_redirects`, and `/oauth/` is excluded
from the service worker's navigation fallback (`vite.config.ts`), so an installed PWA cannot
swallow the app redirect. `npm run dev` mirrors the Pages rule with a tiny dev-only middleware,
so the bridge can be checked locally at `http://localhost:3000/oauth/callback?code=…`.
`/u/<n>/` routing is untouched.
