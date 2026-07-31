// modules/profile/routes.js — /api/profile and /api/client
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const { requireClient } = require('../../shared/clientContext');
const service = require('./service');

const router = express.Router();
router.use(requireAuth, requireClient);

router.get('/profile', async (req, res) => {
  try { res.json(await service.getProfile(req.user.id, req.user.email)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/profile', async (req, res) => {
  try { res.json({ success: true, profile: await service.updateProfile(req.user.id, req.body || {}) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/client', async (req, res) => {
  try { res.json(await service.getMyClient(req.clientId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
