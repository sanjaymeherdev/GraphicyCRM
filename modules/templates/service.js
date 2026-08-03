// modules/templates/service.js — CRUD /api/templates, plus Meta WhatsApp
// Business template management (submit for review, sync approval status,
// media handles for template headers). Ported from the original repo's
// server.js "TEMPLATES ROUTES" section (wb_templates -> crm_templates,
// user-scoped -> client-scoped).
const fetch = require('node-fetch');
const FormData = require('form-data');
const { supabase } = require('../../shared/db');
const { decryptToken } = require('../../shared/crypto');
const whatsapp = require('../whatsapp/service');

const META_API_VERSION = process.env.META_API_VERSION || 'v21.0';

const VALID_FORMATS = ['text', 'json', 'html'];

// `format` governs how a template's `body` is interpreted when it's actually
// sent (see modules/automations/service.js matchRule() and modules/leads/
// service.js sendOutboundMessage()):
//   - 'text' (default) — sent as literal message text, same as before.
//   - 'json'  — `body` must be a JSON string holding a raw, channel-ready
//     API payload (e.g. a WhatsApp interactive/message object, or a
//     Facebook/Instagram Send API `message` object). Used for WhatsApp,
//     Facebook, and Instagram templates that need more than plain text
//     (buttons, generic templates, attachments, etc).
//   - 'html'  — `body` is sent as an HTML email body (Gmail). Plain-text
//     email templates should just use 'text'.
function assertValidFormat(format) {
  if (format && !VALID_FORMATS.includes(format)) {
    throw new Error(`format must be one of: ${VALID_FORMATS.join(', ')}`);
  }
}

function assertBodyMatchesFormat(format, body) {
  if (format !== 'json') return;
  if (!body || !body.trim()) throw new Error('A JSON-format template needs a body.');
  try { JSON.parse(body); }
  catch (err) { throw new Error(`Body is not valid JSON: ${err.message}`); }
}

