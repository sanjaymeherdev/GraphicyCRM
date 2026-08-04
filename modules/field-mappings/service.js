// modules/field-mappings/service.js — maps incoming webform/sheet column
// names to crm_leads fields, ported from src/routes/field-mappings.js.
// Consumed by modules/sheets' watcher (and any future webform intake) so
// they don't assume a fixed column layout.
const { supabase } = require('../../shared/db');

const TARGET_FIELDS = ['name', 'phone', 'email', 'whatsapp', 'instagram', 'facebook', 'notes'];

async function listMappings(clientId, channel) {
  let q = supabase.from('crm_field_mappings').select('*').eq('client_id', clientId).order('created_at', { ascending: true });
  if (channel) q = q.eq('channel', channel);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

async function createMapping(clientId, body) {
  const { channel, source_field, target_field } = body || {};
  if (!channel || !source_field || !target_field) throw new Error('channel, source_field, and target_field are required');
  if (!TARGET_FIELDS.includes(target_field)) throw new Error(`target_field must be one of ${TARGET_FIELDS.join(', ')}`);
  const { data, error } = await supabase.from('crm_field_mappings').insert({ client_id: clientId, channel, source_field, target_field }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function deleteMapping(clientId, id) {
  const { error } = await supabase.from('crm_field_mappings').delete().eq('id', id).eq('client_id', clientId);
  if (error) throw new Error(error.message);
}

/** Applies a client's mappings to one raw row of incoming data, returning a
 * { name, phone, email, ... } object ready for findOrCreateLead. Unmapped
 * source fields are dropped rather than guessed at. */
async function applyMappings(clientId, channel, rawRow) {
  const mappings = await listMappings(clientId, channel);
  const out = {};
  for (const m of mappings) {
    if (rawRow[m.source_field] !== undefined) out[m.target_field] = rawRow[m.source_field];
  }
  return out;
}

module.exports = { listMappings, createMapping, deleteMapping, applyMappings, TARGET_FIELDS };
