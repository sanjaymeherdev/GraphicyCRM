// modules/reports/routes.js
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const { requireClient } = require('../../shared/clientContext');
const service = require('./service');

const router = express.Router();
router.use(requireAuth, requireClient);

router.get('/', async (req, res) => {
  try { res.json(await service.getReport(req.clientId, { from: req.query.from, to: req.query.to })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
