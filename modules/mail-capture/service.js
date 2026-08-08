// modules/mail-capture/service.js — polls a user's deployed Apps Script
// web app (see appsScript.js) for new Gmail messages matching their
// from/keyword rules, and turns matches into leads. Mirrors modules/sheets'
// watcher pattern (createWatcher/pollWatchers/sendForMatch) but the "data
// source" here is the user's own Apps Script deployment instead of the
// Sheets API — see migrations/010_mail_capture.sql for why.
const fetch = require('node-fetch');
const crypto = require('crypto');
const { supabase } = require('../../shared/db');
const { encryptToken, decryptToken } = require('../../shared/crypto');

function generateSecret() {
  return crypto.randomBytes(24).toString('base64url');
}

async function getConfig(userId) {
  const { data, error } = await supabase.from('crm_mail_watchers').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  // Never send the encrypted secret back to the frontend — just whether one exists.
  const { secret_token_enc, ...rest } = data;
  return { ...rest, has_secret: !!secret_token_enc };
}

/**
 * Creates or updates this user's single mail-capture connection. `secretToken`
 * is optional on update (omit to keep the existing one — e.g. editing just
 * the keyword filter without re-pasting the Apps Script URL/secret).
 */
async function saveConfig(userId, { scriptUrl, secretToken, fromFilter, keywordFilter, pollIntervalMinutes, active }) {
  if (!scriptUrl) throw new Error('scriptUrl is required');

  const { data: existing } = await supabase.from('crm_mail_watchers').select('id, secret_token_enc').eq('user_id', userId).maybeSingle();
  if (!existing && !secretToken) throw new Error('secretToken is required when connecting for the first time');

  const patch = {
    user_id: userId,
    script_url: scriptUrl,
    from_filter: fromFilter || null,
    keyword_filter: keywordFilter || null,
    poll_interval_minutes: Number(pollIntervalMinutes) || 5,
    active: active !== false,
    updated_at: new Date().toISOString(),
  };
  if (secretToken) patch.secret_token_enc = encryptToken(secretToken);

  if (existing) {
    const { data, error } = await supabase.from('crm_mail_watchers').update(patch).eq('id', existing.id).select().single();
    if (error) throw new Error(error.message);
    return data;
  }
  patch.last_checked_at = new Date().toISOString(); // start "now" — don't flood in old mail on first connect
  const { data, error } = await supabase.from('crm_mail_watchers').insert(patch).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function deleteConfig(userId) {
  const { error } = await supabase.from('crm_mail_watchers').delete().eq('user_id', userId);
  if (error) throw new Error(error.message);
}

/** One poll tick across every active, due watcher. Call on a setInterval from server.js, same shape as modules/sheets' pollWatchers. */
async function pollAll(onMatch) {
  const { data: watchers, error } = await supabase.from('crm_mail_watchers').select('*').eq('active', true);
  if (error) { console.error('[mail-capture] failed to load watchers:', error.message); return; }

  for (const watcher of watchers || []) {
    const dueAt = watcher.last_polled_at ? new Date(watcher.last_polled_at).getTime() + watcher.poll_interval_minutes * 60000 : 0;
    if (Date.now() < dueAt) continue;
    pollOneWatcher(watcher, onMatch).catch((err) => console.error(`[mail-capture] watcher ${watcher.id} failed:`, err.message));
  }
}

/** Polls just one user's watcher right now, ignoring the poll_interval_minutes due-check — powers the Sources tab's "Test" button. */
async function pollForUser(userId, onMatch) {
  const { data: watcher, error } = await supabase.from('crm_mail_watchers').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!watcher) throw new Error('No mail-capture connection saved yet');
  await pollOneWatcher(watcher, onMatch);
}

async function pollOneWatcher(watcher, onMatch) {
  const secret = decryptToken(watcher.secret_token_enc);
  const afterMs = new Date(watcher.last_checked_at).getTime();

  const params = new URLSearchParams({ secret, after: String(afterMs), max: '20' });
  if (watcher.from_filter) params.set('from', watcher.from_filter);
  if (watcher.keyword_filter) params.set('keyword', watcher.keyword_filter);

  let data;
  try {
    const res = await fetch(`${watcher.script_url}?${params.toString()}`);
    data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `Apps Script returned ${res.status}`);
  } catch (err) {
    await supabase.from('crm_mail_watchers').update({
      last_error: err.message, last_polled_at: new Date().toISOString(),
    }).eq('id', watcher.id);
    return;
  }

  const messages = data.messages || [];
  for (const msg of messages) await onMatch(watcher, msg);

  // Advance the cursor to the newest captured message (or "now" if nothing
  // new came in) so the next poll only asks for what's actually new.
  const newestMs = messages.length ? Math.max(...messages.map((m) => new Date(m.date).getTime())) : Date.now();
  await supabase.from('crm_mail_watchers').update({
    last_checked_at: new Date(newestMs).toISOString(),
    last_polled_at: new Date().toISOString(),
    last_error: null,
  }).eq('id', watcher.id);
}

/** Turns one matched email into a lead + inbox message (mirrors modules/sheets' sendForMatch). */
async function captureMatch(watcher, msg) {
  const { resolveClientId, findOrCreateLead, recordMessage } = require('../../shared/crmMessages');

  const fromHeader = msg.from || '';
  const emailMatch = fromHeader.match(/<([^>]+)>/);
  const email = (emailMatch ? emailMatch[1] : fromHeader).trim().toLowerCase();
  const name = fromHeader.replace(/<[^>]+>/, '').replace(/"/g, '').trim() || null;
  if (!email) return;

  const clientId = await resolveClientId(watcher.user_id);
  const leadId = await findOrCreateLead(clientId, 'email', { email, name });
  await recordMessage(clientId, leadId, {
    channel: 'gmail', direction: 'in', messageType: 'text',
    body: msg.subject ? `${msg.subject}\n\n${msg.body || msg.snippet || ''}` : (msg.body || msg.snippet || ''),
    externalId: msg.id,
  });
}

module.exports = { generateSecret, getConfig, saveConfig, deleteConfig, pollAll, pollForUser, captureMatch };