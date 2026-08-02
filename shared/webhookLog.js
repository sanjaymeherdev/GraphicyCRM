// shared/webhookLog.js — a raw audit trail of every webhook delivery any
// channel module receives, valid or signature-rejected. Ported from the
// original repo's wb_webhook_logs (WhatsApp-only there); generalized here
// across whatsapp/facebook/instagram/threads via the `channel` column.
//
// Deliberately fire-and-forget: logging a delivery must never slow down or
// block the webhook's ack response (Meta expects a fast 200, and will
// retry-storm an endpoint that's slow to respond).
const { supabase } = require('./db');

function logWebhookDelivery({ channel, accountId, objectType, fields, signatureValid, rejectReason, payload }) {
  supabase.from('crm_webhook_logs').insert({
    channel,
    account_id: accountId || null,
    object_type: objectType || null,
    fields: fields || [],
    signature_valid: signatureValid,
    reject_reason: rejectReason || null,
    payload: payload || null,
  }).then(({ error }) => {
    if (error) console.error(`[webhook-log] failed to write ${channel} audit log:`, error.message);
  });
}

module.exports = { logWebhookDelivery };
