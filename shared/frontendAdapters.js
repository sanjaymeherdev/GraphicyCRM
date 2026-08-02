// shared/frontendAdapters.js — small routes that exist only to match
// js/api.js's endpoint names, wrapping functionality that already lives
// elsewhere (the individual OAuth connect flows, WhatsApp verify, theme).
const express = require('express');
const { requireAuth } = require('./auth');
const { buildGoogleAuthUrl, disconnectGoogle } = require('./googleAuth');
const metaConnections = require('./metaConnections');
const whatsapp = require('../modules/whatsapp/service');

const router = express.Router();

// --- Theme: cosmetic only, not part of schema_full.sql — served as a
// static default. If you want it to persist per-client, add a `theme jsonb`
// column to crm_settings and swap this for reads/writes through that.
const DEFAULT_THEME = {
  primary: '#22d172', primaryDark: '#1bbf64', bg: '#080b10', bg2: '#0c1018',
  surface: '#0f1520', surface2: '#141c2a', surface3: '#1a2335',
  border: '#1e2d42', border2: '#263550', text: '#e8f0fb', text2: '#7a90b0',
  text3: '#445570', green: '#22d172', amber: '#f5a623', red: '#f04f6e',
  blue: '#3d8ef5', purple: '#9d78fa', pink: '#ec4899',
  radius: '16px', radiusSm: '10px', fontFamily: "'DM Sans', sans-serif", isDark: true,
};
router.get('/theme', (_req, res) => res.json(DEFAULT_THEME));
router.post('/theme', requireAuth, (_req, res) => res.json({ success: true }));

// --- OAuth: js/modules/sources.js calls GET /api/oauth/:service/url for
// google/facebook/instagram; each platform's own /api/<platform>/connect
// (mounted per-module) does the same thing — this just gives it the name
// the frontend expects, without a duplicate implementation.
router.get('/oauth/:service/url', requireAuth, (req, res) => {
  const { service } = req.params;
  try {
    if (service === 'google') return res.json({ url: buildGoogleAuthUrl(req.user.id, req.query.return_to) });
    if (['facebook', 'instagram', 'threads', 'linkedin'].includes(service)) {
      return res.json({ url: metaConnections.buildAuthUrl(service, req.user.id, req.query.return_to) });
    }
    res.status(400).json({ error: `Unknown OAuth service "${service}"` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- Disconnect: js/modules/sources.js's "Disconnect" buttons call this
// for every OAuth-based source. WhatsApp isn't included here — it can have
// more than one connected number, so it's disconnected per-account via
// DELETE /api/whatsapp/accounts/:id instead (see Sources.disconnectWhatsApp).
router.delete('/oauth/:service', requireAuth, async (req, res) => {
  const { service } = req.params;
  try {
    if (service === 'google') { await disconnectGoogle(req.user.id); return res.json({ success: true }); }
    if (['facebook', 'instagram', 'threads', 'linkedin'].includes(service)) {
      await metaConnections.disconnectConnection(req.user.id, service);
      return res.json({ success: true });
    }
    res.status(400).json({ error: `Unknown OAuth service "${service}"` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- WhatsApp: js/modules/sources.js calls POST /api/wa/verify — same as
// POST /api/whatsapp/accounts/verify, just a shorter path.
router.post('/wa/verify', requireAuth, async (req, res) => {
  const { waba_id, access_token } = req.body || {};
  if (!waba_id || !access_token) return res.status(400).json({ error: 'waba_id and access_token required' });
  try { res.json({ success: true, numbers: await whatsapp.verifyWaba(waba_id, access_token) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
