// modules/sheets/service.js — read/write Google Sheets values, plus a
// polling "watcher" system that fires a callback when new rows appear or a
// date column matches today (birthday/renewal-reminder style automations).
// Ported from the original repo's src/sheet-poller.js and
// src/routes/sheet-watchers.js.
const fetch = require('node-fetch');
const { getValidGoogleAccessToken } = require('../../shared/googleAuth');
const { supabase } = require('../../shared/db');

const valueRange = (worksheet, a1 = 'A1:ZZ5000') => `${worksheet}!${a1}`;

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

module.exports = {
  getValues, getRows, updateRange, appendRows, getColumnName,
  createWatcher, listWatchers, deleteWatcher, pollWatchers,
};
