// js/api.js - API Client Module
const API = (() => {
  const STORAGE_KEY = 'crm_auth_token';
  const CLIENT_KEY = 'crm_client_id';

  let _token = localStorage.getItem(STORAGE_KEY) || null;
  let _clientId = localStorage.getItem(CLIENT_KEY) || null;

  function getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (_token) headers['Authorization'] = `Bearer ${_token}`;
    if (_clientId) headers['X-Client-ID'] = _clientId;
    return headers;
  }

	async function request(endpoint, method = 'GET', body = null) {
	  const opts = { method, headers: getHeaders() };
	  if (body) opts.body = JSON.stringify(body);

	  try {
		// Use relative URL - no need for origin
		const res = await fetch(endpoint, opts);
		
		// Only redirect on 401 if we have a token
		if (res.status === 401) {
		  // logout();
		  throw new Error('Session expired');
		}
		
		const data = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
		return data;
	  } catch (err) {
		console.warn(`API Error [${endpoint}]:`, err);
		// Return mock data as fallback
		return getMockData(endpoint);
	  }
	}

  function get(endpoint) { return request(endpoint, 'GET'); }
  function post(endpoint, body) { return request(endpoint, 'POST', body); }
  function put(endpoint, body) { return request(endpoint, 'PUT', body); }
  function del(endpoint) { return request(endpoint, 'DELETE'); }

  function setToken(token) {
    _token = token;
    if (token) localStorage.setItem(STORAGE_KEY, token);
    else localStorage.removeItem(STORAGE_KEY);
  }

  function setClientId(clientId) {
    _clientId = clientId;
    if (clientId) localStorage.setItem(CLIENT_KEY, clientId);
    else localStorage.removeItem(CLIENT_KEY);
  }

  async function logout() {
    // The dashboard is authenticated by a session cookie (see shared/auth.js),
    // not the localStorage token below — clearing localStorage alone left
    // the server-side session (and therefore the logged-in cookie) intact,
    // so the button appeared to do nothing. POST /api/auth/logout destroys
    // that session; the redirect below is what actually leaves the page.
    try {
      await post('/api/auth/logout');
    } catch (err) {
      console.warn('Logout request failed (clearing local session anyway):', err);
    }
    _token = null;
    _clientId = null;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(CLIENT_KEY);
    window.location.href = '/login';
  }

  function getToken() { return _token; }
  function getClientId() { return _clientId; }

  // ─── MOCK DATA ───
  function getMockData(endpoint) {
    const mocks = {
      '/api/theme': () => ({
        primary: '#22d172',
        primaryDark: '#1bbf64',
        bg: '#080b10',
        bg2: '#0c1018',
        surface: '#0f1520',
        surface2: '#141c2a',
        surface3: '#1a2335',
        border: '#1e2d42',
        border2: '#263550',
        text: '#e8f0fb',
        text2: '#7a90b0',
        text3: '#445570',
        green: '#22d172',
        amber: '#f5a623',
        red: '#f04f6e',
        blue: '#3d8ef5',
        purple: '#9d78fa',
        pink: '#ec4899',
        radius: '16px',
        radiusSm: '10px',
        fontFamily: "'DM Sans', sans-serif",
        isDark: true,
      }),
      '/api/profile': () => ({
        user: {
          id: 'user_1',
          name: 'Sarah Mitchell',
          email: 'sarah@acmecorp.com',
          role: 'client',
          channels: ['WhatsApp', 'Instagram', 'Facebook'],
          connections: [
            { platform: 'whatsapp', icon: '📱', label: 'WhatsApp', account_name: '+1 555-0100' },
            { platform: 'instagram', icon: '📷', label: 'Instagram', account_name: '@acmecorp' },
            { platform: 'facebook', icon: '👥', label: 'Facebook', account_name: 'Acme Corp Page' },
          ],
        }
      }),
      '/api/client': () => ({
        client: { id: 'client_1', name: 'Acme Corp', role: 'Client' }
      }),
      '/api/leads': () => ({
        leads: [
          { id: 'lead_1', name: 'John Smith', phone: '+1 234 567 890', email: 'john@example.com', source: 'whatsapp', status: 'new', notes: 'Interested in product', created_at: new Date(Date.now() - 3600000).toISOString(), updated_at: new Date(Date.now() - 3600000).toISOString() },
          { id: 'lead_2', name: 'Sarah Lee', phone: '+1 345 678 901', email: 'sarah@example.com', source: 'instagram', status: 'contacted', notes: 'Follow up next week', created_at: new Date(Date.now() - 86400000).toISOString(), updated_at: new Date(Date.now() - 3600000).toISOString() },
          { id: 'lead_3', name: 'Mike Johnson', phone: '+1 456 789 012', email: 'mike@example.com', source: 'facebook', status: 'converted', notes: 'Deal closed', created_at: new Date(Date.now() - 172800000).toISOString(), updated_at: new Date(Date.now() - 7200000).toISOString() },
          { id: 'lead_4', name: 'Emma Wilson', phone: '+1 567 890 123', email: 'emma@example.com', source: 'webform', status: 'engaged', notes: 'Sent proposal', created_at: new Date(Date.now() - 259200000).toISOString(), updated_at: new Date(Date.now() - 1800000).toISOString() },
          { id: 'lead_5', name: 'David Brown', phone: '+1 678 901 234', email: 'david@example.com', source: 'email', status: 'lost', notes: 'Not interested', created_at: new Date(Date.now() - 345600000).toISOString(), updated_at: new Date(Date.now() - 86400000).toISOString() },
        ]
      }),
      '/api/contacts': () => ({
        contacts: [
          { id: 'cont_1', name: 'Alice Johnson', phone: '+1 234 567 891', email: 'alice@example.com', source: 'whatsapp', status: 'contacted', updated_at: new Date(Date.now() - 1800000).toISOString() },
          { id: 'cont_2', name: 'Bob Williams', phone: '+1 345 678 902', email: 'bob@example.com', source: 'instagram', status: 'new', updated_at: new Date(Date.now() - 7200000).toISOString() },
          { id: 'cont_3', name: 'Carol Davis', phone: '+1 456 789 013', email: 'carol@example.com', source: 'facebook', status: 'converted', updated_at: new Date(Date.now() - 14400000).toISOString() },
        ]
      }),
      '/api/inbox': () => ({
        threads: [
          { id: 'thread_1', name: 'John Smith', phone: '+1 234 567 890', channel: 'whatsapp', last_message: 'Hi, I\'m interested in your services', last_message_at: new Date(Date.now() - 300000).toISOString(), needs_reply: true, messages: [{ id: 'm1', body: 'Hi, I\'m interested in your services', direction: 'in', channel: 'whatsapp', created_at: new Date(Date.now() - 300000).toISOString() }] },
          { id: 'thread_2', name: 'Sarah Lee', phone: '+1 345 678 901', channel: 'instagram', last_message: 'Can you send me more info?', last_message_at: new Date(Date.now() - 1800000).toISOString(), needs_reply: true, messages: [{ id: 'm2', body: 'Can you send me more info?', direction: 'in', channel: 'instagram', created_at: new Date(Date.now() - 1800000).toISOString() }] },
          { id: 'thread_3', name: 'Mike Johnson', phone: '+1 456 789 012', channel: 'facebook', last_message: 'Thanks for your help!', last_message_at: new Date(Date.now() - 3600000).toISOString(), needs_reply: false, messages: [{ id: 'm3', body: 'Thanks for your help!', direction: 'in', channel: 'facebook', created_at: new Date(Date.now() - 3600000).toISOString() }] },
        ]
      }),
      '/api/dashboard/stats': () => ({
        total: 0,
        converted: 0,
        lost: 0,
        pending: 0,
      }),
      '/api/automations': () => ({
        automations: [
          { id: 'auto_1', name: 'Welcome Message', keywords: ['hi', 'hello'], match_type: 'contains', action_type: 'template', template_id: null, ai_prompt: '', ai_fallback: '', conditions: [], else_template_id: null, follow_up: { enabled: false, hours: 4, condition: 'no_reply', template_id: null } },
        ]
      }),
      '/api/templates': () => ({
        templates: [
          { id: 'tpl_1', name: 'Welcome Template', type: 'plaintext', body: 'Welcome to our service! How can we help?', footer: '' },
          { id: 'tpl_2', name: 'Follow-up Template', type: 'plaintext', body: 'Just checking in - any questions?', footer: '' },
        ]
      }),
      '/api/schedule/posts': () => ({
        posts: [
          { id: 'post_1', title: 'Launch teaser', caption: 'Something new is coming 👀', hook: '', platforms: ['instagram', 'facebook'], media_url: '', scheduled_date: new Date(Date.now() + 3600000 * 5).toISOString(), status: 'scheduled', published_ids: {}, publish_errors: {}, created_at: new Date(Date.now() - 3600000).toISOString() },
          { id: 'post_2', title: 'Behind the scenes', caption: 'A peek at how we build things.', hook: '', platforms: ['threads'], media_url: '', scheduled_date: new Date(Date.now() - 3600000 * 20).toISOString(), status: 'published', published_ids: { threads: 'thread_abc123' }, publish_errors: {}, created_at: new Date(Date.now() - 3600000 * 25).toISOString() },
          { id: 'post_3', title: 'Weekend promo', caption: 'Draft — needs a final caption pass.', hook: '', platforms: ['facebook', 'linkedin'], media_url: '', scheduled_date: null, status: 'draft', published_ids: {}, publish_errors: {}, created_at: new Date(Date.now() - 7200000).toISOString() },
        ]
      }),
      '/api/insights/account': (endpoint) => {
        const platform = new URLSearchParams(endpoint.split('?')[1]).get('platform') || 'instagram';
        const byPlatform = {
          facebook: { followers: 3421, likes: 128, comments: 34, shares: 12, reach: 9800 },
          instagram: { followers: 5890, views: 21400, likes: 940, comments: 88, reach: 15200 },
          threads: { followers: 1204, views: 6100, likes: 210, replies: 45, reposts: 9, quotes: 3 },
        };
        return { data: byPlatform[platform] || {} };
      },
      '/api/insights/posts': (endpoint) => {
        const platform = new URLSearchParams(endpoint.split('?')[1]).get('platform') || 'instagram';
        return {
          data: [
            { id: 'ip_1', caption: 'Our new feature is live!', message: 'Our new feature is live!', date: new Date(Date.now() - 86400000).toISOString(), thumbnail: null, likes: 210, comments: 18, shares: 6, saves: 22, reach: 4200, replies: 0, reposts: 0, quotes: 0 },
            { id: 'ip_2', caption: 'Customer story: how Acme grew 3x', message: 'Customer story: how Acme grew 3x', date: new Date(Date.now() - 3 * 86400000).toISOString(), thumbnail: null, likes: 156, comments: 9, shares: 3, saves: 11, reach: 3100, replies: 0, reposts: 0, quotes: 0 },
          ].map(p => ({ ...p, platform }))
        };
      },
      '/api/insights/snapshots': () => ({
        snapshots: Array.from({ length: 7 }, (_, i) => ({
          captured_at: new Date(Date.now() - (6 - i) * 86400000).toISOString(),
          followers: 5600 + i * 40,
          metrics: { views: 2000 + i * 300, likes: 100 + i * 15 },
        }))
      }),
      '/api/ai-bot/models': () => ({
        models: [
          'meta/llama-3.1-70b-instruct', 'meta/llama-3.1-8b-instruct',
          'meta/llama-3.2-11b-vision-instruct', 'meta/llama-3.2-3b-instruct', 'meta/llama-3.2-90b-vision-instruct',
          'mistralai/mistral-medium-3.5-128b',
          'nvidia/ising-calibration-1-35b-a3b', 'nvidia/llama-3.1-nemotron-nano-vl-8b-v1',
          'nvidia/llama-3.3-nemotron-super-49b-v1', 'nvidia/nemotron-3-nano-30b-a3b',
          'nvidia/nemotron-3-super-120b-a12b', 'nvidia/nemotron-nano-12b-v2-vl',
        ],
        default_model: 'meta/llama-3.1-70b-instruct',
      }),
    };

    // '/api/sheets/:id/tabs' and '/api/sheets/:id/:worksheet/headers' have a
    // variable id in the middle, so they can't be matched by a fixed prefix
    // key above — match on the fixed suffix instead.
    if (endpoint.includes('/api/sheets/') && endpoint.endsWith('/tabs')) return { tabs: ['Sheet1', 'Sheet2'] };
    if (endpoint.includes('/api/sheets/') && endpoint.endsWith('/headers')) return { headers: ['Name', 'Phone', 'Email', 'Date'] };

    // Find matching mock
    for (const [path, fn] of Object.entries(mocks)) {
      if (endpoint.startsWith(path)) return fn(endpoint);
    }
    return { error: 'No mock data for ' + endpoint };
  }

  // ─── THEME ───
  async function getTheme() {
    return await get('/api/theme');
  }

  async function saveTheme(theme) {
    return await post('/api/theme', theme);
  }

  // ─── AUTH ───
  async function getProfile() {
    return await get('/api/profile');
  }

  async function updateProfile(data) {
    return await put('/api/profile', data);
  }

  // ─── CLIENT (own record only — full client list/CRUD lives in the separate admin app) ───
  async function getMyClient() {
    return await get('/api/client');
  }

  // ─── LEADS ───
  async function getLeads(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return await get(`/api/leads${qs ? '?' + qs : ''}`);
  }

  async function createLead(data) {
    return await post('/api/leads', data);
  }

  async function updateLead(id, data) {
    return await put(`/api/leads/${id}`, data);
  }

  async function deleteLead(id) {
    return await del(`/api/leads/${id}`);
  }

  async function getLeadMessages(id, channel) {
    return await get(`/api/leads/${id}/messages${channel ? '?channel=' + channel : ''}`);
  }

  async function sendMessage(id, data) {
    return await post(`/api/leads/${id}/messages`, data);
  }

  // ─── CONTACTS ───
  async function getContacts(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return await get(`/api/contacts${qs ? '?' + qs : ''}`);
  }

  async function createContact(data) {
    return await post('/api/contacts', data);
  }

  // ─── INBOX ───
  async function getInbox(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return await get(`/api/inbox${qs ? '?' + qs : ''}`);
  }

  // ─── AUTOMATIONS ───
  async function getAutomations() {
    return await get('/api/automations');
  }

  async function createAutomation(data) {
    return await post('/api/automations', data);
  }

  async function updateAutomation(id, data) {
    return await put(`/api/automations/${id}`, data);
  }

  async function deleteAutomation(id) {
    return await del(`/api/automations/${id}`);
  }

  // ─── TEMPLATES ───
  async function getTemplates() {
    return await get('/api/templates');
  }

  async function createTemplate(data) {
    return await post('/api/templates', data);
  }

  async function updateTemplate(id, data) {
    return await put(`/api/templates/${id}`, data);
  }

  async function deleteTemplate(id) {
    return await del(`/api/templates/${id}`);
  }

  // ─── SOURCES / INTEGRATIONS ───
  async function getIntegrations() {
    return await get('/api/integrations');
  }

  async function connectIntegration(id) {
    return await post(`/api/integrations/${id}/connect`);
  }

  async function getOAuthUrl(service) {
    return await get(`/api/oauth/${service}/url`);
  }

  async function disconnectOAuth(service) {
    return await del(`/api/oauth/${service}`);
  }

  async function resubscribeFacebookWebhooks() {
    return await post('/api/facebook/resubscribe');
  }

  async function getFacebookWebhookStatus() {
    return await get('/api/facebook/webhook-status');
  }

  async function disconnectWhatsAppAccount(id) {
    return await del(`/api/whatsapp/accounts/${id}`);
  }

  // ─── SHEET WATCHERS (sheet → lead mapping) ───
  async function getSheetWatchers() {
    return await get('/api/sheets/watchers');
  }

  async function createSheetWatcher(data) {
    return await post('/api/sheets/watchers', data);
  }

  async function updateSheetWatcher(id, data) {
    return await put(`/api/sheets/watchers/${id}`, data);
  }

  async function deleteSheetWatcher(id) {
    return await del(`/api/sheets/watchers/${id}`);
  }

  async function getSheetRows(spreadsheetId, worksheet) {
    return await get(`/api/sheets/${encodeURIComponent(spreadsheetId)}/${encodeURIComponent(worksheet)}/rows`);
  }

  // ─── MAIL CAPTURE (Sources → Capture Mail, Apps-Script-based Gmail
  // polling — see modules/mail-capture) ───
  async function getMailCaptureScript() {
    return await get('/api/mail-capture/script');
  }

  async function getMailCaptureConfig() {
    return await get('/api/mail-capture');
  }

  async function saveMailCaptureConfig(data) {
    return await post('/api/mail-capture', data);
  }

  async function deleteMailCaptureConfig() {
    return await del('/api/mail-capture');
  }

  async function testMailCaptureNow() {
    return await post('/api/mail-capture/poll-now');
  }

  // ─── DROPDOWN PICKERS (Google Sheets tabs/headers — spreadsheet itself is
  // now referenced by a pasted ID, not a Drive-backed list; see
  // shared/googleAuth.js's GOOGLE_SCOPES for why) ───
  async function listSheetTabs(spreadsheetId) {
    return await get(`/api/sheets/${encodeURIComponent(spreadsheetId)}/tabs`);
  }

  async function listSheetHeaders(spreadsheetId, worksheet) {
    return await get(`/api/sheets/${encodeURIComponent(spreadsheetId)}/${encodeURIComponent(worksheet)}/headers`);
  }

  // ─── AI BOT ───
  async function getAvailableModels() {
    return await get('/api/ai-bot/models');
  }

  async function getChatbotRules() {
    return await get('/api/ai-bot/rules');
  }

  async function createChatbotRule(data) {
    return await post('/api/ai-bot/rules', data);
  }

  async function updateChatbotRule(id, data) {
    return await put(`/api/ai-bot/rules/${id}`, data);
  }

  async function deleteChatbotRule(id) {
    return await del(`/api/ai-bot/rules/${id}`);
  }

  async function sendChatbotMessage(messages, options = {}) {
    return await post('/api/ai-bot/chat', { messages, ...options });
  }

  // ─── HELP ASSISTANT (floating popup — "how do I use this" + dev module Q&A) ───
  async function getHelpBotModules() {
    return await get('/api/help-bot/modules');
  }

  async function sendHelpBotMessage(history, options = {}) {
    return await post('/api/help-bot/chat', { history, ...options });
  }

  // ─── SETTINGS ───
  async function getSettings() {
    return await get('/api/settings');
  }

  async function saveSettings(data) {
    return await post('/api/settings', data);
  }

  // ─── REPORTS ───
  async function getReport(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return await get(`/api/reports${qs ? '?' + qs : ''}`);
  }

  // ─── DASHBOARD ───
  async function getDashboardStats() {
    return await get('/api/dashboard/stats');
  }

  // ─── WEBHOOK ───
  async function generateWebhook() {
    return await post('/api/webhook/generate');
  }

  // ─── WHATSAPP ───
  async function verifyWhatsApp(wabaId, token) {
    return await post('/api/wa/verify', { waba_id: wabaId, access_token: token });
  }

  async function connectWhatsApp(wabaId, phoneNumberId, token) {
    return await post('/api/whatsapp/accounts', { waba_id: wabaId, phone_number_id: phoneNumberId, access_token: token });
  }

  // ─── SCHEDULE (content posts across facebook/instagram/threads/linkedin) ───
  async function getScheduledPosts(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return await get(`/api/schedule/posts${qs ? '?' + qs : ''}`);
  }

  async function createScheduledPost(data) {
    return await post('/api/schedule/posts', data);
  }

  async function updateScheduledPost(id, data) {
    return await put(`/api/schedule/posts/${id}`, data);
  }

  async function deleteScheduledPost(id) {
    return await del(`/api/schedule/posts/${id}`);
  }

  async function publishPostNow(id) {
    return await post(`/api/schedule/posts/${id}/publish`);
  }

  // Uploads a file to the shared owner Google Drive (see modules/media) and
  // returns { google_drive_file_id, filename, media_url } — media_url is a
  // signed, long-lived proxy link Meta/LinkedIn can fetch directly. Can't
  // reuse request()/post() above: those always JSON.stringify the body and
  // force Content-Type: application/json, which breaks a multipart upload.
  // The browser needs to set Content-Type itself (with the multipart
  // boundary) when the body is a FormData, so only Authorization/client
  // headers are sent explicitly here.
  async function uploadMedia(file, onProgress) {
    const form = new FormData();
    form.append('file', file);

    const headers = {};
    if (_token) headers['Authorization'] = `Bearer ${_token}`;
    if (_clientId) headers['X-Client-ID'] = _clientId;

    // Plain fetch has no upload-progress event, so use XHR when the caller
    // wants progress callbacks (e.g. a progress bar for large video files);
    // fall back to fetch otherwise for simplicity.
    if (typeof onProgress === 'function') {
      return await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/media/upload');
        Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
        xhr.onload = () => {
          let data = {};
          try { data = JSON.parse(xhr.responseText || '{}'); } catch { /* non-JSON error body */ }
          if (xhr.status >= 200 && xhr.status < 300) resolve(data);
          else reject(new Error(data.error || `Upload failed (${xhr.status})`));
        };
        xhr.onerror = () => reject(new Error('Upload failed — network error'));
        xhr.send(form);
      });
    }

    const res = await fetch('/api/media/upload', { method: 'POST', headers, body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
    return data;
  }

  // ─── INSIGHTS ───
  async function getAccountInsights(platform, fresh) {
    return await get(`/api/insights/account?platform=${platform}${fresh ? '&fresh=1' : ''}`);
  }

  async function getPostInsights(platform) {
    return await get(`/api/insights/posts?platform=${platform}`);
  }

  async function getInsightsSnapshots(platform) {
    return await get(`/api/insights/snapshots?platform=${platform}`);
  }

  return {
    // Auth
    setToken,
    setClientId,
    getToken,
    getClientId,
    logout,
    getProfile,
    updateProfile,

    // Client (own record)
    getMyClient,

    // Theme
    getTheme,
    saveTheme,

    // Leads
    getLeads,
    createLead,
    updateLead,
    deleteLead,
    getLeadMessages,
    sendMessage,

    // Contacts
    getContacts,
    createContact,

    // Inbox
    getInbox,

    // Automations
    getAutomations,
    createAutomation,
    updateAutomation,
    deleteAutomation,

    // Templates
    getTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,

    // Integrations
    getIntegrations,
    connectIntegration,
    getOAuthUrl,
    disconnectOAuth,
    resubscribeFacebookWebhooks,
    getFacebookWebhookStatus,
    disconnectWhatsAppAccount,
    getSheetWatchers,
    createSheetWatcher,
    updateSheetWatcher,
    deleteSheetWatcher,
    getSheetRows,
    listSheetTabs,
    listSheetHeaders,
    getMailCaptureScript,
    getMailCaptureConfig,
    saveMailCaptureConfig,
    deleteMailCaptureConfig,
    testMailCaptureNow,
    getAvailableModels,
    getChatbotRules,
    createChatbotRule,
    updateChatbotRule,
    deleteChatbotRule,
    sendChatbotMessage,
    getHelpBotModules,
    sendHelpBotMessage,

    // Settings
    getSettings,
    saveSettings,

    // Reports
    getReport,

    // Dashboard
    getDashboardStats,

    // Webhook
    generateWebhook,

    // WhatsApp
    verifyWhatsApp,
    connectWhatsApp,

    // Schedule
    getScheduledPosts,
    createScheduledPost,
    updateScheduledPost,
    deleteScheduledPost,
    publishPostNow,
    uploadMedia,

    // Insights
    getAccountInsights,
    getPostInsights,
    getInsightsSnapshots,

    // Utils
    request,
    get,
    post,
    put,
    del,
  };
})();