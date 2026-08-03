process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sendOutboundMessage } = require('../modules/leads/service');

test('dispatches Instagram replies through the Meta DM sender and records them', async () => {
  const events = [];

  const result = await sendOutboundMessage({
    clientId: 'client-1',
    userId: 'user-1',
    lead: { id: 'lead-1', external_id: 'ig-777', instagram: 'ig-777', email: 'person@example.com' },
    channel: 'instagram',
    body: 'Hello from the inbox',
    deps: {
      whatsapp: { sendMessage: async () => { throw new Error('not used'); } },
      gmail: { sendEmail: async () => { throw new Error('not used'); } },
      instagram: {
        sendDM: async (_userId, recipientId, text) => {
          events.push(['sendDM', recipientId, text]);
          return 'msg-123';
        },
      },
      facebook: {
        sendDM: async () => { throw new Error('not used'); },
      },
      recordMessage: async (_clientId, _leadId, payload) => {
        events.push(['record', payload]);
        return payload;
      },
    },
  });

  assert.equal(result.status, 'sent');
  assert.equal(result.external_id, 'msg-123');
  assert.deepEqual(events[0], ['sendDM', 'ig-777', 'Hello from the inbox']);
  assert.equal(events[1][0], 'record');
});
