// modules/education/routes.js
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const { requireClient } = require('../../shared/clientContext');
const service = require('./service');
const { buildScript } = require('./appsScript');

const router = express.Router();
router.use(requireAuth, requireClient);

// ---------------------------------------------------------------------
// Connection setup — mirrors modules/mail-capture's /script + / pattern.
// Step 1: frontend calls GET /script, shows the returned code block for
// the person to paste into a new Apps Script project and deploy.
// Step 2: frontend calls POST / with the resulting /exec URL (the secret
// from step 1 is resent here so it gets persisted alongside it).
// ---------------------------------------------------------------------
router.get('/script', (req, res) => {
  const secret = service.generateSecret();
  res.json({ success: true, secret, script: buildScript(secret) });
});

router.get('/config', async (req, res) => {
  try { res.json({ success: true, config: await service.getConfig(req.clientId) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/config', async (req, res) => {
  const { scriptUrl, secret, schoolName, active } = req.body || {};
  try {
    const config = await service.saveConfig(req.clientId, { scriptUrl, secretKey: secret, schoolName, active });
    res.json({ success: true, config });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/config', async (req, res) => {
  try { await service.deleteConfig(req.clientId); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------------------------------------------------------------------
// Generic per-sheet CRUD. One route block per resource — thin wrappers
// around service.js's `resource()`-bound objects, all proxying to the
// person's own Apps Script deployment.
// ---------------------------------------------------------------------
function mountResource(path, res_) {
  // GET list (query params become sheet-column filters, e.g. ?class_id=5)
  router.get(path, async (req, res) => {
    try { res.json({ success: true, data: await res_.list(req.clientId, req.query || {}) }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });
  router.get(`${path}/:id`, async (req, res) => {
    try {
      const row = await res_.get(req.clientId, req.params.id);
      if (!row) return res.status(404).json({ error: 'Not found' });
      res.json({ success: true, data: row });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
  router.post(path, async (req, res) => {
    try { res.json({ success: true, data: await res_.create(req.clientId, req.body || {}) }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });
  router.post(`${path}/bulk`, async (req, res) => {
    try { res.json({ success: true, data: await res_.bulkCreate(req.clientId, req.body?.rows || []) }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });
  router.put(`${path}/:id`, async (req, res) => {
    try { res.json({ success: true, data: await res_.update(req.clientId, req.params.id, req.body || {}) }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });
  router.delete(`${path}/:id`, async (req, res) => {
    try { res.json({ success: true, data: await res_.remove(req.clientId, req.params.id) }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });
}

mountResource('/students', service.students);
mountResource('/teachers', service.teachers);
mountResource('/staff', service.staff);
mountResource('/classes', service.classes);
mountResource('/attendance', service.attendance);
mountResource('/fees', service.fees);
mountResource('/invoices', service.invoices);
mountResource('/invoice-templates', service.invoiceTemplates);
mountResource('/message-templates', service.messageTemplates);
mountResource('/message-log', service.messageLog);

// ---------------------------------------------------------------------
// Settings (key/value sheet — school name, default templates, auto-send
// toggles for birthday.html/fee.html/invoice.html/settings.html).
// ---------------------------------------------------------------------
router.get('/settings', async (req, res) => {
  try { res.json({ success: true, data: await service.getSettings(req.clientId) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.put('/settings', async (req, res) => {
  try { res.json({ success: true, data: await service.setSettings(req.clientId, req.body || {}) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

// ---------------------------------------------------------------------
// Manual send — the "Send Reminder Now" / "Send Invoice" buttons on
// birthday.html/fee.html/invoice.html/bulk_send.html. Requires an
// APPROVED Meta WhatsApp template name (see service.js header comment on
// why this can't be free-form text for cold outbound).
// ---------------------------------------------------------------------
router.post('/send', async (req, res) => {
  const { studentId, name, phone, templateName, language, components, module: moduleName } = req.body || {};
  if (!templateName) return res.status(400).json({ error: 'templateName is required (must be a Meta-approved WhatsApp template)' });
  try {
    const result = await service.sendToStudent(req.clientId, {
      studentId, name, phone, templateName, language, components, module: moduleName || 'bulk_send',
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Manual "run reminders now" — lets the Settings UI offer a "Test" button
// instead of waiting for the next poll tick (see server.js).
router.post('/poll-now', async (req, res) => {
  try {
    await service.pollRemindersForClient(req.clientId);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;