async function listTemplates(clientId) {
  const { data, error } = await supabase.from('crm_templates').select('*').eq('client_id', clientId).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

async function createTemplate(clientId, { name, type, body, footer, meta_template_name, format }) {
  if (!name) throw new Error('name is required');
  assertValidFormat(format);
  assertBodyMatchesFormat(format, body);
  const { data, error } = await supabase.from('crm_templates').insert({
    client_id: clientId, name, type: type || 'plaintext', body: body || '',
    footer: footer || null, meta_template_name: meta_template_name || null,
    format: format || 'text',
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function updateTemplate(clientId, id, patch) {
  const allowed = ['name', 'type', 'body', 'footer', 'meta_template_name', 'format'];
  const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => allowed.includes(k)));
  assertValidFormat(clean.format);
  if ('body' in clean || 'format' in clean) {
    // Validate against the resulting format/body pair, not just whichever
    // one was actually included in this patch.
    const { data: existing } = await supabase.from('crm_templates').select('format, body').eq('id', id).eq('client_id', clientId).maybeSingle();
    const effectiveFormat = clean.format ?? existing?.format ?? 'text';
    const effectiveBody = 'body' in clean ? clean.body : existing?.body;
    assertBodyMatchesFormat(effectiveFormat, effectiveBody);
  }
  clean.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('crm_templates').update(clean)
    .eq('id', id).eq('client_id', clientId).select().single();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Template not found');
  return data;
}

async function deleteTemplate(clientId, userId, id) {
  const { data: tpl, error: findErr } = await supabase.from('crm_templates')
    .select('name, type').eq('id', id).eq('client_id', clientId).maybeSingle();
  if (findErr) throw new Error(findErr.message);
  if (!tpl) throw new Error('Template not found');

  // Best-effort: also remove it from Meta so it doesn't keep showing as
  // APPROVED there after being deleted here. Never block the local delete
  // on this — a user should always be able to remove their own local row.
  if (tpl.type === 'whatsapp_template') {
    try {
      const account = await whatsapp.getActiveAccount(userId);
      await fetch(`https://graph.facebook.com/${META_API_VERSION}/${account.waba_id}/message_templates?name=${encodeURIComponent(tpl.name)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${decryptToken(account.access_token_enc)}` },
      });
    } catch (err) {
      console.error('[templates] failed to delete from Meta (local row still removed):', err.message);
    }
  }

  const { error } = await supabase.from('crm_templates').delete().eq('id', id).eq('client_id', clientId);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------
// Meta WhatsApp Business template management — submit for review, upload
// header media, and keep local rows in sync with Meta's approval status.
// ---------------------------------------------------------------------

function buildMetaComponents({ body, footer, buttons, header_type, header_text, header_media_id, header_media_url }) {
  const components = [];
  if (header_type && header_type !== 'NONE') {
    const header = { type: 'HEADER' };
    if (header_type === 'TEXT') {
      header.format = 'TEXT';
      header.text = header_text || '';
    } else {
      header.format = header_type;
      const mediaHandle = header_media_id || header_media_url;
      if (mediaHandle) header.example = { header_handle: [mediaHandle] };
    }
    components.push(header);
  }
  components.push({ type: 'BODY', text: body });
  if (footer?.trim()) components.push({ type: 'FOOTER', text: footer.trim() });
  if (buttons?.length) {
    const buttonComp = { type: 'BUTTONS', buttons: [] };
    for (const btn of buttons) {
      if (btn.type === 'QUICK_REPLY') buttonComp.buttons.push({ type: 'QUICK_REPLY', text: btn.text });
      else if (btn.type === 'URL') buttonComp.buttons.push({ type: 'URL', text: btn.text, url: btn.url });
      else if (btn.type === 'PHONE_NUMBER') buttonComp.buttons.push({ type: 'PHONE_NUMBER', text: btn.text, phone_number: btn.phone });
      else if (btn.type === 'COPY_CODE') buttonComp.buttons.push({ type: 'COPY_CODE', example: [btn.text] });
    }
    if (buttonComp.buttons.length) components.push(buttonComp);
  }
  return components;
}

/** Submits a new template to Meta for review, and saves a local PENDING row. */
async function submitMetaTemplate(clientId, userId, body) {
  const { name, body: bodyText, category, language, footer, buttons, header_type, header_text, header_media_url, header_media_id, placeholders } = body || {};
  if (!name || !bodyText) throw new Error('name and body are required');
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error('Template name must be lowercase letters, numbers, underscores only');

  const account = await whatsapp.getActiveAccount(userId);
  const accessToken = decryptToken(account.access_token_enc);
  const components = buildMetaComponents({ body: bodyText, footer, buttons, header_type, header_text, header_media_id, header_media_url });

  const metaRes = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${account.waba_id}/message_templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ name, category: category || 'MARKETING', language: language || 'en_US', components }),
  });
  const metaData = await metaRes.json();
  if (!metaRes.ok) throw new Error(metaData.error?.message || 'Meta API error');

  const { data, error } = await supabase.from('crm_templates').insert({
    client_id: clientId, name, type: 'whatsapp_template', body: bodyText,
    category: category || 'MARKETING', language: language || 'en_US', status: 'PENDING',
    header_type: header_type || 'NONE', header_text: header_text || null, header_media_url: header_media_url || null,
    footer: footer || null, buttons: buttons || [], placeholders: placeholders || [],
    meta_template_id: metaData.id || null, meta_template_name: name,
  }).select().single();
  if (error) throw new Error(`Submitted to Meta but DB save failed: ${error.message}`);
  return data;
}

