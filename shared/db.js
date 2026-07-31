// shared/db.js — single Supabase client (service role) used by every module.
//
// Every module talks to Postgres through Supabase's REST API (PostgREST),
// never a raw `pg` connection — this avoids the pg/IPv6 connectivity issues
// that Render (and some other hosts) have with direct Postgres connections,
// and it means every module can be deployed anywhere without VPC/network
// config. If you're not using Supabase, swap this file for a `pg` Pool and
// keep the same `.from(table).select()/.insert()/.update()` call shape by
// pointing modules at a small compatibility wrapper — nothing else needs to
// change since modules only ever import `supabase` from here.
// Supabase's realtime client requires a native `WebSocket` global, which only
// exists in Node 22+. Polyfill it on older runtimes so startup doesn't crash
// (see: https://github.com/orgs/supabase/discussions/45715).
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = require('ws');
}

const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars. ' +
    'These are the service-role (not anon) credentials — every module trusts ' +
    'this client to bypass RLS, since access control happens in shared/auth.js.'
  );
}

// Service-role client: bypasses Row Level Security. Access control for
// end-users happens in shared/auth.js's requireAuth middleware, not here.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// A throwaway anon-key client for one-off password sign-ins (see shared/auth.js).
// IMPORTANT: never call .auth.signInWithPassword on the shared service-role
// client above — doing so silently swaps its in-memory session to the signed-in
// user's (RLS-restricted) session for ALL subsequent calls on that instance.
function createAuthClient() {
  if (!process.env.SUPABASE_ANON_KEY) {
    throw new Error('Missing SUPABASE_ANON_KEY env var (needed for login sign-in calls).');
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

module.exports = { supabase, createAuthClient };
