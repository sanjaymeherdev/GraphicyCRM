# CRM Backend — modular platform integrations

One Express backend, one login, eight independent modules. Every module is
self-contained in `modules/<name>/`:

- **`service.js`** — pure business logic, zero Express dependency. Import it
  directly from a script, worker, or another module's route (e.g. `ai-bot`
  imports `sheets` and `docs` services directly for grounding).
- **`routes.js`** — a thin REST wrapper around `service.js`, mounted in `server.js`.

```
modules/
  whatsapp/   send text/button/list/cta_url/template, webhook, accounts
  facebook/   OAuth connect, posts, comments, Messenger DMs
  instagram/  OAuth connect, media, comments, DMs
  threads/    OAuth connect, posts, replies
  gmail/      send/list/read/search
  sheets/     read/write/append rows, watcher automation engine
  docs/       create/read/append/replace-text/copy
  ai-bot/     AI chat completions + keyword rule-matching engine
shared/
  db.js               Supabase client
  crypto.js            AES-256-GCM token encryption
  auth.js              unified login (Supabase Auth + session/JWT) — used by every module
  googleAuth.js         Google OAuth token refresh (gmail/sheets/docs share it)
  googleConnectRoutes.js  "Connect Google" flow, mounted once
  metaConnections.js    Facebook/Instagram/Threads OAuth + connection storage
```

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in credentials (see comments in the
   file for where each one comes from — Supabase project settings, Meta App
   Dashboard, Google Cloud Console, NVIDIA API).
3. Run `migrations/001_init.sql` in your Supabase SQL editor.
4. `npm run dev`

## Auth model

Every module trusts the same `req.user` set by `shared/auth.js`'s
`requireAuth` middleware:

- Browser/dashboard: `POST /api/auth/login` sets a session cookie.
- API/mobile/server-to-server: same endpoint also returns a Supabase JWT —
  send it as `Authorization: Bearer <token>` to any module's API.

There's no per-module login. Connecting a platform (Facebook, Google, etc.)
is a separate step from logging in — it just attaches that platform's OAuth
token to your already-authenticated user.

## Connecting platforms

- **WhatsApp**: no OAuth — `POST /api/whatsapp/accounts` with a WABA id,
  phone number id, and a System User access token (from Meta Business
  Settings → System Users), or `POST /api/whatsapp/accounts/verify` first to
  list numbers on that WABA.
- **Facebook / Instagram / Threads**: `GET /api/<platform>/connect` returns
  an OAuth URL to redirect the user to; the callback is handled automatically.
  Connecting Facebook also auto-links the Page's Instagram Business account
  if one exists.
- **Gmail / Sheets / Docs**: one shared flow — `GET /api/google/connect`.
  Connecting once grants all three modules' scopes (gmail.send,
  gmail.readonly, spreadsheets, documents).

## Wiring modules together

Because `service.js` files have no Express dependency, you can compose them
freely. Two examples already in the code:

- `modules/ai-bot/service.js` calls `modules/sheets/service.js` and
  `modules/docs/service.js` directly to ground AI replies in a spreadsheet
  lookup or a reference document.
- `server.js` polls `modules/sheets/service.js`'s `pollWatchers()` every
  minute; the `onMatch` callback is where you'd call
  `modules/whatsapp/service.js`'s `sendMessage()` or
  `modules/gmail/service.js`'s `sendEmail()` to actually act on a matched row
  (commented example in `server.js`).

To connect an inbound channel webhook (WhatsApp/Facebook/Instagram) to the
AI bot, call `modules/ai-bot/service.js`'s `matchRule()` from inside that
channel's webhook handler in `routes.js`, then send the result back out
through that same channel's `service.js`.

## Notes

- All OAuth tokens are encrypted at rest with `shared/crypto.js` — set
  `TOKEN_ENCRYPTION_KEY` (32 random bytes, base64) before storing anything.
- Table names are prefixed `crm_` throughout to avoid collisions if you
  already have other Supabase tables — rename freely, they're only
  referenced inside each module's `service.js`.
- `public/login.html` is a single unified login page for every module;
  swap it out for your own frontend once you have one — the API surface
  (`/api/auth/*`) doesn't change.
