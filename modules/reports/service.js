// modules/reports/service.js — GET /api/reports
// A simple lead-funnel-by-source-and-status report over a date range.
const { supabase } = require('../../shared/db');

async function getReport(clientId, { from, to } = {}) {
  let q = supabase.from('crm_leads').select('source, status, created_at').eq('client_id', clientId);
  if (from) q = q.gte('created_at', from);
  if (to) q = q.lte('created_at', to);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const bySource = {};
  const byStatus = {};
  for (const lead of data || []) {
    bySource[lead.source] = (bySource[lead.source] || 0) + 1;
    byStatus[lead.status] = (byStatus[lead.status] || 0) + 1;
  }
  return { total: data.length, bySource, byStatus, range: { from: from || null, to: to || null } };
}

module.exports = { getReport };
