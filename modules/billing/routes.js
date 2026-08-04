// modules/billing/routes.js
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const { requireClient } = require('../../shared/clientContext');
const service = require('./service');

const router = express.Router();
router.use(requireAuth, requireClient);

router.get('/subscription', async (req, res) => {
  try { res.json({ subscription: await service.getSubscription(req.clientId) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/checkout', async (req, res) => {
  try { res.json({ success: true, ...(await service.createCheckout(req.clientId, req.body || {})) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
