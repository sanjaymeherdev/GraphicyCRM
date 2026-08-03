const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon';

const instagramService = require('../modules/instagram/service');

test('buildGraphRequestCandidates tries page and account endpoints across FB and IG hosts', () => {
  const conn = { page_id: 'page_123', account_id: 'ig_456' };
  const urls = instagramService.buildGraphRequestCandidates(conn, '/messages');

  assert.deepEqual(urls.slice(0, 2), [
    'https://graph.facebook.com/v25.0/page_123/messages',
    'https://graph.facebook.com/v25.0/ig_456/messages',
  ]);
  assert.ok(urls.includes('https://graph.instagram.com/ig_456/messages'));
  assert.ok(urls.includes('https://graph.instagram.com/page_123/messages'));
});
