// modules/flows/service.js — visual multi-step automation builder.
// Ported from src/routes/flows.js (MetaWhatsappAPI). A flow is a JSON graph
// of steps; runFlow() below walks it linearly for now (message/delay/
// condition/action nodes) — a real drag-drop branching UI can still write
// to the same `steps` shape later without a backend change.
const { supabase } = require('../../shared/db');

async function listFlows(clientId) {
  const { data, error } = await supabase.from('crm_flows').select('*').eq('client_id', clientId).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

async function createFlow(clientId, body) {
  const { name, trigger_type, trigger_value, channels, steps } = body || {};
  if (!name) throw new Error('name is required');
  const { data, error } = await supabase.from('crm_flows').insert({
    client_id: clientId, name, trigger_type: trigger_type || 'keyword', trigger_value: trigger_value || null,
    channels: channels || [], steps: steps || [],
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function updateFlow(clientId, id, patch) {
  const allowed = ['name', 'trigger_type', 'trigger_value', 'channels', 'steps', 'active'];
  const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => allowed.includes(k)));
  clean.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('crm_flows').update(clean).eq('id', id).eq('client_id', clientId).select().single();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Flow not found');
  return data;
}

async function deleteFlow(clientId, id) {
  const { error } = await supabase.from('crm_flows').delete().eq('id', id).eq('client_id', clientId);
  if (error) throw new Error(error.message);
}

/**
 * Finds the first active flow whose trigger matches inbound text on this
 * channel. Keyword trigger_value is matched case-insensitively as a
 * substring, same rule modules/automations already uses, so behavior is
 * familiar to anyone who's used that module.
 */
async function matchFlow(clientId, { channel, text }) {
  if (!text) return null;
  const { data, error } = await supabase.from('crm_flows').select('*')
    .eq('client_id', clientId).eq('active', true).eq('trigger_type', 'keyword').contains('channels', [channel]);
  if (error) throw new Error(error.message);
  const lower = text.toLowerCase();
  return (data || []).find((f) => f.trigger_value && lower.includes(f.trigger_value.toLowerCase())) || null;
}

/**
 * Walks a flow's steps linearly and returns the list of actions the caller
 * should perform (send message / wait / run action) — this function never
 * sends anything itself, it stays a pure function so callers (webhooks,
 * a future test-run button) can execute steps however fits their context.
 * `condition` steps short-circuit the walk if their check fails.
 */
function planFlowRun(flow, context = {}) {
  const plan = [];
  for (const step of flow.steps || []) {
    if (step.type === 'condition') {
      const value = context[step.field];
      const passes = step.op === 'equals' ? value === step.value
        : step.op === 'contains' ? String(value || '').includes(step.value)
        : true;
      if (!passes) break;
      continue;
    }
    plan.push(step);
  }
  return plan;
}

module.exports = { listFlows, createFlow, updateFlow, deleteFlow, matchFlow, planFlowRun };
