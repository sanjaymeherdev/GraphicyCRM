const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon';

const instagramService = require('../modules/instagram/service');

test('buildGraphRequestCandidates only ever uses account_id (never page_id), FB host first for Page-linked connections', () => {
  const conn = { page_id: 'page_123', account_id: 'ig_456' };
  const urls = instagramService.buildGraphRequestCandidates(conn, '/messages');

  assert.deepEqual(urls, [
    'https://graph.facebook.com/v25.0/ig_456/messages',
    'https://graph.instagram.com/ig_456/messages',
  ]);
});

test('buildGraphRequestCandidates tries graph.instagram.com first for Direct Instagram Login connections (no page_id)', () => {
  const conn = { page_id: null, account_id: 'ig_789' };
  const urls = instagramService.buildGraphRequestCandidates(conn, '/messages');

  assert.deepEqual(urls, [
    'https://graph.instagram.com/ig_789/messages',
    'https://graph.facebook.com/v25.0/ig_789/messages',
  ]);
});
