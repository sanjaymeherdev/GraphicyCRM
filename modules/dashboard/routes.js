// modules/dashboard/routes.js
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const { requireClient } = require('../../shared/clientContext');
const service = require('./service');

const router = express.Router();
router.use(requireAuth, requireClient);

router.get('/stats', async (req, res) => {
  try { res.json(await service.getStats(req.clientId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
