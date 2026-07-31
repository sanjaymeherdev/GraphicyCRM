// modules/contacts/service.js — GET/POST /api/contacts
const { supabase } = require('../../shared/db');

async function listContacts(clientId) {
  const { data, error } = await supabase.from('crm_contacts')
    .select('*').eq('client_id', clientId).order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

async function createContact(clientId, { name, phone, email, source, status, lead_id }) {
  const { data, error } = await supabase.from('crm_contacts').insert({
    client_id: clientId, lead_id: lead_id || null, name: name || null, phone: phone || null,
    email: email || null, source: source || 'other', status: status || 'new',
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

module.exports = { listContacts, createContact };
