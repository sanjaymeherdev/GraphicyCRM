// modules/insights/service.js — GET /api/insights/account|posts|snapshots,
// reading from the cache tables (crm_insights_snapshots, crm_post_insights)
// per schema_full.sql's note: Graph's /insights edge is rate-limited, so a
// background poller snapshots it rather than fetching live per request.
const { supabase } = require('../../shared/db');

async function getAccountInsights(clientId, platform) {
  const { data, error } = await supabase.from('crm_insights_snapshots')
    .select('*').eq('client_id', clientId).eq('platform', platform)
    .order('captured_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { data: {} };
  return { data: { followers: data.followers, ...data.metrics } };
}

async function getPostInsights(clientId, platform) {
  const { data, error } = await supabase.from('crm_post_insights')
    .select('*').eq('client_id', clientId).eq('platform', platform)
    .order('posted_at', { ascending: false }).limit(25);
  if (error) throw new Error(error.message);
  return {
    data: (data || []).map((p) => ({
      id: p.external_post_id, caption: p.caption, message: p.caption, date: p.posted_at,
      thumbnail: p.thumbnail, likes: p.likes, comments: p.comments, shares: p.shares,
      saves: p.saves, reach: p.reach, views: p.views, replies: p.replies,
      reposts: p.reposts, quotes: p.quotes, platform,
    })),
  };
}

async function getSnapshots(clientId, platform) {
  let q = supabase.from('crm_insights_snapshots').select('captured_at, followers, metrics').eq('client_id', clientId).order('captured_at', { ascending: true }).limit(90);
  if (platform) q = q.eq('platform', platform);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return { snapshots: data || [] };
}

module.exports = { getAccountInsights, getPostInsights, getSnapshots };
