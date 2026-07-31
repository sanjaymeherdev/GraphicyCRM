// modules/schedule/service.js — CRUD /api/schedule/posts, POST .../publish,
// plus pollDuePosts() for a background worker (server.js wires it up the
// same way modules/sheets/service.js's pollWatchers() is wired).
const { supabase } = require('../../shared/db');

const PLATFORM_SERVICES = {
  facebook: () => require('../facebook/service'),
  instagram: () => require('../instagram/service'),
  threads: () => require('../threads/service'),
  // LinkedIn is caption-only (see crm_scheduled_posts.media_url comment in
  // migrations/schema_full.sql) — publishPost below ignores media_url for it.
  linkedin: () => require('../linkedin/service'),
};

async function listPosts(clientId, { status } = {}) {
  let q = supabase.from('crm_scheduled_posts').select('*').eq('client_id', clientId).order('scheduled_date', { ascending: true, nullsFirst: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

async function createPost(clientId, userId, body) {
  const { title, caption, hook, platforms, media_url, google_drive_file_id, scheduled_date } = body || {};
  const { data, error } = await supabase.from('crm_scheduled_posts').insert({
    client_id: clientId, created_by: userId, title: title || null, caption: caption || '',
    hook: hook || null, platforms: platforms || [], media_url: media_url || null,
    google_drive_file_id: google_drive_file_id || null, scheduled_date: scheduled_date || null,
    status: scheduled_date ? 'scheduled' : 'draft',
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function updatePost(clientId, id, patch) {
  const allowed = ['title', 'caption', 'hook', 'platforms', 'media_url', 'google_drive_file_id', 'scheduled_date', 'status'];
  const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => allowed.includes(k)));
  if (clean.scheduled_date && !clean.status) clean.status = 'scheduled';
  clean.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('crm_scheduled_posts').update(clean)
    .eq('id', id).eq('client_id', clientId).select().single();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Post not found');
  return data;
}

async function deletePost(clientId, id) {
  const { error } = await supabase.from('crm_scheduled_posts').delete().eq('id', id).eq('client_id', clientId);
  if (error) throw new Error(error.message);
}

/** Publishes to every configured platform, recording per-platform ids/errors. */
async function publishPost(userId, post) {
  const publishedIds = { ...(post.published_ids || {}) };
  const errors = {};

  for (const platform of post.platforms || []) {
    if (publishedIds[platform]) continue; // already published to this one
    const getService = PLATFORM_SERVICES[platform];
    if (!getService) { errors[platform] = `"${platform}" publishing isn't implemented in this backend yet.`; continue; }
    try {
      publishedIds[platform] = await getService().publishPost(userId, { caption: post.caption, mediaUrl: post.media_url });
    } catch (err) {
      errors[platform] = err.message;
    }
  }

  const allOk = (post.platforms || []).every((p) => publishedIds[p]);
  const anyOk = (post.platforms || []).some((p) => publishedIds[p]);
  const status = allOk ? 'published' : anyOk ? 'partial' : 'failed';

  const { data, error } = await supabase.from('crm_scheduled_posts').update({
    published_ids: publishedIds, publish_errors: errors, status, updated_at: new Date().toISOString(),
  }).eq('id', post.id).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function publishPostById(clientId, userId, id) {
  const { data: post, error } = await supabase.from('crm_scheduled_posts').select('*').eq('id', id).eq('client_id', clientId).single();
  if (error || !post) throw new Error('Post not found');
  return publishPost(userId, post);
}

/** Poll tick: publishes every due, scheduled post. userIdForClient resolves
 * which user's connected accounts to publish through (a client's channels
 * are connected per-user, not per-client — see shared/metaConnections.js). */
async function pollDuePosts(userIdForClient) {
  const { data: due, error } = await supabase.from('crm_scheduled_posts')
    .select('*').eq('status', 'scheduled').lte('scheduled_date', new Date().toISOString());
  if (error) { console.error('[schedule] failed to load due posts:', error.message); return; }

  for (const post of due || []) {
    try {
      const userId = await userIdForClient(post.client_id);
      if (!userId) continue;
      await publishPost(userId, post);
    } catch (err) {
      console.error(`[schedule] post ${post.id} failed to publish:`, err.message);
    }
  }
}

module.exports = { listPosts, createPost, updatePost, deletePost, publishPostById, pollDuePosts };
