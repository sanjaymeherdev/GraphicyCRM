// modules/sheets/service.js — read/write Google Sheets values, plus a
// polling "watcher" system that fires a callback when new rows appear or a
// date column matches today (birthday/renewal-reminder style automations).
// Ported from the original repo's src/sheet-poller.js and
// src/routes/sheet-watchers.js.
const fetch = require('node-fetch');
const { getValidGoogleAccessToken } = require('../../shared/googleAuth');
const { supabase } = require('../../shared/db');

const valueRange = (worksheet, a1 = 'A1:ZZ5000') => `${worksheet}!${a1}`;

// listSpreadsheets() (a Drive files.list "pick your spreadsheet" dropdown)
// was removed — it needed the `drive` scope, which isn't in this app's
// approved OAuth scopes. Spreadsheets are now referenced by pasting a
// spreadsheetId/URL directly; listTabs()/getHeaders() below still work
// fine off a pasted ID since they only need the `spreadsheets` scope.

/** Lists a spreadsheet's tabs (worksheet names) for the "pick a worksheet" dropdown. */
async function listTabs(userId, spreadsheetId) {
  const accessToken = await getValidGoogleAccessToken(userId);
  const params = new URLSearchParams({ fields: 'sheets.properties.title' });
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Sheets API error ${res.status}`);
  return (data.sheets || []).map((s) => s.properties?.title).filter(Boolean);
}

/** Returns a worksheet's header row (row 1) for the "pick a column" dropdowns. */
async function getHeaders(userId, spreadsheetId, worksheet) {
  const values = await getValues(userId, spreadsheetId, worksheet, 'A1:ZZ1');
  return (values[0] || []).map((h) => String(h || '').trim()).filter(Boolean);
}

async function getValues(userId, spreadsheetId, worksheet, a1Range) {
  const accessToken = await getValidGoogleAccessToken(userId);
  const range = valueRange(worksheet, a1Range);
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Sheets API error ${res.status}`);
  return data.values || [];
}

/** Returns rows as objects keyed by the header row (row 1). */
async function getRows(userId, spreadsheetId, worksheet) {
  const values = await getValues(userId, spreadsheetId, worksheet);
  const headers = (values[0] || []).map((h) => String(h || '').trim());
  return values.slice(1).map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])));
}

/** Overwrites a specific A1 range (e.g. "B2" or "A2:C2") with the given 2D array of values. */
async function updateRange(userId, spreadsheetId, worksheet, a1Range, values) {
  const accessToken = await getValidGoogleAccessToken(userId);
  const range = valueRange(worksheet, a1Range);
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Sheets API error ${res.status}`);
  return data;
}

/** Appends one or more rows to the end of a worksheet. */
async function appendRows(userId, spreadsheetId, worksheet, rows) {
  const accessToken = await getValidGoogleAccessToken(userId);
  const range = valueRange(worksheet, 'A1');
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: rows }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Sheets API error ${res.status}`);
  return data;
}

function getColumnName(colIndex) {
  let name = '', n = colIndex;
  while (n >= 0) { name = String.fromCharCode(65 + (n % 26)) + name; n = Math.floor(n / 26) - 1; }
  return name;
}

