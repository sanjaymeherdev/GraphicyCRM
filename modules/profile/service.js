// modules/profile/service.js — GET/PUT /api/profile, GET /api/client
const { supabase } = require('../../shared/db');

async function getProfile(userId, userEmail) {
  const { data: profile, error } = await supabase.from('crm_profiles')
    .select('id, full_name, email, role, client_id').eq('id', userId).single();
  if (error) throw new Error(error.message);

  const { data: connections } = await supabase.from('crm_connections')
    .select('platform').eq('user_id', userId).eq('is_connected', true);
  const { data: waAccounts } = await supabase.from('crm_wa_accounts')
    .select('id').eq('user_id', userId).eq('is_active', true).limit(1);
  const { data: googleToken } = await supabase.from('crm_oauth_tokens')
    .select('id').eq('user_id', userId).eq('service', 'google').maybeSingle();

  const channels = [
    ...(waAccounts?.length ? ['WhatsApp'] : []),
    ...(connections || []).map((c) => c.platform[0].toUpperCase() + c.platform.slice(1)),
    ...(googleToken ? ['Gmail'] : []),
  ];

  return {
    user: {
      id: profile.id, name: profile.full_name || userEmail.split('@')[0],
      email: profile.email || userEmail, role: profile.role || 'client', channels,
    },
  };
}

async function updateProfile(userId, { full_name, email }) {
  const patch = { updated_at: new Date().toISOString() };
  if (full_name !== undefined) patch.full_name = full_name;
  if (email !== undefined) patch.email = email;
  const { data, error } = await supabase.from('crm_profiles').update(patch).eq('id', userId).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function getMyClient(clientId) {
  const { data, error } = await supabase.from('crm_clients').select('id, name, role').eq('id', clientId).single();
  if (error) throw new Error(error.message);
  return { client: data };
}

module.exports = { getProfile, updateProfile, getMyClient };
