// shared/connectionsSummary.js — single place that assembles "what's
// connected" across every channel, for:
//   - the Sources tab (js/modules/sources.js) — flips a "Connect" button to
//     "Connected" once a platform has an active connection.
//   - the Profile tab (js/modules/profile.js) — lists every connected
//     account with its platform icon/name and the actual account connected
//     (phone number, page name, @handle, email...).
//
// Purely a read-side aggregation — it doesn't write anything. Each
// platform's own connect flow (shared/googleAuth.js, shared/metaConnections.js,
// modules/whatsapp/service.js) is still what writes crm_oauth_tokens /
// crm_connections / crm_wa_accounts; this just reads them all back in one
// consistent shape.
const { supabase } = require('./db');

const PLATFORM_META = {
  whatsapp: { icon: '📱', label: 'WhatsApp' },
  facebook: { icon: '👥', label: 'Facebook' },
  instagram: { icon: '📷', label: 'Instagram' },
  threads: { icon: '🧵', label: 'Threads' },
  linkedin: { icon: '💼', label: 'LinkedIn' },
  // One Google connection (shared/googleAuth.js) lights up Gmail, Sheets,
  // Docs, and Drive together — see shared/googleAuth.js's GOOGLE_SCOPES.
  google: { icon: '📧', label: 'Google (Gmail, Sheets, Docs, Drive)' },
};

// Returns one row per connected account, e.g.:
// [{ platform: 'whatsapp', icon: '📱', label: 'WhatsApp', account_name: '+1 555…', connected_at }, ...]
async function getConnectionsSummary(userId) {
  const [connRes, waRes, googleRes] = await Promise.all([
    supabase.from('crm_connections')
      .select('platform, account_name, account_id, updated_at')
      .eq('user_id', userId).eq('is_connected', true),
    supabase.from('crm_wa_accounts')
      .select('id, display_name, phone_number, updated_at')
      .eq('user_id', userId).eq('is_active', true),
    supabase.from('crm_oauth_tokens')
      .select('account_email, updated_at')
      .eq('user_id', userId).eq('service', 'google').maybeSingle(),
  ]);

  const list = [];

  (waRes.data || []).forEach((w) => {
    list.push({
      platform: 'whatsapp', ...PLATFORM_META.whatsapp,
      account_name: w.display_name || w.phone_number || 'WhatsApp number',
      connected_at: w.updated_at,
      // Internal wa_accounts row id — WhatsApp can have more than one
      // connected number, so disconnecting is per-account (DELETE
      // /api/whatsapp/accounts/:id) rather than per-platform like the rest.
      disconnect_id: w.id,
    });
  });

  (connRes.data || []).forEach((c) => {
    const meta = PLATFORM_META[c.platform] || { icon: '🔗', label: c.platform };
    list.push({
      platform: c.platform, ...meta,
      account_name: c.account_name || c.account_id,
      connected_at: c.updated_at,
    });
  });

  if (googleRes.data) {
    list.push({
      platform: 'google', ...PLATFORM_META.google,
      account_name: googleRes.data.account_email || 'Google account',
      connected_at: googleRes.data.updated_at,
    });
  }

  return list;
}

module.exports = { getConnectionsSummary, PLATFORM_META };
