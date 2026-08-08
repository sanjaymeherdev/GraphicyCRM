// modules/admin-drive/routes.js — operator-only routes to (re)connect the
// shared owner Google Drive account used for scheduled-post media storage
// (see shared/ownerDriveToken.js, modules/media/routes.js). Ported from
// sanjayaidev/MetaWhatsappAPI's sm/routes/admin-drive.js.
//
// Gated by the SAME ADMIN_SECRET already used by /api/auth/register (see
// shared/auth.js) rather than a separate secret — one admin credential for
// this deployment, not two. Not tied to the normal Supabase-session
// requireAuth at all; this is server-operator infrastructure.
//
// Two ways to connect, both landing on ownerDriveToken.setRefreshToken:
//   1. "Connect with Google" — real OAuth flow requesting ONLY the narrow
//      drive.file scope (separate from shared/googleAuth.js's approved
//      per-user scope list — see that file's comment on why drive/drive.file
//      isn't in it). The preferred path.
//   2. Manual paste box — for pasting a refresh token obtained elsewhere
//      (e.g. OAuth Playground), a fallback for when a browser redirect
//      through this server isn't convenient.
// Either way this is a manual, operator-initiated action — no auto-rotation
// cron. Re-run whichever flow whenever Google invalidates the refresh token
// (unverified/Testing-mode OAuth clients: it expires after 7 days of
// account inactivity).
const express = require('express');
const fetch = require('node-fetch');
const ownerDriveToken = require('../../shared/ownerDriveToken');

const APP_BASE_URL = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const REDIRECT_URI = `${APP_BASE_URL}/admin/drive/callback`;
// drive.file only (not full Drive scope) — matches what shared/googleDrive.js
// actually needs: create/read/delete files this app itself created, nothing
// else in the owner's Drive.
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

function requireAdminSecret(req, res, next) {
  const secret = req.headers['x-admin-secret'] || req.query.key || req.body?.key;
  if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Forbidden: invalid or missing admin secret' });
  }
  next();
}

// State just needs to survive the round-trip through Google's redirect
// (which won't carry our x-admin-secret header) — same unsigned
// base64url(JSON) pattern as shared/googleAuth.js's parseState, since the
// actual authorization boundary is knowing ADMIN_SECRET in the first place,
// not the state value itself.
function packState(key) {
  return Buffer.from(JSON.stringify({ key, exp: Date.now() + 10 * 60 * 1000 })).toString('base64url');
}
function unpackState(state) {
  const payload = JSON.parse(Buffer.from(String(state), 'base64url').toString('utf8'));
  if (!payload.exp || Date.now() > payload.exp) throw new Error('Connect request expired — go back to /admin/drive and try again.');
  return payload;
}

// Mounted at /admin — the OAuth kickoff + callback. (The page itself is the
// static public/admin/drive.html, same convention as public/admin/register.html.)
function pageRouter() {
  const r = express.Router();

  // Kicks off the real Google consent screen. access_type=offline +
  // prompt=consent guarantees a refresh_token comes back even if this
  // Google account consented to this app before.
  r.get('/drive/authorize', requireAdminSecret, (req, res) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.status(500).send('Google isn\u2019t configured on this server — set GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET.');
    }
    const state = packState(req.query.key);
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: DRIVE_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  // Google redirects the browser here directly — no custom headers, so auth
  // is the state payload, not requireAdminSecret.
  r.get('/drive/callback', async (req, res) => {
    const { code, state, error: googleError } = req.query;
    let payload;
    try {
      payload = unpackState(state);
    } catch (err) {
      return res.status(400).send(err.message || 'Invalid or expired connect request — go back to /admin/drive and try again.');
    }
    const key = payload.key;
    const back = (qs) => res.redirect(`/admin/drive.html?key=${encodeURIComponent(key)}&${qs}`);

    if (googleError) return back(`error=${encodeURIComponent(googleError)}`);
    if (!code) return back('error=No authorization code returned by Google');

    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          grant_type: 'authorization_code',
          code,
        }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) throw new Error(tokenData.error_description || tokenData.error || 'Google token exchange failed');

      if (!tokenData.refresh_token) {
        return back('error=' + encodeURIComponent('Google did not return a refresh token — revoke this app\u2019s access at myaccount.google.com/permissions and try again.'));
      }
      await ownerDriveToken.setRefreshToken(tokenData.refresh_token);
      return back('connected=1');
    } catch (err) {
      return back('error=' + encodeURIComponent(err.message));
    }
  });

  return r;
}

// Mounted at /api/admin/drive — status + manual-save endpoints the
// public/admin/drive.html page calls.
function apiRouter() {
  const r = express.Router();

  r.get('/status', requireAdminSecret, async (req, res) => {
    try {
      res.json(await ownerDriveToken.getStatus());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  r.post('/token', requireAdminSecret, async (req, res) => {
    try {
      const { refresh_token } = req.body || {};
      if (!refresh_token) return res.status(400).json({ error: 'refresh_token is required' });
      const result = await ownerDriveToken.setRefreshToken(refresh_token);
      res.json(result);
    } catch (err) {
      const message = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      res.status(400).json({ error: message });
    }
  });

  return r;
}

module.exports = { pageRouter, apiRouter };
