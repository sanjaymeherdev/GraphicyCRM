// server.js — mounts every module behind ONE login, and serves the
// GraphicyCRM frontend (public/) from the same origin so the session
// cookie set by /api/auth/login is sent automatically on every fetch()
// js/api.js makes (default fetch credentials mode is same-origin).
//
// Two layers of modules:
//   - Channel modules (whatsapp/facebook/instagram/threads/gmail/sheets/
//     docs/ai-bot) — talk to the outside platforms.
//   - CRM-layer modules (leads/contacts/inbox/templates/automations/
//     integrations/settings/dashboard/reports/webhook/schedule/insights) —
//     the data model the frontend actually renders, scoped by client_id via
//     shared/clientContext.js. See schema_full.sql for the tables.
require('dotenv').config();

const express = require('express');
const path = require('path');
const fetch = require('node-fetch');

const { sessionMiddleware, authRouter } = require('./shared/auth');
const googleConnectRoutes = require('./shared/googleConnectRoutes');
const frontendAdapters = require('./shared/frontendAdapters');
const { supabase } = require('./shared/db');
const { resolveFirstUserId } = require('./shared/clientContext');
const sheetsService = require('./modules/sheets/service');
const scheduleService = require('./modules/schedule/service');
const insightsService = require('./modules/insights/service');
const automationsService = require('./modules/automations/service');

const app = express();
app.set('trust proxy', 1);
app.use(sessionMiddleware());

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// `verify` stashes the exact raw bytes Express read off the wire onto
// req.rawBody, alongside the normal parsed req.body. Meta's X-Hub-Signature-256
// webhook header is an HMAC over those exact raw bytes — re-serializing
// req.body with JSON.stringify() before hashing would produce a different
// signature (key order, whitespace) and fail verification. Every module's
// webhook route (facebook/instagram/threads) needs this; cheapest to capture
// it once, globally, than to re-parse each webhook body as express.raw().
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

// ---------------------------------------------------------------------
// ONE login for every module below.
// ---------------------------------------------------------------------
app.use('/api/auth', authRouter());
app.use('/api/google', googleConnectRoutes); // shared "Connect Google" for gmail + sheets + docs
app.use('/api', frontendAdapters); // /api/theme, /api/oauth/:service/url, /api/wa/verify

// ---------------------------------------------------------------------
// Channel modules — each mounted at its own namespace. Webhook routes
// inside each module's routes.js are intentionally public (Meta/Google
// call them); everything else requires login via shared/auth.js's
// requireAuth.
// ---------------------------------------------------------------------
app.use('/api/whatsapp', require('./modules/whatsapp/routes'));
app.use('/api/facebook', require('./modules/facebook/routes'));
app.use('/api/instagram', require('./modules/instagram/routes'));
app.use('/api/threads', require('./modules/threads/routes'));
app.use('/api/linkedin', require('./modules/linkedin/routes'));
app.use('/api/gmail', require('./modules/gmail/routes'));
app.use('/api/sheets', require('./modules/sheets/routes'));
app.use('/api/docs', require('./modules/docs/routes'));
app.use('/api/ai-bot', require('./modules/ai-bot/routes'));
app.use('/api/help-bot', require('./modules/help-bot/routes'));
// ---------------------------------------------------------------------
// CRM-layer modules — what js/api.js (GraphicyCRM frontend) actually calls.
// ---------------------------------------------------------------------
app.use('/api/leads', require('./modules/leads/routes'));
app.use('/api/contacts', require('./modules/contacts/routes'));
app.use('/api/inbox', require('./modules/inbox/routes'));
app.use('/api/templates', require('./modules/templates/routes'));
app.use('/api/automations', require('./modules/automations/routes'));
app.use('/api/integrations', require('./modules/integrations/routes'));
app.use('/api/settings', require('./modules/settings/routes'));
app.use('/api/dashboard', require('./modules/dashboard/routes'));
app.use('/api/reports', require('./modules/reports/routes'));
app.use('/api/webhook', require('./modules/webhook/routes'));
app.use('/api/schedule', require('./modules/schedule/routes'));
app.use('/api/insights', require('./modules/insights/routes'));
// modules/media: two routers sharing the '/api/media' base — .streamRouter
// is public (Meta/LinkedIn fetch scheduled-post media through it, gated by
// a signed token instead of auth), .router requires login for the actual
// upload-to-Drive endpoint. Order doesn't matter between these two since
// their sub-paths ('/upload' vs '/stream/:userId/:fileId') don't overlap.
const mediaRoutes = require('./modules/media/routes');
app.use('/api/media', mediaRoutes.streamRouter);
app.use('/api/media', mediaRoutes.router);
// Mounted last and at the generic '/api' prefix (its routes are /profile and
// /client, not under their own subpath) — registered after every specific
// /api/<module> mount above so its blanket requireAuth middleware (see
// modules/profile/routes.js) can't intercept requests meant for a more
// specific, earlier-registered router — most importantly the public
// POST /api/webhook/in/:token receiver, which must stay unauthenticated.
app.use('/api', require('./modules/profile/routes'));

