// shared/clientContext.js — resolves req.clientId for every CRM-layer route
// (leads, contacts, inbox, templates, automations, settings, integrations,
// schedule, insights). Mount AFTER requireAuth:
//   router.use(requireAuth, requireClient)
//
// crm_profiles.client_id (schema_full.sql / 002_crmsuite.sql) is the source
// of truth. There's no separate admin app wired up yet to create clients and
// assign users to them, so on first request from a brand-new user we lazily
// provision a crm_clients row and link it — this keeps the single-tenant
// case (one login = one business) working out of the box. If you build the
// multi-client admin app later, replace the auto-create block with a lookup
// only, and 403 when a profile has no client_id.
const { supabase } = require('./db');

async function requireClient(req, res, next) {
  try {
    const { data: profile, error } = await supabase
      .from('crm_profiles')
      .select('id, client_id, full_name, email')
      .eq('id', req.user.id)
      .maybeSingle();
    if (error) throw error;

    let clientId = profile?.client_id;

    if (!profile) {
      // requireAuth verified the user against Supabase Auth but no
      // crm_profiles row exists yet (e.g. account created before this
      // migration, or created directly in Supabase Auth). Create one.
      await supabase.from('crm_profiles').upsert({
        id: req.user.id, email: req.user.email,
        full_name: req.user.email.split('@')[0],
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
    }

    if (!clientId) {
      const { data: client, error: clientErr } = await supabase
        .from('crm_clients')
        .insert({ name: (profile?.full_name || req.user.email.split('@')[0]) + "'s Workspace", role: 'Client' })
        .select('id').single();
      if (clientErr) throw clientErr;
      clientId = client.id;
      await supabase.from('crm_profiles').update({ client_id: clientId }).eq('id', req.user.id);
    }

    req.clientId = clientId;
    next();
  } catch (err) {
    res.status(500).json({ error: `Failed to resolve client: ${err.message}` });
  }
}

module.exports = { requireClient };