// -----------------------------------------------------------------------
// Watchers: `crm_sheet_watchers` rows polled on an interval. `onMatch(row)`
// is called with the matched row's header-keyed object for the CRM to act
// on (send a message, create a lead, etc) — kept generic so this module has
// no dependency on any specific messaging channel.
// -----------------------------------------------------------------------
async function createWatcher(userId, config) {
  const { data, error } = await supabase.from('crm_sheet_watchers').insert({
    user_id: userId, active: true, last_row_count: 0, created_at: new Date().toISOString(), ...config,
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function listWatchers(userId) {
  const { data, error } = await supabase.from('crm_sheet_watchers').select('*').eq('user_id', userId);
  if (error) throw new Error(error.message);
  return data || [];
}

async function updateWatcher(userId, id, patch) {
  const allowed = ['spreadsheet_id', 'worksheet', 'watch_type', 'poll_interval_minutes', 'date_column', 'offset_days',
    'name_column', 'phone_column', 'email_column', 'channel', 'template_id', 'placeholder_mapping', 'message_template', 'active'];
  const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => allowed.includes(k)));
  const { data, error } = await supabase.from('crm_sheet_watchers').update(clean).eq('id', id).eq('user_id', userId).select().single();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Watcher not found');
  return data;
}

async function deleteWatcher(userId, id) {
  const { error } = await supabase.from('crm_sheet_watchers').delete().eq('id', id).eq('user_id', userId);
  if (error) throw new Error(error.message);
}

function parseFlexibleDate(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value).trim())) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + parseFloat(value) * 86400000);
  }
  const str = String(value).trim();
  const slashMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slashMatch) {
    let [, d, m, y] = slashMatch;
    if (y.length === 2) y = `20${y}`;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    if (!isNaN(date.getTime())) return date;
  }
  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/** One poll tick — checks every active, due watcher and invokes onMatch for each hit. Call on a setInterval from server.js. */
async function pollWatchers(onMatch) {
  const { data: watchers, error } = await supabase.from('crm_sheet_watchers').select('*').eq('active', true);
  if (error) { console.error('[sheets] failed to load watchers:', error.message); return; }

  for (const watcher of watchers || []) {
    const dueAt = watcher.last_polled_at ? new Date(watcher.last_polled_at).getTime() + watcher.poll_interval_minutes * 60000 : 0;
    if (Date.now() < dueAt) continue;
    pollOneWatcher(watcher, onMatch).catch((err) => console.error(`[sheets] watcher ${watcher.id} failed:`, err.message));
  }
}

async function pollOneWatcher(watcher, onMatch) {
  let values;
  try {
    values = await getValues(watcher.user_id, watcher.spreadsheet_id, watcher.worksheet);
  } catch (err) {
    await supabase.from('crm_sheet_watchers').update({ last_error: err.message, last_polled_at: new Date().toISOString() }).eq('id', watcher.id);
    return;
  }

  const headers = (values[0] || []).map((h) => String(h || '').trim());
  const dataRows = values.slice(1);
  const colIndex = (name) => headers.findIndex((h) => h.toLowerCase() === String(name || '').trim().toLowerCase());
  const toObj = (row) => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? '']));

  if (watcher.watch_type === 'new_row') {
    const newRows = dataRows.length > watcher.last_row_count ? dataRows.slice(watcher.last_row_count) : [];
    for (const row of newRows) await onMatch(watcher, toObj(row));
    await supabase.from('crm_sheet_watchers').update({ last_row_count: dataRows.length, last_polled_at: new Date().toISOString(), last_error: null }).eq('id', watcher.id);
    return;
  }

  if (watcher.watch_type === 'date_reminder') {
    const dateIdx = colIndex(watcher.date_column);
    if (dateIdx === -1) {
      await supabase.from('crm_sheet_watchers').update({ last_error: `Date column "${watcher.date_column}" not found`, last_polled_at: new Date().toISOString() }).eq('id', watcher.id);
      return;
    }
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
    const firedLog = { ...(watcher.fired_log || {}) };
    let changed = false;

    for (let i = 0; i < dataRows.length; i++) {
      const parsed = parseFlexibleDate(dataRows[i][dateIdx]);
      if (!parsed) continue;
      const isReminderDay = [today.getFullYear(), today.getFullYear() + 1].some((year) => {
        const occurrence = new Date(year, parsed.getMonth(), parsed.getDate());
        occurrence.setDate(occurrence.getDate() - (watcher.offset_days || 0));
        return occurrence.getFullYear() === today.getFullYear() && occurrence.getMonth() === today.getMonth() && occurrence.getDate() === today.getDate();
      });
      if (!isReminderDay) continue;
      const rowKey = String(i);
      if (firedLog[rowKey] === todayKey) continue;
      await onMatch(watcher, toObj(dataRows[i]));
      firedLog[rowKey] = todayKey;
      changed = true;
    }
    const patch = { last_polled_at: new Date().toISOString(), last_error: null };
    if (changed) patch.fired_log = firedLog;
    await supabase.from('crm_sheet_watchers').update(patch).eq('id', watcher.id);
  }
}

