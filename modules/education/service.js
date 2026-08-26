// modules/education/service.js — school/coaching-institute management
// (students, teachers, staff, classes, attendance, fees, invoices,
// birthday/fee/invoice WhatsApp reminders).
//
// Data lives in the client's own Google Sheet via a per-client Apps Script
// Web App deployment (see appsScript.js — the reference script each client
// deploys and pastes the resulting /exec URL + secret back into
// crm_edu_config for). This module only proxies CRUD calls through to that
// script and layers reminder sending on top, the same shape as
// modules/mail-capture's Apps Script pattern (see that module's service.js
// header comment for the reasoning).
//
// IMPORTANT: reminders below use whatsapp.sendTemplate (an approved Meta
// message template), NOT whatsapp.sendMessage. Birthday wishes, fee-due
// nudges, and invoice notices are business-initiated messages to a parent
// who very likely hasn't messaged in within the last 24h — sendMessage
// would fail assertWithinReplyWindow for exactly those recipients. The
// client must create + get Meta approval for each template name below
// (see modules/templates' Meta submission flow) before enabling auto-send.
const fetch = require('node-fetch');
const crypto = require('crypto');
const { supabase } = require('../../shared/db');
const { encryptToken, decryptToken } = require('../../shared/crypto');
const { resolveFirstUserId } = require('../../shared/clientContext');
const whatsapp = require('../whatsapp/service');

function generateSecret() {
  return crypto.randomBytes(24).toString('base64url');
}

// ---------------------------------------------------------------------
// Connection config (crm_edu_config)
// ---------------------------------------------------------------------
async function getConfig(clientId) {
  const { data, error } = await supabase.from('crm_edu_config').select('*').eq('client_id', clientId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const { secret_key_enc, ...rest } = data;
  return { ...rest, has_secret: !!secret_key_enc };
}

async function saveConfig(clientId, { scriptUrl, secretKey, schoolName, active }) {
  if (!scriptUrl) throw new Error('scriptUrl is required');
  const { data: existing } = await supabase.from('crm_edu_config').select('id, secret_key_enc').eq('client_id', clientId).maybeSingle();
  if (!existing && !secretKey) throw new Error('secretKey is required when connecting for the first time');

  const patch = {
    client_id: clientId,
    script_url: scriptUrl,
    school_name: schoolName || null,
    active: active !== false,
    updated_at: new Date().toISOString(),
  };
  if (secretKey) patch.secret_key_enc = encryptToken(secretKey);

  if (existing) {
    const { data, error } = await supabase.from('crm_edu_config').update(patch).eq('id', existing.id).select().single();
    if (error) throw new Error(error.message);
    return data;
  }
  const { data, error } = await supabase.from('crm_edu_config').insert(patch).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function deleteConfig(clientId) {
  const { error } = await supabase.from('crm_edu_config').delete().eq('client_id', clientId);
  if (error) throw new Error(error.message);
}

async function requireActiveConfig(clientId) {
  const { data, error } = await supabase.from('crm_edu_config').select('*').eq('client_id', clientId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('No Google Sheet connected yet — save your Apps Script URL and secret first.');
  if (!data.active) throw new Error('Education module is disabled for this account.');
  return data;
}

// ---------------------------------------------------------------------
// Low-level Apps Script proxy — mirrors appsScript.js's handleRequest
// action set exactly (list/get/create/bulkCreate/update/delete per sheet,
// plus getSettings/setSettings).
// ---------------------------------------------------------------------
async function callScript(clientId, params) {
  const cfg = await requireActiveConfig(clientId);
  const secretKey = decryptToken(cfg.secret_key_enc);

  const res = await fetch(cfg.script_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: secretKey, ...params }),
  });
  if (!res.ok) throw new Error(`Apps Script HTTP ${res.status}: ${res.statusText}`);

  let body;
  try { body = await res.json(); }
  catch { throw new Error('Apps Script returned a non-JSON response — check the deployment is set to "Anyone" access.'); }

  if (!body.success) throw new Error(body.error || 'Apps Script returned an error');
  return body.data;
}

const SHEETS = [
  'Students', 'Teachers', 'Staff', 'Classes', 'Attendance', 'Fees',
  'Invoices', 'InvoiceTemplates', 'MessageTemplates', 'MessageLog', 'BirthdaySent',
];

/** Generic CRUD bound to one sheet — every resource route below is one of these. */
function resource(sheetName) {
  if (!SHEETS.includes(sheetName)) throw new Error(`Unknown education sheet: ${sheetName}`);
  return {
    list: (clientId, filters) => callScript(clientId, { action: 'list', sheet: sheetName, filters }),
    get: (clientId, id) => callScript(clientId, { action: 'get', sheet: sheetName, id }),
    create: (clientId, data) => callScript(clientId, { action: 'create', sheet: sheetName, data }),
    bulkCreate: (clientId, data) => callScript(clientId, { action: 'bulkCreate', sheet: sheetName, data }),
    update: (clientId, id, data) => callScript(clientId, { action: 'update', sheet: sheetName, id, data }),
    remove: (clientId, id) => callScript(clientId, { action: 'delete', sheet: sheetName, id }),
  };
}

const students = resource('Students');
const teachers = resource('Teachers');
const staff = resource('Staff');
const classes = resource('Classes');
const attendance = resource('Attendance');
const fees = resource('Fees');
const invoices = resource('Invoices');
const invoiceTemplates = resource('InvoiceTemplates');
const messageTemplates = resource('MessageTemplates');
const messageLog = resource('MessageLog');
const birthdaySent = resource('BirthdaySent');

