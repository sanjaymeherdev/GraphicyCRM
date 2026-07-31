// modules/integrations/service.js — GET /api/integrations,
// POST /api/integrations/:id/connect (crm_integrations — non-channel
// integrations: Calendly, Manychat, Resend, Webhook Builder, Shopify, Slack)
const { supabase } = require('../../shared/db');

const KNOWN = ['calendly', 'manychat', 'resend', 'webhook_builder', 'shopify', 'slack'];
// The frontend's "connect calendar" quick-action (js/modules/sources.js)
// sends 'calendar' rather than the schema's 'calendly' — alias it here
// instead of changing the already-applied DB check constraint.
const ALIASES = { calendar: 'calendly' };

async function listIntegrations(clientId) {
  const { data, error } = await supabase.from('crm_integrations').select('*').eq('client_id', clientId);
  if (error) throw new Error(error.message);
  const byId = Object.fromEntries((data || []).map((i) => [i.integration_id, i]));
  // Always return all known integrations, connected or not, so the frontend
  // can render a consistent list without needing seed rows.
  return KNOWN.map((id) => byId[id] || { integration_id: id, status: 'disconnected', config: {} });
}

async function connectIntegration(clientId, integrationId, config = {}) {
  integrationId = ALIASES[integrationId] || integrationId;
  if (!KNOWN.includes(integrationId)) throw new Error(`Unknown integration "${integrationId}"`);
  const { data, error } = await supabase.from('crm_integrations').upsert({
    client_id: clientId, integration_id: integrationId, status: 'connected',
    config, connected_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }, { onConflict: 'client_id,integration_id' }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

module.exports = { listIntegrations, connectIntegration };
