// modules/education/appsScript.js — reference copy of the Google Apps
// Script Web App the person supplied. buildScript(secret) returns it with
// a fresh secret already embedded, same pattern as modules/mail-capture's
// appsScript.js, so the frontend can show a ready-to-paste code block
// instead of asking a non-technical school admin to hand-edit SECRET_KEY.
const TEMPLATE = `/**
 * ============================================================
 * SCHOOL SAAS — GOOGLE SHEETS BACKEND (Apps Script Web App)
 * ============================================================
 * Deploy this as a Web App (Execute as: Me, Access: Anyone).
 * The Node.js server is the ONLY client that should call this —
 * every request must include the shared SECRET_KEY below.
 *
 * Sheets are auto-created (with headers) the first time they're used,
 * so you don't need to pre-build tabs — just create a blank Spreadsheet,
 * bind this script to it, and deploy.
 * ============================================================
 */

// ------------------------------------------------------------
// CONFIG — do not edit; this value is generated per-connection
// by the CRM and must match what's stored server-side.
// ------------------------------------------------------------
var SECRET_KEY = '__SECRET_KEY__';

// ------------------------------------------------------------
// SCHEMA — header row for every sheet/tab. Order matters: the
// first column is always the primary key "id" (except Settings).
// ------------------------------------------------------------
var SCHEMAS = {
  Students: ['id', 'name', 'class_id', 'class_display', 'phone', 'guardian_name',
    'guardian_phone', 'email', 'dob', 'fee_status', 'status', 'created_at', 'updated_at'],

  Teachers: ['id', 'name', 'subject', 'phone', 'email', 'salary', 'created_at', 'updated_at'],

  Staff: ['id', 'name', 'role', 'phone', 'email', 'salary', 'created_at', 'updated_at'],

  Classes: ['id', 'name', 'section', 'teacher', 'created_at', 'updated_at'],

  Attendance: ['id', 'student_id', 'class_id', 'date', 'status', 'marked_at'],

  Fees: ['id', 'student_id', 'name', 'class', 'amount', 'monthsDue', 'dueDate',
    'status', 'phone', 'lastReminderDate', 'created_at', 'updated_at'],

  Invoices: ['id', 'student_id', 'invoice_number', 'name', 'class', 'amount', 'date',
    'dueDate', 'status', 'phone', 'sent_at', 'created_at', 'updated_at'],

  InvoiceTemplates: ['id', 'name', 'code', 'is_default', 'created_at', 'updated_at'],

  MessageTemplates: ['id', 'module', 'name', 'content', 'is_default', 'created_at', 'updated_at'],

  MessageLog: ['id', 'module', 'recipient_id', 'recipient_name', 'phone', 'message',
    'status', 'provider_message_id', 'error', 'sent_at'],

  BirthdaySent: ['id', 'student_id', 'year', 'sent_at']
};

// Settings is a plain key/value sheet (2 columns), handled separately.
var SETTINGS_SHEET = 'Settings';

// ------------------------------------------------------------
// ONE-TIME SETUP
// ------------------------------------------------------------
// Run this manually from the Apps Script editor (select "setupSheets" in the
// function dropdown, click ▶ Run) to create every tab with its header row up
// front. Not required — sheets also auto-create on first API call — but this
// lets you see the full structure immediately and confirm permissions before
// wiring anything to Node. Safe to re-run; it never touches existing data.
function setupSheets() {
  var created = [];
  var existing = [];

  for (var name in SCHEMAS) {
    if (!SCHEMAS.hasOwnProperty(name)) continue;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss.getSheetByName(name)) {
      existing.push(name);
    } else {
      getOrCreateSheet(name);
      created.push(name);
    }
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(SETTINGS_SHEET)) {
    existing.push(SETTINGS_SHEET);
  } else {
    getSettingsSheet_();
    created.push(SETTINGS_SHEET);
  }

  // Remove the default empty "Sheet1" if it's still sitting there unused
  var sheet1 = ss.getSheetByName('Sheet1');
  if (sheet1 && ss.getSheets().length > 1) {
    var isEmpty = sheet1.getLastRow() === 0;
    if (isEmpty) ss.deleteSheet(sheet1);
  }

  Logger.log('Created: ' + JSON.stringify(created));
  Logger.log('Already existed: ' + JSON.stringify(existing));
  return { created: created, existing: existing };
}

// ------------------------------------------------------------
// ENTRY POINTS
// ------------------------------------------------------------
function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  var params;
  try {
    params = parseParams(e);
  } catch (err) {
    return jsonOut({ success: false, error: 'Bad request: ' + err.message });
  }

  if (params.key !== SECRET_KEY) {
    return jsonOut({ success: false, error: 'Unauthorized' });
  }

  var action = params.action;

  try {
    // Settings has its own actions since it's key/value, not a row list
    if (action === 'getSettings') {
      return jsonOut({ success: true, data: getSettings() });
    }
    if (action === 'setSettings') {
      return jsonOut({ success: true, data: setSettings(params.data || {}) });
    }
    if (action === 'setup') {
      return jsonOut({ success: true, data: setupSheets() });
    }

    var sheetName = params.sheet;
    if (!sheetName || !SCHEMAS[sheetName]) {
      return jsonOut({ success: false, error: 'Unknown or missing sheet: ' + sheetName });
    }
    var sheet = getOrCreateSheet(sheetName);

    var result;
    switch (action) {
      case 'list':
        result = listRows(sheet, sheetName, params.filters || {});
        break;
      case 'get':
        result = getRow(sheet, sheetName, params.id);
        break;
      case 'create':
        result = createRow(sheet, sheetName, params.data || {});
        break;
      case 'bulkCreate':
        result = bulkCreateRows(sheet, sheetName, params.data || []);
        break;
      case 'update':
        result = updateRow(sheet, sheetName, params.id, params.data || {});
        break;
      case 'delete':
        result = deleteRow(sheet, sheetName, params.id);
        break;
      default:
        return jsonOut({ success: false, error: 'Unknown action: ' + action });
    }
    return jsonOut({ success: true, data: result });
  } catch (err) {
    return jsonOut({ success: false, error: err.message });
  }
}

// ------------------------------------------------------------
// PARAM PARSING — accepts JSON POST body, or GET querystring
// (with data/filters passed as JSON-encoded strings)
// ------------------------------------------------------------
function parseParams(e) {
  if (e.postData && e.postData.contents) {
    return JSON.parse(e.postData.contents);
  }
  var p = e.parameter || {};
  var out = { key: p.key, sheet: p.sheet, action: p.action, id: p.id };
  if (p.data) out.data = JSON.parse(p.data);
  if (p.filters) out.filters = JSON.parse(p.filters);
  return out;
}

// ------------------------------------------------------------
// SHEET HELPERS
// ------------------------------------------------------------
function getOrCreateSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(SCHEMAS[name]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getHeaders(sheetName) {
  return SCHEMAS[sheetName];
}

function rowToObject(headers, rowArray) {
  var obj = {};
  for (var i = 0; i < headers.length; i++) {
    obj[headers[i]] = rowArray[i] !== undefined ? rowArray[i] : '';
  }
  return obj;
}

function objectToRow(headers, obj) {
  return headers.map(function (h) {
    return obj[h] !== undefined && obj[h] !== null ? obj[h] : '';
  });
}

function getAllData(sheet) {
  var range = sheet.getDataRange();
  var values = range.getValues();
  return values; // includes header row at index 0
}

function listRows(sheet, sheetName, filters) {
  var headers = getHeaders(sheetName);
  var values = getAllData(sheet);
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var obj = rowToObject(headers, values[r]);
    if (matchesFilters(obj, filters)) rows.push(obj);
  }
  return rows;
}

function matchesFilters(obj, filters) {
  for (var key in filters) {
    if (!filters.hasOwnProperty(key)) continue;
    var want = String(filters[key]).toLowerCase();
    var have = String(obj[key] !== undefined ? obj[key] : '').toLowerCase();
    if (have !== want) return false;
  }
  return true;
}

function findRowIndexById(sheet, sheetName, id) {
  var headers = getHeaders(sheetName);
  var idCol = headers.indexOf('id');
  var values = getAllData(sheet);
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][idCol]) === String(id)) return r + 1; // 1-indexed sheet row
  }
  return -1;
}

function getRow(sheet, sheetName, id) {
  var headers = getHeaders(sheetName);
  var rowIdx = findRowIndexById(sheet, sheetName, id);
  if (rowIdx === -1) return null;
  var rowValues = sheet.getRange(rowIdx, 1, 1, headers.length).getValues()[0];
  return rowToObject(headers, rowValues);
}

function createRow(sheet, sheetName, data) {
  var headers = getHeaders(sheetName);
  var now = new Date().toISOString();
  if (!data.id) data.id = Utilities.getUuid();
  if (headers.indexOf('created_at') !== -1 && !data.created_at) data.created_at = now;
  if (headers.indexOf('updated_at') !== -1) data.updated_at = now;
  var row = objectToRow(headers, data);
  sheet.appendRow(row);
  return data;
}

function bulkCreateRows(sheet, sheetName, dataArray) {
  var headers = getHeaders(sheetName);
  var now = new Date().toISOString();
  var rows = dataArray.map(function (data) {
    if (!data.id) data.id = Utilities.getUuid();
    if (headers.indexOf('created_at') !== -1 && !data.created_at) data.created_at = now;
    if (headers.indexOf('updated_at') !== -1) data.updated_at = now;
    return objectToRow(headers, data);
  });
  if (rows.length > 0) {
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, headers.length).setValues(rows);
  }
  return dataArray;
}

function updateRow(sheet, sheetName, id, data) {
  var headers = getHeaders(sheetName);
  var rowIdx = findRowIndexById(sheet, sheetName, id);
  if (rowIdx === -1) throw new Error('Record not found: ' + id);

  var existingValues = sheet.getRange(rowIdx, 1, 1, headers.length).getValues()[0];
  var existing = rowToObject(headers, existingValues);
  var merged = Object.assign({}, existing, data, { id: id });
  if (headers.indexOf('updated_at') !== -1) merged.updated_at = new Date().toISOString();

  var newRow = objectToRow(headers, merged);
  sheet.getRange(rowIdx, 1, 1, headers.length).setValues([newRow]);
  return merged;
}

function deleteRow(sheet, sheetName, id) {
  var rowIdx = findRowIndexById(sheet, sheetName, id);
  if (rowIdx === -1) throw new Error('Record not found: ' + id);
  sheet.deleteRow(rowIdx);
  return { id: id, deleted: true };
}

// ------------------------------------------------------------
// SETTINGS (key/value sheet)
// ------------------------------------------------------------
function getSettingsSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SETTINGS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(SETTINGS_SHEET);
    sheet.appendRow(['key', 'value']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getSettings() {
  var sheet = getSettingsSheet_();
  var values = sheet.getDataRange().getValues();
  var out = {};
  for (var r = 1; r < values.length; r++) {
    var key = values[r][0];
    if (!key) continue;
    var raw = values[r][1];
    try { out[key] = JSON.parse(raw); } catch (e) { out[key] = raw; }
  }
  return out;
}

function setSettings(dataObj) {
  var sheet = getSettingsSheet_();
  var values = sheet.getDataRange().getValues();
  var keyToRow = {};
  for (var r = 1; r < values.length; r++) {
    keyToRow[values[r][0]] = r + 1;
  }
  for (var key in dataObj) {
    if (!dataObj.hasOwnProperty(key)) continue;
    var value = typeof dataObj[key] === 'object' ? JSON.stringify(dataObj[key]) : String(dataObj[key]);
    if (keyToRow[key]) {
      sheet.getRange(keyToRow[key], 2).setValue(value);
    } else {
      sheet.appendRow([key, value]);
    }
  }
  return getSettings();
}

// ------------------------------------------------------------
// OUTPUT
// ------------------------------------------------------------
function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
`;

function buildScript(secret) {
  return TEMPLATE.replace('__SECRET_KEY__', secret);
}

module.exports = { buildScript };