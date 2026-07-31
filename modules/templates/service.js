// modules/templates/service.js — CRUD /api/templates
const { supabase } = require('../../shared/db');

async function listTemplates(clientId) {
  const { data, error } = await supabase.from('crm_templates').select('*').eq('client_id', clientId).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

async function createTemplate(clientId, { name, type, body, footer, meta_template_name }) {
  if (!name) throw new Error('name is required');
  const { data, error } = await supabase.from('crm_templates').insert({
    client_id: clientId, name, type: type || 'plaintext', body: body || '',
    footer: footer || null, meta_template_name: meta_template_name || null,
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function updateTemplate(clientId, id, patch) {
  const allowed = ['name', 'type', 'body', 'footer', 'meta_template_name'];
  const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => allowed.includes(k)));
  clean.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('crm_templates').update(clean)
    .eq('id', id).eq('client_id', clientId).select().single();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Template not found');
  return data;
}

async function deleteTemplate(clientId, id) {
  const { error } = await supabase.from('crm_templates').delete().eq('id', id).eq('client_id', clientId);
  if (error) throw new Error(error.message);
}

module.exports = { listTemplates, createTemplate, updateTemplate, deleteTemplate };
