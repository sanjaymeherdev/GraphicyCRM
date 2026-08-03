// modules/insights/service.js — GET /api/insights/account|posts|snapshots,
// reading from the cache tables (crm_insights_snapshots, crm_post_insights)
// per schema_full.sql's note: Graph's /insights edge is rate-limited, so a
// background poller snapshots it rather than fetching live per request.
// pollInsights() below is that poller — ported from the original repo's
// sm/routes/insights.js, which fetched live on every request; here it runs
// on a timer (see server.js) and writes into the cache tables instead.
const fetch = require('node-fetch');
const { supabase } = require('../../shared/db');
const { decryptToken } = require('../../shared/crypto');

const GRAPH_VERSION = process.env.GRAPH_VERSION || 'v25.0';
const THREADS_VERSION = process.env.THREADS_VERSION || 'v1.0';
const FB_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const IG_BASE = 'https://graph.instagram.com';
const THREADS_BASE = `https://graph.threads.net/${THREADS_VERSION}`;

// Instagram can be connected two ways (Facebook Login -> page_id set ->
// token only works on graph.facebook.com; Direct IG Login -> page_id null
// -> token only works on graph.instagram.com) — mirrors modules/instagram's
// own host-fallback logic.
function instagramHosts(connection) {
  const primary = connection.page_id ? FB_BASE : IG_BASE;
  const fallback = connection.page_id ? IG_BASE : FB_BASE;
  return { primary, fallback };
}

function buildUrl(base, path, params) {
  return `${base}${path}?${new URLSearchParams(params).toString()}`;
}

async function fetchGraph(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) {
    const err = new Error(data.error.message || 'Graph API error');
    err.graphError = data.error;
    err.status = res.status;
    throw err;
  }
  return data;
}

async function fetchWithHostFallback(hosts, path, params) {
  // Code 190 (invalid/expired token) and 401/403 are genuine auth/audience
  // errors — a token issued for one host can legitimately be rejected by
  // the other, so retrying the fallback host is the right move. Code 100
  // is Meta's catch-all "invalid parameter" code and covers everything
  // from a bad metric name to a missing metric_type — NOT a host issue —
  // so it must not trigger a host switch, or a fixable request-shape bug
  // gets misdiagnosed as a bad token (see fetchMetricsResilient's own
  // per-metric handling for code-100 cases that ARE about metric names).
  const isHostMismatch = (err) => [3, 190].includes(err.graphError?.code) || err.status === 401 || err.status === 403;
  try {
    return await fetchGraph(buildUrl(hosts.primary, path, params));
  } catch (primaryErr) {
    if (!hosts.fallback || !isHostMismatch(primaryErr)) throw primaryErr;
    console.warn(`[insights] ${hosts.primary} rejected ${path} (${primaryErr.graphError?.code}: ${primaryErr.graphError?.message}) — retrying via ${hosts.fallback}`);
    try {
      return await fetchGraph(buildUrl(hosts.fallback, path, params));
    } catch (fallbackErr) {
      // Both hosts failed — this is NOT a host-mismatch, the token itself
      // is bad (expired/revoked/corrupted). Tag it so callers/logs can tell
      // the difference from a one-host failure.
      fallbackErr.bothHostsFailed = true;
      fallbackErr.primaryError = primaryErr.graphError?.message;
      throw fallbackErr;
    }
  }
}

// Tolerates individual invalid/unavailable metric names (Meta frequently
// renames/deprecates these) instead of failing the whole request.
async function fetchMetricsResilient(hosts, nodeId, metrics, accessToken, extraParams = {}, edge = 'insights') {
  try {
    const data = await fetchWithHostFallback(hosts, `/${nodeId}/${edge}`, { metric: metrics.join(','), access_token: accessToken, ...extraParams });
    return data.data || [];
  } catch (err) {
    const isInvalidMetric = err.graphError?.code === 100 && /insights metric/i.test(err.graphError?.message || '');
    if (!isInvalidMetric) throw err;
    const results = [];
    for (const metric of metrics) {
      try {
        const data = await fetchWithHostFallback(hosts, `/${nodeId}/${edge}`, { metric, access_token: accessToken, ...extraParams });
        results.push(...(data.data || []));
      } catch (metricErr) {
        console.error(`[insights] skipping unsupported metric "${metric}" for ${nodeId}:`, metricErr.graphError?.message || metricErr.message);
      }
    }
    return results;
  }
}