function substituteMergeFields(template, fields) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, key) => fields[key] ?? `{${key}}`);
}

function resolvePlaceholder(map, fields) {
  if (!map) return '';
  if (map.type === 'name') return fields.__name || '';
  if (map.type === 'phone') return fields.__phone || '';
  if (map.type === 'email') return fields.__email || '';
  if (map.type === 'field') return fields[map.field] ?? '';
  if (map.type === 'custom') return map.value || '';
  return '';
}

/**
 * Turns one matched sheet row into a lead (always) and, for channel
 * 'whatsapp', an outbound message (either an approved template with
 * placeholder_mapping resolved against the row, or a plain-text
 * message_template with {field} merge tags). Called from server.js's poll
 * tick — this is what replaces the old "console.log the match" stub.
 */
async function sendForMatch(watcher, row) {
  const { resolveClientId, findOrCreateLead } = require('../../shared/crmMessages');
  const name = watcher.name_column ? row[watcher.name_column] : undefined;
  const phone = watcher.phone_column ? row[watcher.phone_column] : undefined;
  const email = watcher.email_column ? row[watcher.email_column] : undefined;
  if (!phone && !email) return; // no way to identify who this row is about

  const clientId = await resolveClientId(watcher.user_id);
  await findOrCreateLead(clientId, 'sheet', { phone: phone || null, email: phone ? null : (email || null), name });

  if (watcher.channel !== 'whatsapp' || !phone) {
    if (watcher.channel !== 'whatsapp') console.warn(`[sheets] watcher ${watcher.id}: channel "${watcher.channel}" sending isn't implemented yet — lead was still created/updated.`);
    return;
  }

  const fields = { ...row, __name: name || '', __phone: phone || '', __email: email || '' };
  const whatsapp = require('../whatsapp/service'); // lazy require avoids a require cycle at module-load time

  if (watcher.template_id) {
    const { data: tpl, error } = await supabase.from('crm_templates').select('*').eq('id', watcher.template_id).single();
    if (error || !tpl) throw new Error('Linked template not found — pick a template again on this watcher');
    const entries = Object.entries(watcher.placeholder_mapping || {});
    const components = entries.length ? [{
      type: 'BODY',
      parameters: entries.map(([key, map]) => (/^\d+$/.test(key)
        ? { type: 'text', text: String(resolvePlaceholder(map, fields)) }
        : { type: 'text', parameter_name: key, text: String(resolvePlaceholder(map, fields)) })),
    }] : [];
    await whatsapp.sendTemplate(watcher.user_id, { to: phone, name: tpl.meta_template_name || tpl.name, language: tpl.language || 'en_US', components });
  } else if (watcher.message_template) {
    // No template configured — falls back to a free-form send, which only
    // succeeds if this contact has messaged in within the last 22h (see
    // whatsapp/service.js's reply-window check). For a brand-new lead
    // straight from a spreadsheet that's almost never true; pick a template
    // in the watcher for first-contact/cold sends instead.
    await whatsapp.sendMessage(watcher.user_id, { to: phone, kind: 'text', cfg: { body: substituteMergeFields(watcher.message_template, fields) } });
  }
}

module.exports = {
  getValues, getRows, updateRange, appendRows, getColumnName,
  listTabs, getHeaders,
  createWatcher, listWatchers, updateWatcher, deleteWatcher, pollWatchers, sendForMatch,
};
