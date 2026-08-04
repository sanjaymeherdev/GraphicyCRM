// modules/interactive-templates/service.js — WhatsApp interactive message
// templates (button / list / cta_url), ported from src/interactive-templates.js.
// Kept separate from modules/templates (plain text/caption templates) since
// the `config` shape here mirrors Meta's WhatsApp Cloud API interactive
// object one-to-one, and only applies to WhatsApp.
const { supabase } = require('../../shared/db');

const VALID_TYPES = ['button', 'list', 'cta_url'];

function validateConfig(interactive_type, config) {
  if (!VALID_TYPES.includes(interactive_type)) throw new Error(`interactive_type must be one of ${VALID_TYPES.join(', ')}`);
  if (!config || !config.body) throw new Error('config.body is required');
  if (interactive_type === 'button' && (!Array.isArray(config.buttons) || config.buttons.length === 0 || config.buttons.length > 3)) {
    throw new Error('config.buttons must be an array of 1-3 buttons for interactive_type "button"');
  }
  if (interactive_type === 'list' && (!Array.isArray(config.sections) || config.sections.length === 0)) {
    throw new Error('config.sections must be a non-empty array for interactive_type "list"');
  }
  if (interactive_type === 'cta_url' && !config.url) {
    throw new Error('config.url is required for interactive_type "cta_url"');
  }
}

async function listTemplates(clientId) {
  const { data, error } = await supabase.from('crm_interactive_templates').select('*').eq('client_id', clientId).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

async function createTemplate(clientId, body) {
  const { name, interactive_type, config } = body || {};
  if (!name) throw new Error('name is required');
  validateConfig(interactive_type, config);
  const { data, error } = await supabase.from('crm_interactive_templates').insert({
    client_id: clientId, name, interactive_type, config,
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function updateTemplate(clientId, id, patch) {
  const allowed = ['name', 'interactive_type', 'config'];
  const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => allowed.includes(k)));
  if (clean.interactive_type || clean.config) {
    const { data: existing, error: exErr } = await supabase.from('crm_interactive_templates').select('*').eq('id', id).eq('client_id', clientId).single();
    if (exErr || !existing) throw new Error('Template not found');
    validateConfig(clean.interactive_type || existing.interactive_type, clean.config || existing.config);
  }
  clean.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('crm_interactive_templates').update(clean).eq('id', id).eq('client_id', clientId).select().single();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Template not found');
  return data;
}

async function deleteTemplate(clientId, id) {
  const { error } = await supabase.from('crm_interactive_templates').delete().eq('id', id).eq('client_id', clientId);
  if (error) throw new Error(error.message);
}

/** Converts a stored template into the exact object WhatsApp Cloud API's
 * messages endpoint expects under `interactive`. Used by modules/whatsapp
 * when sending a reply that references an interactive_template_id. */
function toWhatsAppPayload(template) {
  const { interactive_type, config } = template;
  const base = { type: interactive_type === 'cta_url' ? 'cta_url' : interactive_type, body: { text: config.body } };
  if (config.header) base.header = { type: 'text', text: config.header };
  if (config.footer) base.footer = { text: config.footer };
  if (interactive_type === 'button') base.action = { buttons: config.buttons.map((b, i) => ({ type: 'reply', reply: { id: b.id || `btn_${i}`, title: b.title } })) };
  if (interactive_type === 'list') base.action = { button: config.listButtonText || 'Choose', sections: config.sections };
  if (interactive_type === 'cta_url') base.action = { name: 'cta_url', parameters: { display_text: config.buttonText || 'Open', url: config.url } };
  return base;
}

module.exports = { listTemplates, createTemplate, updateTemplate, deleteTemplate, toWhatsAppPayload };
