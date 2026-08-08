// modules/sheets/routes.js — Google connect flow lives at /api/google.
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const service = require('./service');

const router = express.Router();
router.use(requireAuth);

// GET /list (a Drive-backed "pick your spreadsheet" dropdown) was removed
// — it needed the `drive` scope, which isn't in this app's approved OAuth
// scopes. The Sheet→Leads watcher UI now takes a pasted spreadsheetId/URL
// directly; '/:spreadsheetId/tabs' etc. below still work off that pasted ID
// since they only need the `spreadsheets` scope.

router.get('/:spreadsheetId/tabs', async (req, res) => {
  try { res.json({ success: true, tabs: await service.listTabs(req.user.id, req.params.spreadsheetId) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:spreadsheetId/:worksheet/headers', async (req, res) => {
  try { res.json({ success: true, headers: await service.getHeaders(req.user.id, req.params.spreadsheetId, req.params.worksheet) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:spreadsheetId/:worksheet/rows', async (req, res) => {
  try { res.json({ success: true, rows: await service.getRows(req.user.id, req.params.spreadsheetId, req.params.worksheet) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:spreadsheetId/:worksheet/values', async (req, res) => {
  try { res.json({ success: true, values: await service.getValues(req.user.id, req.params.spreadsheetId, req.params.worksheet, req.query.range) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:spreadsheetId/:worksheet/values', async (req, res) => {
  const { range, values } = req.body || {};
  if (!range || !values) return res.status(400).json({ error: 'range and values required' });
  try { res.json({ success: true, result: await service.updateRange(req.user.id, req.params.spreadsheetId, req.params.worksheet, range, values) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:spreadsheetId/:worksheet/rows', async (req, res) => {
  const { rows } = req.body || {}; // rows: 2D array
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows (2D array) required' });
  try { res.json({ success: true, result: await service.appendRows(req.user.id, req.params.spreadsheetId, req.params.worksheet, rows) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Watchers (poll-based automation triggers) ---
router.get('/watchers', async (req, res) => {
  try { res.json({ success: true, watchers: await service.listWatchers(req.user.id) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/watchers', async (req, res) => {
  try { res.json({ success: true, watcher: await service.createWatcher(req.user.id, req.body || {}) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/watchers/:id', async (req, res) => {
  try { res.json({ success: true, watcher: await service.updateWatcher(req.user.id, req.params.id, req.body || {}) }); }
  catch (err) { res.status(err.message === 'Watcher not found' ? 404 : 400).json({ error: err.message }); }
});

router.delete('/watchers/:id', async (req, res) => {
  try { await service.deleteWatcher(req.user.id, req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
