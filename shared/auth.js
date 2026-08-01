// shared/auth.js — ONE login for every module (whatsapp, facebook, instagram,
// threads, gmail, sheets, docs, ai-bot). The original repo had two separate
// auth systems (Supabase Auth for the main CRM, a hand-rolled smc_users+JWT
// table for the social-manager side) — this collapses them into a single
// Supabase-Auth-backed login, so a person logs in once and every module
// trusts the same session/token.
//
// Two ways to authenticate, checked in this order:
//   1. Cookie session (browser dashboard) — set by POST /api/auth/login
//   2. `Authorization: Bearer <supabase_access_token>` (API clients, mobile,
//      server-to-server) — verified against Supabase on every request
//
// Both resolve to the same req.user = { id, email }.
const express = require('express');
const session = require('express-session');
const { supabase, createAuthClient } = require('./db');

function sessionMiddleware() {
  if (!process.env.SESSION_SECRET) {
    throw new Error('Missing SESSION_SECRET env var (any random string works).');
  }
  return session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  });
}

// Populates req.user for any authenticated request; otherwise 401s.
// Every module route file should mount this in front of protected routes:
//   router.use(requireAuth)
async function requireAuth(req, res, next) {
  // 1) Browser session set by /api/auth/login
  if (req.session && req.session.userId) {
    req.user = { id: req.session.userId, email: req.session.email };
    return next();
  }

  // 2) Bearer token — same Supabase JWT issued at login, so a mobile app or
  // another backend service can call any module's API directly.
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Invalid or expired token' });
    req.user = { id: user.id, email: user.email };
    next();
  } catch (err) {
    res.status(401).json({ error: 'Auth verification failed' });
  }
}

// Mounted at /api/auth — shared by every module, one set of endpoints.
function authRouter() {
  const router = express.Router();

  // Account creation is admin-gated, not open self-signup — matches the
  // original repo's POST /api/admin/create-user + verifyAdmin middleware.
  // A CRM instance shouldn't let any random visitor create their own login;
  // only whoever holds ADMIN_SECRET (set as an env var) can provision users,
  // typically via public/admin/register.html.
  router.post('/register', async (req, res) => {
    const adminSecret = req.headers['x-admin-secret'] || req.body?.admin_secret;
    if (!process.env.ADMIN_SECRET || adminSecret !== process.env.ADMIN_SECRET) {
      return res.status(403).json({ error: 'Forbidden: invalid admin secret' });
    }
    const { email, password, full_name } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    try {
      const { data, error } = await supabase.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { full_name: full_name || email.split('@')[0] },
      });
      if (error) return res.status(400).json({ error: error.message });

      await supabase.from('crm_profiles').upsert({
        id: data.user.id, email, full_name: full_name || email.split('@')[0],
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });

      res.json({ success: true, user: { id: data.user.id, email: data.user.email } });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    try {
      // Sign in on a throwaway anon-key client — never on the shared
      // service-role client (see shared/db.js's comment on why).
      const authClient = createAuthClient();
      const { data, error } = await authClient.auth.signInWithPassword({ email, password });
      if (error || !data?.session) {
        return res.status(401).json({ error: error?.message || 'Invalid credentials' });
      }

      // Same login works for every module — set both a session cookie
      // (dashboard/browser use) and return the JWT (API/mobile use).
      req.session.userId = data.user.id;
      req.session.email = data.user.email;

      res.json({
        success: true,
        token: data.session.access_token,
        user: { id: data.user.id, email: data.user.email },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/logout', (req, res) => {
    req.session?.destroy(() => res.json({ success: true }));
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ success: true, user: req.user });
  });

  return router;
}

module.exports = { sessionMiddleware, requireAuth, authRouter };
