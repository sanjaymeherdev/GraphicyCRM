// modules/settings/service.js — GET/POST /api/settings (crm_settings)
const { supabase } = require('../../shared/db');

const DEFAULTS = {
  ai_model: 'mistralai/mistral-small-4-119b-2603',
  system_prompt: 'You are a helpful CRM assistant.',
  channels: [],
  notifications: { email: true, push: false, weekly: true },
};

async function getSettings(clientId) {
  const { data, error } = await supabase.from('crm_settings').select('*').eq('client_id', clientId).maybeSingle();
  if (error) throw new Error(error.message);
  return data || { client_id: clientId, ...DEFAULTS };
}

async function saveSettings(clientId, patch) {
  const allowed = ['ai_model', 'system_prompt', 'channels', 'notifications'];
  const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => allowed.includes(k)));

  const existing = await getSettings(clientId);
  const merged = {
    ...existing, ...clean,
    // Notifications is partial-update friendly (frontend sends {weekly: true} alone).
    notifications: clean.notifications ? { ...existing.notifications, ...clean.notifications } : existing.notifications,
    client_id: clientId, updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from('crm_settings').upsert(merged, { onConflict: 'client_id' }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

module.exports = { getSettings, saveSettings };
