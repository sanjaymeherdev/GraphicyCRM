// modules/contacts/routes.js
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const { requireClient } = require('../../shared/clientContext');
const service = require('./service');

const router = express.Router();
router.use(requireAuth, requireClient);

router.get('/', async (req, res) => {
  try { res.json({ contacts: await service.listContacts(req.clientId) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try { res.json({ success: true, contact: await service.createContact(req.clientId, req.body || {}) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