// ---------------------------------------------------------------------
// Frontend (GraphicyCRM) — static files + a login guard on the SPA shell.
// Everything under /api/* above is already its own auth boundary; this
// guard just keeps a logged-out browser from loading the dashboard shell
// itself (it would just sit there showing mock data via js/api.js's
// fallback otherwise, which is confusing).
// ---------------------------------------------------------------------
const PUBLIC_DIR = path.join(__dirname, 'public');
const IMAGES_DIR = path.join(__dirname, 'images');
app.use('/images', express.static(IMAGES_DIR));
app.use(express.static(PUBLIC_DIR, { index: false }));

app.get('/', (req, res) => {
  if (req.session?.userId) return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  res.redirect('/login');
});
app.get('/login', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'login.html')));

// SPA fallback for any other non-API path (client-side routing).
app.get(/^\/(?!api\/).*/, (req, res) => {
  if (!req.session?.userId) return res.redirect('/login');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ---------------------------------------------------------------------
// Background workers (poll on an interval, same shape for each):
//   - Google Sheet watchers (crm_sheet_watchers)
//   - Due scheduled posts (crm_scheduled_posts)
// ---------------------------------------------------------------------
const SHEET_POLL_MS = 60 * 1000;
setInterval(() => {
  sheetsService.pollWatchers((watcher, row) => sheetsService.sendForMatch(watcher, row))
    .catch((err) => console.error('[sheets] poll tick failed:', err.message));
}, SHEET_POLL_MS);

const SCHEDULE_POLL_MS = 60 * 1000;
setInterval(() => {
  scheduleService.pollDuePosts(resolveFirstUserId)
    .catch((err) => console.error('[schedule] poll tick failed:', err.message));
}, SCHEDULE_POLL_MS);

// Graph's /insights edge is rate-limited per app — polling every request
// (like the original repo did) isn't viable at any real scale, hence the
// cache-table + periodic-snapshot design (see modules/insights/service.js).
const INSIGHTS_POLL_MS = 60 * 60 * 1000;
setInterval(() => {
  insightsService.pollInsights().catch((err) => console.error('[insights] poll tick failed:', err.message));
}, INSIGHTS_POLL_MS);
insightsService.pollInsights().catch((err) => console.error('[insights] initial poll failed:', err.message));

// Follow-ups (crm_followups) are due-timestamped, not interval-based like
// the other pollers, so this runs frequently — a follow-up due at 2:03pm
// shouldn't wait up to an hour to actually go out.
const FOLLOWUP_POLL_MS = 5 * 60 * 1000;
setInterval(() => {
  automationsService.checkFollowUps().catch((err) => console.error('[automations] follow-up poll tick failed:', err.message));
}, FOLLOWUP_POLL_MS);

const PORT = process.env.PORT || 3000;

// Resolve this instance's own public URL so the keepalive ping below can
// reach it. Render sets RENDER_EXTERNAL_URL (already a full https:// URL).
// Railway sets RAILWAY_PUBLIC_DOMAIN (bare host, e.g. "myapp.up.railway.app"
// — no scheme) on current deployments, or the older RAILWAY_STATIC_URL on
// legacy ones; either needs https:// prepended if missing. APP_BASE_URL is
// the manual override (also what shared/metaConnections.js uses to build
// OAuth redirect_uris), so prefer it if the person set it explicitly.
function resolveSelfUrl() {
  const candidate = process.env.APP_BASE_URL
    || process.env.RENDER_EXTERNAL_URL
    || process.env.RAILWAY_PUBLIC_DOMAIN
    || process.env.RAILWAY_STATIC_URL
    || `http://localhost:${PORT}`;
  return /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
}
const SELF_URL = resolveSelfUrl().replace(/\/$/, '');

app.listen(PORT, () => {
  console.log(`CRM backend listening on :${PORT}`);

  // Keepalive: Render's free tier (and Railway's sleep-on-idle apps) spin
  // down after ~15 min with no inbound traffic, which would otherwise kill
  // background workers (sheet polling, schedule polling below) and cause a
  // cold-start delay on the next real request. Only run this against a real
  // public URL — pinging localhost during local dev is pointless.
  if (SELF_URL.includes('localhost') || SELF_URL.includes('127.0.0.1')) return;
  const PING_INTERVAL_MS = 14 * 60 * 1000; // under Render free tier's 15 min idle timeout
  setInterval(() => {
    fetch(`${SELF_URL}/health`)
      .then(() => console.log('[health] self-ping sent'))
      .catch((err) => console.error('[health] self-ping failed:', err.message));
  }, PING_INTERVAL_MS);
});

module.exports = app;