function toMetricsMap(items) {
  const metrics = {};
  for (const item of items) {
    if (item.values?.length) metrics[item.name] = item.values[item.values.length - 1].value;
    else if (typeof item.total_value?.value !== 'undefined') metrics[item.name] = item.total_value.value;
  }
  return metrics;
}

async function pollAccountInsights(clientId, connection) {
  const platform = connection.platform;
  const pageId = connection.account_id || connection.page_id;
  const accessToken = decryptToken(connection.access_token_enc);
  let followers = 0;
  let metrics = {};

  if (platform === 'instagram') {
    const hosts = instagramHosts(connection);
    try {
      const info = await fetchWithHostFallback(hosts, `/${pageId}`, { fields: 'followers_count,media_count', access_token: accessToken });
      followers = info.followers_count || 0;
    } catch (err) { console.error('[insights] IG followers_count failed:', err.graphError?.message || err.message); }
    // metric_type=total_value is required by Graph API for these metrics
    // at the account level as of v22+ — omitting it returns code 100
    // "should be specified with parameter metric_type=total_value".
    metrics = toMetricsMap(await fetchMetricsResilient(hosts, pageId, ['reach', 'views', 'accounts_engaged'], accessToken, { period: 'day', metric_type: 'total_value' }));
  } else if (platform === 'facebook') {
    const hosts = { primary: FB_BASE, fallback: null };
    metrics = toMetricsMap(await fetchMetricsResilient(hosts, pageId, ['page_views_total', 'page_post_engagements'], accessToken, { period: 'day' }));
    try {
      const info = await fetchGraph(buildUrl(FB_BASE, `/${pageId}`, { fields: 'fan_count', access_token: accessToken }));
      followers = info.fan_count || 0;
    } catch (err) { console.error('[insights] FB fan_count failed:', err.graphError?.message || err.message); }
  } else if (platform === 'threads') {
    const hosts = { primary: THREADS_BASE, fallback: null };
    metrics = toMetricsMap(await fetchMetricsResilient(hosts, pageId, ['views', 'likes', 'replies', 'reposts', 'quotes', 'followers_count'], accessToken, { period: 'day' }, 'threads_insights'));
    followers = metrics.followers_count || 0;
  }

  // One row per client/platform/day, overwritten within the same UTC day.
  const now = new Date();
  const snapshotDate = now.toISOString().slice(0, 10);
  const { error } = await supabase.from('crm_insights_snapshots')
    .upsert({
      client_id: clientId, platform, account_id: pageId, followers, metrics,
      captured_at: now.toISOString(), snapshot_date: snapshotDate,
    }, { onConflict: 'client_id,platform,snapshot_date' });
  if (error) throw new Error(error.message);
}