async function getSettings(clientId) {
  return callScript(clientId, { action: 'getSettings' });
}
async function setSettings(clientId, data) {
  return callScript(clientId, { action: 'setSettings', data: data || {} });
}

// ---------------------------------------------------------------------
// Sending — every reminder path funnels through here so MessageLog
// (the sheet, not Supabase) stays the single record of what went out.
// ---------------------------------------------------------------------
async function sendToStudent(clientId, { studentId, name, phone, templateName, language, components, module: moduleName }) {
  if (!phone) throw new Error('Recipient has no phone number on file');
  const userId = await resolveFirstUserId(clientId);
  if (!userId) throw new Error('No connected WhatsApp-capable user found for this client');

  let status = 'sent', error = null, providerMessageId = null;
  try {
    const result = await whatsapp.sendTemplate(userId, { to: phone, name: templateName, language: language || 'en_US', components });
    providerMessageId = result.messageId;
  } catch (err) {
    status = 'failed';
    error = err.message;
  }

  await messageLog.create(clientId, {
    module: moduleName, recipient_id: studentId, recipient_name: name, phone,
    message: `[template: ${templateName}]`, status, provider_message_id: providerMessageId || '',
    error: error || '', sent_at: new Date().toISOString(),
  });

  if (error) throw new Error(error);
  return { status, providerMessageId };
}

// ---------------------------------------------------------------------
// Reminder poll tick (see server.js) — one pass over every active
// client's sheet. Idempotency is data-level (see migration comment):
// birthdays check BirthdaySent for this year; fees/invoices check their
// own lastReminderDate/sent_at columns and only (re-)send when stale.
// ---------------------------------------------------------------------
async function pollRemindersForClient(clientId) {
  const settings = await getSettings(clientId);
  if (settings.autoSendEnabled) await sendBirthdayReminders(clientId, settings);
  if (settings.autoFeeReminderEnabled) await sendFeeReminders(clientId, settings);
  if (settings.autoInvoiceSendEnabled) await sendInvoiceReminders(clientId, settings);
}

async function pollReminders() {
  const { data: configs, error } = await supabase.from('crm_edu_config').select('client_id').eq('active', true);
  if (error) { console.error('[education] failed to load configs:', error.message); return; }

  for (const { client_id: clientId } of configs || []) {
    try {
      await pollRemindersForClient(clientId);
    } catch (err) {
      // One client's sheet being unreachable/misconfigured shouldn't stop
      // the rest of the batch, same as modules/followup's poll tick.
      console.error(`[education] client ${clientId} reminder poll failed:`, err.message);
    }
  }
}

function todayMonthDay() {
  const now = new Date();
  return { month: now.getMonth() + 1, day: now.getDate(), year: now.getFullYear() };
}

async function sendBirthdayReminders(clientId, settings) {
  const templateName = settings.defaultBirthdayTemplate;
  if (!templateName) return; // nothing configured to send yet

  const { month, day, year } = todayMonthDay();
  const allStudents = await students.list(clientId, {});
  const alreadySent = await birthdaySent.list(clientId, { year: String(year) });
  const sentIds = new Set(alreadySent.map((r) => r.student_id));

  for (const student of allStudents) {
    if (!student.dob || sentIds.has(student.id)) continue;
    const dob = new Date(student.dob);
    if (dob.getMonth() + 1 !== month || dob.getDate() !== day) continue;

    const phone = student.guardian_phone || student.phone;
    try {
      await sendToStudent(clientId, { studentId: student.id, name: student.name, phone, templateName, module: 'birthday' });
      await birthdaySent.create(clientId, { student_id: student.id, year: String(year), sent_at: new Date().toISOString() });
    } catch (err) {
      console.error(`[education] birthday reminder failed for student ${student.id}:`, err.message);
    }
  }
}

async function sendFeeReminders(clientId, settings) {
  const templateName = settings.defaultFeeTemplate;
  if (!templateName) return;

  const pending = (await fees.list(clientId, {})).filter((f) => f.status === 'pending' || f.status === 'overdue');
  const now = Date.now();
  const minGapMs = (Number(settings.feeReminderGapDays) || 3) * 24 * 60 * 60 * 1000;

  for (const fee of pending) {
    const last = fee.lastReminderDate ? new Date(fee.lastReminderDate).getTime() : 0;
    if (now - last < minGapMs) continue;

    try {
      await sendToStudent(clientId, { studentId: fee.student_id, name: fee.name, phone: fee.phone, templateName, module: 'fee' });
      await fees.update(clientId, fee.id, { lastReminderDate: new Date().toISOString() });
    } catch (err) {
      console.error(`[education] fee reminder failed for fee row ${fee.id}:`, err.message);
    }
  }
}

async function sendInvoiceReminders(clientId, settings) {
  const templateName = settings.defaultInvoiceTemplate;
  if (!templateName) return;

  const unsent = (await invoices.list(clientId, {})).filter((inv) => inv.status !== 'paid' && !inv.sent_at);
  for (const invoice of unsent) {
    try {
      await sendToStudent(clientId, { studentId: invoice.student_id, name: invoice.name, phone: invoice.phone, templateName, module: 'invoice' });
      await invoices.update(clientId, invoice.id, { sent_at: new Date().toISOString() });
    } catch (err) {
      console.error(`[education] invoice send failed for invoice ${invoice.id}:`, err.message);
    }
  }
}

module.exports = {
  generateSecret, getConfig, saveConfig, deleteConfig,
  students, teachers, staff, classes, attendance, fees, invoices,
  invoiceTemplates, messageTemplates, messageLog, birthdaySent,
  getSettings, setSettings,
  sendToStudent, pollReminders, pollRemindersForClient,
};