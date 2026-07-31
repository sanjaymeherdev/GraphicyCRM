// modules/dashboard/service.js — GET /api/dashboard/stats
const { supabase } = require('../../shared/db');

async function getStats(clientId) {
  const { data, error } = await supabase.from('crm_leads').select('status').eq('client_id', clientId);
  if (error) throw new Error(error.message);
  const counts = { total: data.length, converted: 0, lost: 0, pending: 0 };
  for (const { status } of data) {
    if (status === 'converted') counts.converted++;
    else if (status === 'lost') counts.lost++;
    else counts.pending++;
  }
  return counts;
}

module.exports = { getStats };
