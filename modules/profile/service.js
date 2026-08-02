// modules/profile/service.js — GET/PUT /api/profile, GET /api/client
const { supabase } = require('../../shared/db');
const { getConnectionsSummary } = require('../../shared/connectionsSummary');

async function getProfile(userId, userEmail) {
  const { data: profile, error } = await supabase.from('crm_profiles')
    .select('id, full_name, email, role, client_id').eq('id', userId).single();
  if (error) throw new Error(error.message);

  const connections = await getConnectionsSummary(userId);

  // `channels` is kept for backwards compatibility with anything still
  // reading it; `connections` is the richer shape (icon + actual connected
  // account name per platform) the Sources and Profile tabs use.
  const channels = connections.map((c) => c.label);

  return {
    user: {
      id: profile.id, name: profile.full_name || userEmail.split('@')[0],
      email: profile.email || userEmail, role: profile.role || 'client',
      channels, connections,
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