async function pollPostInsights(clientId, connection) {
  const platform = connection.platform;
  const pageId = connection.account_id || connection.page_id;
  const accessToken = decryptToken(connection.access_token_enc);
  let posts = [];

  if (platform === 'instagram') {
    const hosts = instagramHosts(connection);
    const data = await fetchWithHostFallback(hosts, `/${pageId}/media`, { fields: 'id,caption,timestamp,thumbnail_url,media_url,like_count,comments_count', limit: 25, access_token: accessToken });
    posts = (data.data || []).map((p) => ({
      external_post_id: p.id, caption: p.caption || '', posted_at: p.timestamp, thumbnail: p.thumbnail_url || p.media_url,
      likes: p.like_count || 0, comments: p.comments_count || 0,
    }));
  } else if (platform === 'facebook') {
    const data = await fetchGraph(buildUrl(FB_BASE, `/${pageId}/posts`, {
      fields: 'id,message,created_time,permalink_url,reactions.summary(true),comments.summary(true),shares,attachments{media{image{src}}}',
      limit: 25, access_token: accessToken,
    }));
    posts = (data.data || []).map((p) => ({
      external_post_id: p.id, caption: p.message || '', posted_at: p.created_time, permalink: p.permalink_url,
      thumbnail: p.attachments?.data?.[0]?.media?.image?.src || null,
      likes: p.reactions?.summary?.total_count || 0, comments: p.comments?.summary?.total_count || 0, shares: p.shares?.count || 0,
    }));
  } else if (platform === 'threads') {
    const data = await fetchGraph(buildUrl(THREADS_BASE, `/${pageId}/threads`, {
      fields: 'id,text,timestamp,permalink_url,like_count,reply_count,repost_count,quote_count,threads_media{image_url,video_url}',
      limit: 25, access_token: accessToken,
    }));
    posts = (data.data || []).map((p) => ({
      external_post_id: p.id, caption: p.text || '', posted_at: p.timestamp, permalink: p.permalink_url,
      thumbnail: p.threads_media?.[0]?.image_url || p.threads_media?.[0]?.video_url || null,
      likes: p.like_count || 0, comments: p.reply_count || 0, replies: p.reply_count || 0, reposts: p.repost_count || 0, quotes: p.quote_count || 0,
    }));
  }

  for (const post of posts) {
    const { error } = await supabase.from('crm_post_insights')
      .upsert({ client_id: clientId, platform, ...post }, { onConflict: 'client_id,platform,external_post_id' });
    if (error) console.error(`[insights] failed to upsert post ${post.external_post_id}:`, error.message);
  }
}

/** Snapshots account + post insights for every connected facebook/instagram/threads
 * account, across all clients. Called on a timer from server.js — Graph's insights
 * edge is rate-limited, so this shouldn't run more than a few times an hour. */
async function pollInsights() {
  const { resolveClientId } = require('../../shared/crmMessages');
  const { data: connections, error } = await supabase.from('crm_connections')
    .select('*').eq('is_connected', true).in('platform', ['facebook', 'instagram', 'threads']);
  if (error) throw new Error(error.message);

  for (const connection of connections || []) {
    let clientId;
    try {
      clientId = await resolveClientId(connection.user_id);
    } catch (err) {
      console.warn(`[insights] skipping connection ${connection.id}: ${err.message}`);
      continue;
    }
    try {
      await pollAccountInsights(clientId, connection);
      await pollPostInsights(clientId, connection);
    } catch (err) {
      const reason = err.bothHostsFailed
        ? `${err.graphError?.message || err.message} — failed on BOTH graph.facebook.com and graph.instagram.com, so this is a bad/expired token, not a host-routing issue. Reconnect the account.`
        : (err.graphError?.message || err.message);
      console.error(`[insights] poll failed for ${connection.platform} connection ${connection.id}:`, reason);
    }
  }
}

async function getAccountInsights(clientId, platform, { fresh = false } = {}) {
  // Live Graph fetch only when the caller explicitly asks for it (module
  // entry from the main nav) — NOT on every read, since switching platform
  // tabs inside the Insights module calls this too and shouldn't spend an
  // extra Graph API call per click. Best-effort: if the live fetch fails
  // (rate limit, expired token, not connected), fall through and serve
  // whatever's cached instead of failing the tab.
  if (fresh) {
    try {
      const { resolveFirstUserId } = require('../../shared/clientContext');
      const userId = await resolveFirstUserId(clientId);
      if (userId) {
        const { data: connection } = await supabase.from('crm_connections')
          .select('*').eq('user_id', userId).eq('platform', platform).eq('is_connected', true).maybeSingle();
        if (connection) await pollAccountInsights(clientId, connection);
      }
    } catch (err) {
      console.error(`[insights] on-demand refresh failed for ${platform}:`, err.graphError?.message || err.message);
    }
  }

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

module.exports = { getAccountInsights, getPostInsights, getSnapshots, pollInsights };