/** Uploads media (image/video/document) to get a handle for a template HEADER, via the WA phone number's /media endpoint. */
async function uploadTemplateMedia(userId, file) {
  if (!file) throw new Error('File is required');
  const account = await whatsapp.getActiveAccount(userId);
  const accessToken = decryptToken(account.access_token_enc);

  const form = new FormData();
  form.append('file', file.buffer, { filename: file.originalname, contentType: file.mimetype });

  const metaRes = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${account.phone_number_id}/media`, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: form,
  });
  const data = await metaRes.json();
  if (!metaRes.ok) throw new Error(data.error?.message || 'Media upload failed');
  return { media_id: data.id, mime_type: data.mime_type, url: data.url || null };
}

function extractComponents(metaTemplate) {
  const bodyComp = (metaTemplate.components || []).find((c) => c.type === 'BODY');
  const footerComp = (metaTemplate.components || []).find((c) => c.type === 'FOOTER');
  const headerComp = (metaTemplate.components || []).find((c) => c.type === 'HEADER');
  const headerType = headerComp?.format || 'NONE';
  return {
    body: bodyComp?.text || '',
    footer: footerComp?.text || null,
    headerType,
    headerText: headerType === 'TEXT' ? headerComp?.text || null : null,
  };
}

/** Full two-way sync: upserts every Meta-APPROVED template locally, and removes local rows Meta no longer reports as approved. */
async function syncMetaTemplates(clientId, userId) {
  const account = await whatsapp.getActiveAccount(userId);
  const accessToken = decryptToken(account.access_token_enc);

  const response = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${account.waba_id}/message_templates?fields=id,name,status,language,category,components`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Failed to fetch from Meta');

  const approvedTemplates = (data.data || []).filter((t) => t.status === 'APPROVED');

  const { data: localTemplates, error: localError } = await supabase.from('crm_templates')
    .select('id,name,meta_template_id,status').eq('client_id', clientId);
  if (localError) throw new Error(localError.message);

  const ops = [];
  for (const tpl of approvedTemplates) {
    const existing = localTemplates?.find((l) => l.meta_template_id === tpl.id) || localTemplates?.find((l) => l.name === tpl.name);
    const { body, footer, headerType, headerText } = extractComponents(tpl);

    if (existing) {
      const patch = {};
      if (existing.status !== 'APPROVED') patch.status = 'APPROVED';
      if (!existing.meta_template_id) patch.meta_template_id = tpl.id;
      if (Object.keys(patch).length) ops.push(supabase.from('crm_templates').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', existing.id));
    } else {
      ops.push(supabase.from('crm_templates').insert({
        client_id: clientId, name: tpl.name, type: 'whatsapp_template', body,
        category: tpl.category || 'MARKETING', language: tpl.language || 'en_US', status: 'APPROVED',
        header_type: headerType, header_text: headerText, footer, meta_template_id: tpl.id, meta_template_name: tpl.name,
      }));
    }
  }

  // Local rows Meta no longer reports as APPROVED (rejected/paused/deleted directly on Meta) get removed.
  const metaApprovedIds = new Set(approvedTemplates.map((t) => t.id));
  const metaApprovedNames = new Set(approvedTemplates.map((t) => t.name));
  const staleLocal = (localTemplates || []).filter((l) => {
    const stillOnMeta = l.meta_template_id ? metaApprovedIds.has(l.meta_template_id) : metaApprovedNames.has(l.name);
    return l.status === 'APPROVED' && !stillOnMeta;
  });
  if (staleLocal.length) ops.push(supabase.from('crm_templates').delete().in('id', staleLocal.map((l) => l.id)));

  const results = await Promise.all(ops);
  // Supabase query-builder promises RESOLVE (not reject) on failure — Promise.all
  // alone would silently swallow a failed upsert/delete, so check explicitly.
  const errors = results.filter((r) => r?.error).map((r) => r.error.message);
  if (errors.length) console.error('[templates/sync] some sync operations failed:', errors);

  return { templates: approvedTemplates, synced: true, syncErrors: errors.length || undefined, removed: staleLocal.map((l) => l.name) };
}

/** Read-mostly view for a template picker: fetches Meta's current approved list and prunes any local rows that fell out of approval, without upserting new ones. */
async function listMetaApproved(clientId, userId) {
  const account = await whatsapp.getActiveAccount(userId);
  const accessToken = decryptToken(account.access_token_enc);

  const response = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${account.waba_id}/message_templates?fields=id,name,status,language,category,components`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Failed to fetch from Meta');
  const approvedTemplates = (data.data || []).filter((t) => t.status === 'APPROVED');

  const { data: localTemplates } = await supabase.from('crm_templates')
    .select('id,name,meta_template_id,status').eq('client_id', clientId).eq('status', 'APPROVED');
  const metaApprovedIds = new Set(approvedTemplates.map((t) => t.id));
  const metaApprovedNames = new Set(approvedTemplates.map((t) => t.name));
  const staleLocal = (localTemplates || []).filter((l) => {
    const stillOnMeta = l.meta_template_id ? metaApprovedIds.has(l.meta_template_id) : metaApprovedNames.has(l.name);
    return !stillOnMeta;
  });
  if (staleLocal.length) await supabase.from('crm_templates').delete().in('id', staleLocal.map((l) => l.id));

  return approvedTemplates.map((t) => ({ name: t.name, status: t.status, language: t.language || 'en_US', category: t.category || 'MARKETING', components: t.components }));
}

module.exports = {
  listTemplates, createTemplate, updateTemplate, deleteTemplate,
  submitMetaTemplate, uploadTemplateMedia, syncMetaTemplates, listMetaApproved,
};
