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

test('dispatches Instagram comment replies through the comment endpoint and tags them as comments', async () => {
  const events = [];

  const result = await sendOutboundMessage({
    clientId: 'client-1',
    userId: 'user-1',
    lead: { id: 'lead-1', external_id: 'ig-777', instagram: 'ig-777', email: 'person@example.com' },
    channel: 'instagram',
    body: 'Comment reply',
    replyType: 'comment',
    replyToExternalId: 'comment-123',
    deps: {
      whatsapp: { sendMessage: async () => { throw new Error('not used'); } },
      gmail: { sendEmail: async () => { throw new Error('not used'); } },
      instagram: {
        replyToComment: async (_userId, commentId, text) => {
          events.push(['replyToComment', commentId, text]);
          return 'comment-456';
        },
      },
      facebook: {
        replyToComment: async () => { throw new Error('not used'); },
      },
      recordMessage: async (_clientId, _leadId, payload) => {
        events.push(['record', payload]);
        return payload;
      },
    },
  });

  assert.equal(result.status, 'sent');
  assert.equal(result.external_id, 'comment-456');
  assert.deepEqual(events[0], ['replyToComment', 'comment-123', 'Comment reply']);
  assert.equal(events[1][1].message_type, 'comment');
});

test('dispatches Threads replies through replyToThread, tagged as comments', async () => {
  const events = [];

  const result = await sendOutboundMessage({
    clientId: 'client-1',
    userId: 'user-1',
    lead: { id: 'lead-1', external_id: null, email: null },
    channel: 'threads',
    body: 'Thanks for the reply!',
    replyToExternalId: 'reply-789',
    deps: {
      whatsapp: { sendMessage: async () => { throw new Error('not used'); } },
      gmail: { sendEmail: async () => { throw new Error('not used'); } },
      instagram: { sendDM: async () => { throw new Error('not used'); } },
      facebook: { sendDM: async () => { throw new Error('not used'); } },
      threads: {
        replyToThread: async (_userId, replyToId, text) => {
          events.push(['replyToThread', replyToId, text]);
          return 'thread-999';
        },
      },
      recordMessage: async (_clientId, _leadId, payload) => {
        events.push(['record', payload]);
        return payload;
      },
    },
  });

  assert.equal(result.status, 'sent');
  assert.equal(result.external_id, 'thread-999');
  assert.deepEqual(events[0], ['replyToThread', 'reply-789', 'Thanks for the reply!']);
  assert.equal(events[1][0], 'record');
  assert.equal(events[1][1].message_type, 'comment');
});

test('rejects a Threads reply with no inbound reply to answer', async () => {
  const result = await sendOutboundMessage({
    clientId: 'client-1',
    userId: 'user-1',
    lead: { id: 'lead-1' },
    channel: 'threads',
    body: 'Hello?',
    deps: {
      whatsapp: { sendMessage: async () => { throw new Error('not used'); } },
      gmail: { sendEmail: async () => { throw new Error('not used'); } },
      instagram: { sendDM: async () => { throw new Error('not used'); } },
      facebook: { sendDM: async () => { throw new Error('not used'); } },
      threads: { replyToThread: async () => { throw new Error('not used'); } },
      recordMessage: async (_clientId, _leadId, payload) => payload,
    },
  });

  assert.equal(result.status, 'failed');
  assert.match(result.error_reason, /No reply to answer/);
});
