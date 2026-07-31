// modules/inbox/routes.js
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const { requireClient } = require('../../shared/clientContext');
const service = require('./service');

const router = express.Router();
router.use(requireAuth, requireClient);

router.get('/', async (req, res) => {
  try { res.json({ threads: await service.getInbox(req.clientId, { channel: req.query.channel }) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
