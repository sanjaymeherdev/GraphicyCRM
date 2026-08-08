// js/modules/sources.js
const Sources = {
  // Which platform key (from state.user.connections, see GET /api/profile)
  // each card's OAuth "Connect" button represents.
  _connections: [],

  isConnected(platform) {
    return this._connections.some((c) => c.platform === platform);
  },

  connectedAccountName(platform) {
    return this._connections.find((c) => c.platform === platform)?.account_name || '';
  },

  // Renders a card's action button as either "Connect with X" or a
  // disabled "✅ Connected" state (with the actual connected account name,
  // and a Disconnect button) underneath, when we have one).
  connectButton(platform, label, onclick) {
    if (this.isConnected(platform)) {
      const acct = this.connectedAccountName(platform);
      return `
        <button class="btn btn-connected" style="width:100%;justify-content:center;" disabled>✅ Connected</button>
        ${acct ? `<div class="conn-account-sub">${escapeHtml(acct)}</div>` : ''}
        <button class="btn btn-danger btn-sm" style="width:100%;justify-content:center;margin-top:8px;" onclick="Sources.disconnectOAuth('${platform}')">Disconnect</button>
      `;
    }
    return `<button class="btn btn-secondary" style="width:100%;justify-content:center;" onclick="${onclick}">${label}</button>`;
  },

  async disconnectOAuth(service) {
    const label = service === 'google' ? 'Google (this disconnects Gmail, Sheets, and Docs together)' : service;
    if (!confirm(`Disconnect ${label}?`)) return;
    try {
      await API.disconnectOAuth(service);
      showToast('Disconnected');
      if (window.refreshAllData) await window.refreshAllData();
      else this.render(window.state || {});
    } catch (err) {
      showToast('Failed to disconnect: ' + err.message, true);
    }
  },

  async disconnectWhatsApp() {
    if (!confirm('Disconnect WhatsApp?')) return;
    const ids = this._connections.filter((c) => c.platform === 'whatsapp').map((c) => c.disconnect_id).filter(Boolean);
    try {
      await Promise.all(ids.map((id) => API.disconnectWhatsAppAccount(id)));
      showToast('Disconnected');
      if (window.refreshAllData) await window.refreshAllData();
      else this.render(window.state || {});
    } catch (err) {
      showToast('Failed to disconnect: ' + err.message, true);
    }
  },

  render(state) {
    this._connections = state.user?.connections || [];
    const panel = document.getElementById('tab-sources');
    const waConnected = this.isConnected('whatsapp');
    panel.innerHTML = `
      <div class="page-header"><div><div class="page-title">Sources</div><div class="page-sub">Connect where leads come from</div></div></div>
      <div class="conn-methods">
        <div class="conn-card">
          <div class="m-head"><span class="badge-ic"><img src="/images/whatsapp.png" alt="WhatsApp" /></span><h3>WhatsApp</h3></div>
          ${waConnected ? `
            <p class="m-desc">Connected</p>
            <button class="btn btn-connected" style="width:100%;justify-content:center;" disabled>✅ Connected</button>
            <div class="conn-account-sub">${escapeHtml(this.connectedAccountName('whatsapp'))}</div>
            <button class="btn btn-danger btn-sm" style="width:100%;justify-content:center;margin-top:8px;" onclick="Sources.disconnectWhatsApp()">Disconnect</button>
          ` : `
            <p class="m-desc">Connect with System User Token and WABA ID</p>
            <div class="field"><label>WABA ID</label><input type="text" id="wabaId" placeholder="e.g. 123456789" /></div>
            <div class="field"><label>Access Token</label><input type="text" id="wabaToken" placeholder="Permanent access token" /></div>
            <button class="btn btn-primary" style="width:100%;justify-content:center;" onclick="Sources.connectWhatsApp()">Connect</button>
            <div id="wabaNumbers" style="margin-top:10px;"></div>
          `}
        </div>
        <div class="conn-card">
          <div class="m-head"><span class="badge-ic"><img src="/images/instagram.png" alt="Instagram" /></span><h3>Instagram</h3></div>
          <p class="m-desc">Connect via Meta OAuth</p>
          ${this.connectButton('instagram', 'Connect with Instagram', 'Sources.connectInstagram()')}
        </div>
        <div class="conn-card">
          <div class="m-head"><span class="badge-ic"><img src="/images/facebook.png" alt="Facebook" /></span><h3>Facebook</h3></div>
          <p class="m-desc">Connect via Meta OAuth</p>
          ${this.connectButton('facebook', 'Connect with Facebook', 'Sources.connectFacebook()')}
          ${this.isConnected('facebook') ? `
            <button class="btn btn-secondary btn-sm" style="width:100%;justify-content:center;margin-top:8px;" onclick="Sources.resubscribeFacebook()">🔄 Re-subscribe webhooks</button>
            <button class="btn btn-ghost btn-sm" style="width:100%;justify-content:center;margin-top:6px;" onclick="Sources.checkFacebookWebhookStatus()">🔍 Check status</button>
            <div class="conn-account-sub" id="fbWebhookStatus" style="margin-top:4px;">If comments/messages aren't arriving, re-subscribe is usually the fix — it re-tells Meta to send this Page's events here. Automatic on every new connect; use this for Pages connected before that existed.</div>
          ` : ''}
        </div>
        <div class="conn-card">
          <div class="m-head"><span class="badge-ic"><img src="/images/Threads.png" alt="Threads" /></span><h3>Threads</h3></div>
          <p class="m-desc">Connect via Meta OAuth</p>
          ${this.connectButton('threads', 'Connect with Threads', 'Sources.connectThreads()')}
        </div>
        <div class="conn-card">
          <div class="m-head"><span class="badge-ic">💼</span><h3>LinkedIn</h3></div>
          <p class="m-desc">Direct login, or via Facebook if reached through a linked Page</p>
          ${this.connectButton('linkedin', 'Connect with LinkedIn', 'Sources.connectLinkedIn()')}
        </div>
        <div class="conn-card">
          <div class="m-head"><span class="badge-ic"><img src="/images/gmail.png" alt="Gmail" /></span><h3>Gmail</h3></div>
          <p class="m-desc">Connect via Google OAuth</p>
          ${this.connectButton('google', 'Connect with Google', 'Sources.connectGoogle()')}
        </div>
        <div class="conn-card">
          <div class="m-head"><span class="badge-ic">📊</span><h3>Google Sheets</h3></div>
          <p class="m-desc">Connect via Google OAuth</p>
          ${this.connectButton('google', 'Connect with Google', 'Sources.connectGoogle()')}
        </div>
        <div class="conn-card">
          <div class="m-head"><span class="badge-ic">📥</span><h3>Capture Mail</h3></div>
          <p class="m-desc">New leads from incoming Gmail — via a small script you deploy in your own Google account (Gmail read access isn't part of this app's Google connection; see setup steps)</p>
          <button class="btn btn-secondary" style="width:100%;justify-content:center;" onclick="Sources.toggleMailCapturePanel()">Set up Capture Mail</button>
        </div>
        <div class="conn-card">
          <div class="m-head"><span class="badge-ic">📄</span><h3>Google Docs</h3></div>
          <p class="m-desc">Same Google connection as Gmail/Sheets above — connecting or disconnecting any one of these three connects/disconnects all of them together. Used as an info source for the AI bot (Automation → Advanced grounding → Knowledge doc).</p>
          ${this.connectButton('google', 'Connect with Google', 'Sources.connectGoogle()')}
        </div>
        <div class="conn-card">
          <div class="m-head"><span class="badge-ic">🔗</span><h3>Sheet → Leads mapping</h3></div>
          <p class="m-desc">Map spreadsheet columns to lead fields — new rows (or date reminders) auto-create leads and can send a WhatsApp template</p>
          <button class="btn btn-secondary" style="width:100%;justify-content:center;" onclick="Sources.toggleWatcherPanel()">Manage watchers</button>
        </div>
        <div class="conn-card">
          <div class="m-head"><span class="badge-ic">📝</span><h3>Webhook / Web Form</h3></div>
          <p class="m-desc">Point any form builder at this URL</p>
          <div class="webhook-url-box" id="webhookUrlBox">Connect to generate URL</div>
          <button class="btn btn-secondary" style="margin-top:10px;width:100%;justify-content:center;" onclick="Sources.generateWebhook()">Generate Webhook URL</button>
        </div>
        <div class="conn-card">
          <div class="m-head"><span class="badge-ic">📅</span><h3>Calendar / smbooking</h3></div>
          <p class="m-desc">Sync scheduled meetings</p>
          <button class="btn btn-secondary" style="width:100%;justify-content:center;" onclick="Sources.connectCalendar()">Connect</button>
        </div>
      </div>
      <div id="sheetWatcherPanel" style="display:none;margin-top:20px;"></div>
      <div id="mailCapturePanel" style="display:none;margin-top:20px;"></div>
    `;
  },

  async connectWhatsApp() {
    const wabaId = document.getElementById('wabaId').value.trim();
    const token = document.getElementById('wabaToken').value.trim();
    if (!wabaId || !token) { showToast('Please enter WABA ID and token', true); return; }
    try {
      const data = await API.verifyWhatsApp(wabaId, token);
      if (data.numbers && data.numbers.length) {
        const container = document.getElementById('wabaNumbers');
        container.innerHTML = data.numbers.map((n, i) => `
          <div class="num-pick" onclick="Sources.selectNumber(${i})" data-i="${i}">
            <div><div class="n-name">${escapeHtml(n.display_name || n.phone_number)}</div>
            <div class="n-phone">${escapeHtml(n.phone_number)}</div></div>
            <span class="badge badge-green">${escapeHtml(n.quality_rating || '—')}</span>
          </div>
        `).join('');
        window._wabaNumbers = data.numbers;
        showToast('✅ Numbers loaded, click one to connect');
      } else {
        showToast('No numbers found under this WABA', true);
      }
    } catch (err) {
      showToast('Failed: ' + err.message, true);
    }
  },

  async selectNumber(idx) {
    const nums = window._wabaNumbers || [];
    if (!nums[idx]) return;
    document.querySelectorAll('.num-pick').forEach(el => el.classList.remove('sel'));
    document.querySelector(`.num-pick[data-i="${idx}"]`)?.classList.add('sel');
    const picked = nums[idx];
    const wabaId = document.getElementById('wabaId').value.trim();
    const token = document.getElementById('wabaToken').value.trim();
    try {
      await API.connectWhatsApp(wabaId, picked.phone_number_id, token);
      showToast(`✅ Connected ${picked.phone_number}`);
      if (window.refreshAllData) await window.refreshAllData();
      else this.render(window.state || {});
    } catch (err) {
      showToast('Failed to connect: ' + err.message, true);
    }
  },

  async connectInstagram() {
    try {
      const data = await API.getOAuthUrl('instagram');
      window.location.href = data.url;
    } catch (err) {
      showToast('Failed: ' + err.message, true);
    }
  },

  async connectFacebook() {
    try {
      const data = await API.getOAuthUrl('facebook');
      window.location.href = data.url;
    } catch (err) {
      showToast('Failed: ' + err.message, true);
    }
  },

  async resubscribeFacebook() {
    try {
      await API.resubscribeFacebookWebhooks();
      showToast('✅ Re-subscribed — Meta should deliver new events now');
    } catch (err) {
      showToast('Failed: ' + err.message, true);
    }
  },

  async checkFacebookWebhookStatus() {
    const el = document.getElementById('fbWebhookStatus');
    try {
      const res = await API.getFacebookWebhookStatus();
      const have = res.subscribedFields?.length ? res.subscribedFields.join(', ') : '(none)';
      const missing = res.missingFields?.length ? res.missingFields.join(', ') : null;
      if (el) {
        el.innerHTML = `Subscribed: <b>${escapeHtml(have)}</b>` +
          (missing ? `<br/><span style="color:var(--red);">Missing: ${escapeHtml(missing)} — click Re-subscribe</span>` : `<br/><span style="color:var(--green);">All expected fields subscribed ✅</span>`);
      }
    } catch (err) {
      if (el) el.innerHTML = `<span style="color:var(--red);">Failed to check: ${escapeHtml(err.message)}</span>`;
      else showToast('Failed: ' + err.message, true);
    }
  },

  async connectThreads() {
    try {
      const data = await API.getOAuthUrl('threads');
      window.location.href = data.url;
    } catch (err) {
      showToast('Failed: ' + err.message, true);
    }
  },

  async connectLinkedIn() {
    try {
      const data = await API.getOAuthUrl('linkedin');
      window.location.href = data.url;
    } catch (err) {
      showToast('Failed: ' + err.message, true);
    }
  },

  async connectGoogle() {
    try {
      const data = await API.getOAuthUrl('google');
      window.location.href = data.url;
    } catch (err) {
      showToast('Failed: ' + err.message, true);
    }
  },

  async generateWebhook() {
    try {
      const data = await API.generateWebhook();
      document.getElementById('webhookUrlBox').textContent = data.url;
      showToast('✅ Webhook URL generated');
    } catch (err) {
      showToast('Failed: ' + err.message, true);
    }
  },

  async connectCalendar() {
    try {
      await API.connectIntegration('calendar');
      showToast('✅ Connected to calendar');
    } catch (err) {
      showToast('Failed: ' + err.message, true);
    }
  },

  // ─── SHEET → LEADS WATCHERS ───
  _watchers: [],
  _watcherDraft: null, // draft object while creating/editing; null = list view

  // Dropdown-picker caches — tabs/headers fetched from Google (Sheets API,
  // approved `spreadsheets` scope) once the user pastes in a spreadsheet ID
  // directly. There's no more "pick your spreadsheet from a list" dropdown
  // — that needed the `drive` scope, which isn't approved for this OAuth
  // client (see shared/googleAuth.js's GOOGLE_SCOPES).
  _tabsCache: {},   // spreadsheetId -> string[]
  _loadingTabs: {}, // spreadsheetId -> bool
  _headersCache: {},   // "spreadsheetId::worksheet" -> string[]
  _loadingHeaders: {}, // "spreadsheetId::worksheet" -> bool

  headersKey(spreadsheetId, worksheet) { return `${spreadsheetId}::${worksheet}`; },

  async loadTabsFor(spreadsheetId) {
    if (!spreadsheetId || this._tabsCache[spreadsheetId] || this._loadingTabs[spreadsheetId]) return;
    this._loadingTabs[spreadsheetId] = true;
    try {
      const data = await API.listSheetTabs(spreadsheetId);
      this._tabsCache[spreadsheetId] = data.tabs || [];
    } catch (err) {
      showToast('Failed to load sheet tabs: ' + err.message, true);
      this._tabsCache[spreadsheetId] = [];
    } finally {
      this._loadingTabs[spreadsheetId] = false;
    }
  },

  async loadHeadersFor(spreadsheetId, worksheet) {
    const key = this.headersKey(spreadsheetId, worksheet);
    if (!spreadsheetId || !worksheet || this._headersCache[key] || this._loadingHeaders[key]) return;
    this._loadingHeaders[key] = true;
    try {
      const data = await API.listSheetHeaders(spreadsheetId, worksheet);
      this._headersCache[key] = data.headers || [];
    } catch (err) {
      showToast('Failed to load columns: ' + err.message, true);
      this._headersCache[key] = [];
    } finally {
      this._loadingHeaders[key] = false;
    }
  },

  // Spreadsheet dropdown changed — reset everything downstream (tab +
  // column choices no longer apply to the new spreadsheet), then fetch its
  // tabs and re-render once they're in.
  async onSpreadsheetChange(spreadsheetId) {
    const d = this._watcherDraft;
    if (!d) return;
    d.spreadsheet_id = spreadsheetId;
    d.worksheet = '';
    d.name_column = ''; d.phone_column = ''; d.email_column = ''; d.date_column = '';
    this.renderWatcherForm();
    await this.loadTabsFor(spreadsheetId);
    this.renderWatcherForm();
  },

  // Worksheet dropdown changed — reset column choices, fetch the new
  // worksheet's header row, then re-render with column dropdowns populated.
  async onWorksheetChange(worksheet) {
    const d = this._watcherDraft;
    if (!d) return;
    d.worksheet = worksheet;
    d.name_column = ''; d.phone_column = ''; d.email_column = ''; d.date_column = '';
    this.renderWatcherForm();
    await this.loadHeadersFor(d.spreadsheet_id, worksheet);
    this.renderWatcherForm();
  },

  async toggleWatcherPanel() {
    const panel = document.getElementById('sheetWatcherPanel');
    const opening = panel.style.display === 'none';
    panel.style.display = opening ? 'block' : 'none';
    if (opening) await this.loadWatchers();
  },

  async loadWatchers() {
    const panel = document.getElementById('sheetWatcherPanel');
    panel.innerHTML = `<div class="empty-state"><p>Loading watchers…</p></div>`;
    try {
      const data = await API.getSheetWatchers();
      this._watchers = data.watchers || [];
    } catch (err) {
      this._watchers = [];
      showToast('Failed to load watchers: ' + err.message, true);
    }
    this.renderWatcherPanel();
  },

  renderWatcherPanel() {
    const panel = document.getElementById('sheetWatcherPanel');
    if (this._watcherDraft) { this.renderWatcherForm(); return; }

    const rows = this._watchers.map(w => {
      return `
      <div class="rule-card" style="cursor:default;">
        <div class="meta" style="justify-content:space-between;">
          <span><strong>${escapeHtml(w.worksheet)}</strong> in <code>${escapeHtml(w.spreadsheet_id.slice(0, 18))}…</code></span>
          <span class="badge ${w.active ? 'badge-green' : ''}">${w.active ? 'Active' : 'Paused'}</span>
        </div>
        <div class="block-sub" style="margin:4px 0;">
          ${w.watch_type === 'new_row' ? '🆕 New row' : `📅 Date reminder (${escapeHtml(w.date_column || '—')}, offset ${w.offset_days || 0}d)`}
          · every ${w.poll_interval_minutes}min · sends via ${escapeHtml(w.channel || 'whatsapp')}
          ${w.last_error ? `<br><span style="color:#e5484d;">⚠ ${escapeHtml(w.last_error)}</span>` : ''}
        </div>
        <div style="display:flex;gap:8px;margin-top:6px;">
          <button class="btn btn-secondary btn-sm" onclick="Sources.editWatcher('${w.id}')">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="Sources.deleteWatcher('${w.id}')">Delete</button>
        </div>
      </div>
    `;
    }).join('');

    panel.innerHTML = `
      <div class="page-header">
        <div><div class="page-title" style="font-size:16px;">Sheet → Leads watchers</div><div class="page-sub">Requires Google connected above</div></div>
        <button class="btn btn-primary btn-sm" onclick="Sources.newWatcher()">+ New watcher</button>
      </div>
      ${this._watchers.length ? `<div class="rule-list" style="grid-template-columns:1fr;">${rows}</div>` : `<div class="empty-state"><div class="empty-icon">📄</div><p>No watchers yet.</p></div>`}
    `;
  },

  newWatcher() {
    this._watcherDraft = {
      spreadsheet_id: '', worksheet: '', watch_type: 'new_row', poll_interval_minutes: 15,
      date_column: '', offset_days: 0, name_column: '', phone_column: '', email_column: '',
      channel: 'whatsapp', template_id: null, message_template: '', placeholder_mapping: {}, active: true,
    };
    this.renderWatcherForm();
  },

  async editWatcher(id) {
    const w = this._watchers.find(x => x.id === id);
    if (!w) return;
    this._watcherDraft = { ...w, placeholder_mapping: { ...(w.placeholder_mapping || {}) } };
    this.renderWatcherForm();
    if (this._watcherDraft.spreadsheet_id) await this.loadTabsFor(this._watcherDraft.spreadsheet_id);
    if (this._watcherDraft.spreadsheet_id && this._watcherDraft.worksheet) {
      await this.loadHeadersFor(this._watcherDraft.spreadsheet_id, this._watcherDraft.worksheet);
    }
    this.renderWatcherForm();
  },

  cancelWatcherForm() {
    this._watcherDraft = null;
    this.renderWatcherPanel();
  },

  updateWatcherDraft(field, value) {
    if (this._watcherDraft) this._watcherDraft[field] = value;
  },

  addPlaceholderRow() {
    const d = this._watcherDraft;
    if (!d) return;
    const nextKey = String(Object.keys(d.placeholder_mapping || {}).length + 1);
    d.placeholder_mapping = { ...(d.placeholder_mapping || {}), [nextKey]: { type: 'field', field: '' } };
    this.renderWatcherForm();
  },

  removePlaceholderRow(key) {
    const d = this._watcherDraft;
    if (!d?.placeholder_mapping) return;
    delete d.placeholder_mapping[key];
    this.renderWatcherForm();
  },

  updatePlaceholderRow(key, field, value) {
    const d = this._watcherDraft;
    if (!d?.placeholder_mapping?.[key]) return;
    if (field === 'type') d.placeholder_mapping[key] = { type: value, field: '', value: '' };
    else d.placeholder_mapping[key][field] = value;
  },

  renderWatcherForm() {
    const panel = document.getElementById('sheetWatcherPanel');
    const d = this._watcherDraft;
    const templates = (window.state?.templates || []).filter(t => t.type === 'whatsapp_template');
    const tplOptions = templates.map(t => `<option value="${t.id}" ${t.id === d.template_id ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('');

    const tabs = this._tabsCache[d.spreadsheet_id] || [];
    const tabsLoading = !!this._loadingTabs[d.spreadsheet_id];
    const headers = this._headersCache[this.headersKey(d.spreadsheet_id, d.worksheet)] || [];
    const headersLoading = !!this._loadingHeaders[this.headersKey(d.spreadsheet_id, d.worksheet)];

    // Reusable "pick a column" dropdown — falls back to the raw stored
    // value as an extra option if it's no longer in the fetched header list
    // (e.g. the sheet's columns changed since this watcher was set up), so
    // editing an old watcher never silently blanks out its mapping.
    const columnSelect = (field, currentValue, extraOption) => `
      <select onchange="Sources.updateWatcherDraft('${field}', this.value)" ${!headers.length && !headersLoading ? 'disabled' : ''}>
        <option value="">${headersLoading ? 'Loading columns…' : (headers.length ? (extraOption || '— none —') : 'Pick a spreadsheet + worksheet first')}</option>
        ${headers.map((h) => `<option value="${escapeHtml(h)}" ${h === currentValue ? 'selected' : ''}>${escapeHtml(h)}</option>`).join('')}
        ${currentValue && !headers.includes(currentValue) ? `<option value="${escapeHtml(currentValue)}" selected>${escapeHtml(currentValue)} (not found in sheet)</option>` : ''}
      </select>
    `;

    const placeholderRows = Object.entries(d.placeholder_mapping || {}).map(([key, map]) => `
      <div class="cond-row">
        <input type="text" value="${escapeHtml(key)}" disabled style="max-width:50px;" title="{{${escapeHtml(key)}}} in the template" />
        <select onchange="Sources.updatePlaceholderRow('${key}','type', this.value)">
          <option value="name" ${map.type === 'name' ? 'selected' : ''}>Name column</option>
          <option value="phone" ${map.type === 'phone' ? 'selected' : ''}>Phone column</option>
          <option value="email" ${map.type === 'email' ? 'selected' : ''}>Email column</option>
          <option value="field" ${map.type === 'field' ? 'selected' : ''}>Other column</option>
          <option value="custom" ${map.type === 'custom' ? 'selected' : ''}>Fixed text</option>
        </select>
        ${map.type === 'field' ? `
          <select onchange="Sources.updatePlaceholderRow('${key}','field', this.value)">
            <option value="">${headers.length ? '— pick a column —' : 'Pick a spreadsheet + worksheet first'}</option>
            ${headers.map((h) => `<option value="${escapeHtml(h)}" ${h === map.field ? 'selected' : ''}>${escapeHtml(h)}</option>`).join('')}
          </select>
        ` : ''}
        ${map.type === 'custom' ? `<input type="text" placeholder="literal value" value="${escapeHtml(map.value || '')}" onchange="Sources.updatePlaceholderRow('${key}','value', this.value)" />` : ''}
        <button class="rm" onclick="Sources.removePlaceholderRow('${key}')">&times;</button>
      </div>
    `).join('');

    panel.innerHTML = `
      <div class="page-header"><div class="page-title" style="font-size:16px;">${d.id ? 'Edit' : 'New'} watcher</div></div>
      <div class="chain">
        <div class="block block-trigger">
          <div class="block-head"><div class="block-title"><span class="badge-ic">📊</span>Sheet</div></div>
          <div class="field-row">
            <div class="field">
              <label>Spreadsheet ID</label>
              <input type="text" placeholder="Paste the spreadsheet ID (from its Google Sheets URL)" value="${escapeHtml(d.spreadsheet_id)}"
                onchange="Sources.onSpreadsheetChange(this.value.trim())" />
              <div class="block-sub">Open the sheet in Google Sheets and copy the ID out of its URL: docs.google.com/spreadsheets/d/<code>THIS_PART</code>/edit</div>
            </div>
            <div class="field">
              <label>Worksheet (tab)</label>
              <select onchange="Sources.onWorksheetChange(this.value)" ${!d.spreadsheet_id ? 'disabled' : ''}>
                <option value="">${!d.spreadsheet_id ? 'Pick a spreadsheet first' : (tabsLoading ? 'Loading tabs…' : '— Select a tab —')}</option>
                ${tabs.map((t) => `<option value="${escapeHtml(t)}" ${t === d.worksheet ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label>Watch for</label>
              <select onchange="Sources.updateWatcherDraft('watch_type', this.value)">
                <option value="new_row" ${d.watch_type === 'new_row' ? 'selected' : ''}>New rows appended</option>
                <option value="date_reminder" ${d.watch_type === 'date_reminder' ? 'selected' : ''}>Yearly date reminder (birthday, renewal…)</option>
              </select>
            </div>
            <div class="field"><label>Poll every (minutes)</label><input type="number" min="1" value="${d.poll_interval_minutes}" onchange="Sources.updateWatcherDraft('poll_interval_minutes', parseInt(this.value)||15)" /></div>
          </div>
          ${d.watch_type === 'date_reminder' ? `
            <div class="field-row">
              <div class="field"><label>Date column</label>${columnSelect('date_column', d.date_column || '')}</div>
              <div class="field"><label>Remind (days before)</label><input type="number" min="0" value="${d.offset_days || 0}" onchange="Sources.updateWatcherDraft('offset_days', parseInt(this.value)||0)" /></div>
            </div>
          ` : ''}
        </div>

        <div class="block block-action">
          <div class="block-head"><div class="block-title"><span class="badge-ic">👤</span>Lead field mapping</div><span class="block-sub">which columns identify who a row is about</span></div>
          <div class="field-row">
            <div class="field"><label>Name column</label>${columnSelect('name_column', d.name_column || '')}</div>
            <div class="field"><label>Phone column</label>${columnSelect('phone_column', d.phone_column || '')}</div>
            <div class="field"><label>Email column</label>${columnSelect('email_column', d.email_column || '')}</div>
          </div>
          <div class="block-sub">At least a phone or an email column is required — that's what a matched row turns into a lead on.</div>
        </div>

        <div class="block block-ai">
          <div class="block-head"><div class="block-title"><span class="badge-ic">📤</span>Send on match</div><span class="block-sub">optional — a lead is always created either way</span></div>
          <div class="field">
            <label>Channel</label>
            <select onchange="Sources.updateWatcherDraft('channel', this.value)">
              <option value="whatsapp" ${(d.channel || 'whatsapp') === 'whatsapp' ? 'selected' : ''}>WhatsApp</option>
            </select>
            <div class="block-sub">Only WhatsApp sending is wired up right now (needs an approved template for first contact — Meta blocks free-form business-initiated messages).</div>
          </div>
          <div class="field">
            <label>Template <span class="block-sub">(recommended — required for first contact)</span></label>
            <select onchange="Sources.updateWatcherDraft('template_id', this.value || null)">
              <option value="">No template — use plain text below</option>
              ${tplOptions}
            </select>
          </div>
          ${d.template_id ? `
            <div class="field">
              <label>Template placeholders</label>
              <div id="ph-rows">${placeholderRows}</div>
              <button class="add-row" onclick="Sources.addPlaceholderRow()">+ Add placeholder</button>
            </div>
          ` : `
            <div class="field">
              <label>Plain text (only sends if the contact already messaged in recently)</label>
              <textarea placeholder="Hi {name}, ..." onchange="Sources.updateWatcherDraft('message_template', this.value)">${escapeHtml(d.message_template || '')}</textarea>
            </div>
          `}
        </div>
      </div>
      <div style="display:flex;gap:10px;margin-top:6px;padding-left:28px;">
        <button class="btn btn-primary btn-sm" onclick="Sources.saveWatcher()">💾 Save watcher</button>
        <button class="btn btn-secondary btn-sm" onclick="Sources.cancelWatcherForm()">Cancel</button>
      </div>
    `;
  },

  async saveWatcher() {
    const d = this._watcherDraft;
    if (!d) return;
    if (!d.spreadsheet_id || !d.worksheet) { showToast('Spreadsheet ID and worksheet are required', true); return; }
    if (!d.phone_column && !d.email_column) { showToast('Map at least a phone or email column', true); return; }
    try {
      if (d.id) await API.updateSheetWatcher(d.id, d);
      else await API.createSheetWatcher(d);
      showToast('✅ Watcher saved');
      this._watcherDraft = null;
      await this.loadWatchers();
    } catch (err) {
      showToast('Failed: ' + err.message, true);
    }
  },

  async deleteWatcher(id) {
    if (!confirm('Delete this watcher?')) return;
    try {
      await API.deleteSheetWatcher(id);
      await this.loadWatchers();
    } catch (err) {
      showToast('Failed: ' + err.message, true);
    }
  },

  // ─── CAPTURE MAIL ───
  // Works around Gmail read access not being part of this app's approved
  // Google OAuth scopes (see shared/googleAuth.js's GOOGLE_SCOPES —
  // gmail.readonly isn't approved) by having the user deploy a small script
  // under their OWN Google account instead (Google Apps Script), which gets
  // its own separate per-user consent. Our server just polls the URL they
  // deploy. See modules/mail-capture for the backend half of this.
  _mailConfig: null,       // null = not connected yet
  _mailScriptData: null,   // { secret, script } — fetched once, reused across re-renders until saved
  _mailDraft: null,        // form state while setting up / editing

  async toggleMailCapturePanel() {
    const panel = document.getElementById('mailCapturePanel');
    const opening = panel.style.display === 'none';
    panel.style.display = opening ? 'block' : 'none';
    if (opening) await this.loadMailCapture();
  },

  async loadMailCapture() {
    const panel = document.getElementById('mailCapturePanel');
    panel.innerHTML = `<div class="empty-state"><p>Loading…</p></div>`;
    try {
      this._mailConfig = await API.getMailCaptureConfig();
    } catch (err) {
      this._mailConfig = null;
      showToast('Failed to load Capture Mail status: ' + err.message, true);
    }
    if (!this._mailConfig && !this._mailScriptData) {
      try {
        this._mailScriptData = await API.getMailCaptureScript();
      } catch (err) {
        showToast('Failed to generate setup script: ' + err.message, true);
      }
    }
    if (!this._mailDraft) {
      this._mailDraft = this._mailConfig
        ? { scriptUrl: this._mailConfig.script_url, fromFilter: this._mailConfig.from_filter || '', keywordFilter: this._mailConfig.keyword_filter || '', pollIntervalMinutes: this._mailConfig.poll_interval_minutes || 5, active: this._mailConfig.active !== false }
        : { scriptUrl: '', fromFilter: '', keywordFilter: '', pollIntervalMinutes: 5, active: true };
    }
    this.renderMailCapturePanel();
  },

  updateMailDraft(field, value) {
    if (this._mailDraft) this._mailDraft[field] = value;
  },

  async copyMailScript() {
    if (!this._mailScriptData) return;
    try {
      await navigator.clipboard.writeText(this._mailScriptData.script);
      showToast('Script copied');
    } catch {
      showToast('Copy failed — select the code and copy manually', true);
    }
  },

  renderMailCapturePanel() {
    const panel = document.getElementById('mailCapturePanel');
    const d = this._mailDraft;
    const connected = !!this._mailConfig;

    const setupSteps = this._mailScriptData ? `
      <div class="block-sub" style="margin-bottom:10px;">
        This runs a script under <strong>your own Google account</strong> (not this app's Google connection) so the CRM can read matching emails without needing broader Gmail access approved on our end.
      </div>
      <ol style="margin:0 0 14px 18px;padding:0;line-height:1.7;">
        <li>Open <a href="https://script.google.com/" target="_blank" rel="noopener">script.google.com</a> → <strong>New project</strong>.</li>
        <li>Delete the placeholder code and paste in the script below.</li>
        <li><strong>Deploy → New deployment</strong> → click the gear icon next to "Select type" → choose <strong>Web app</strong>.</li>
        <li>Execute as: <strong>Me</strong>. Who has access: <strong>Anyone</strong>. Click <strong>Deploy</strong>.</li>
        <li>Google will ask you to authorize it — this is normal for your own script. Choose your account → <strong>Advanced</strong> → <strong>Go to (unsafe)</strong> → <strong>Allow</strong>.</li>
        <li>Copy the <strong>Web app URL</strong> it gives you and paste it below.</li>
      </ol>
      <div class="field">
        <label>Apps Script code — paste this into script.google.com</label>
        <textarea readonly rows="10" style="font-family:monospace;font-size:12px;" onclick="this.select()">${escapeHtml(this._mailScriptData.script)}</textarea>
        <button class="btn btn-secondary btn-sm" style="margin-top:6px;" onclick="Sources.copyMailScript()">📋 Copy code</button>
      </div>
    ` : `<div class="block-sub">Failed to generate the setup script — try reopening this panel.</div>`;

    panel.innerHTML = `
      <div class="page-header">
        <div><div class="page-title" style="font-size:16px;">Capture Mail</div><div class="page-sub">${connected ? 'Connected — new matching emails become leads' : 'Not connected yet'}</div></div>
      </div>
      <div class="chain">
        <div class="block block-trigger">
          ${connected ? '' : setupSteps}
          <div class="field">
            <label>Web app URL${connected ? '' : ' (from step 6 above)'}</label>
            <input type="text" placeholder="https://script.google.com/macros/s/…/exec" value="${escapeHtml(d.scriptUrl)}"
              onchange="Sources.updateMailDraft('scriptUrl', this.value.trim())" />
          </div>
          <div class="field-row">
            <div class="field">
              <label>Only from (optional)</label>
              <input type="text" placeholder="e.g. orders@shopify.com" value="${escapeHtml(d.fromFilter)}"
                onchange="Sources.updateMailDraft('fromFilter', this.value.trim())" />
            </div>
            <div class="field">
              <label>Only containing keyword (optional)</label>
              <input type="text" placeholder="e.g. new order" value="${escapeHtml(d.keywordFilter)}"
                onchange="Sources.updateMailDraft('keywordFilter', this.value.trim())" />
            </div>
          </div>
          <div class="block-sub" style="margin:2px 0 10px;">Leave both blank to capture every incoming email. Set both to require a match on each.</div>
          <div class="field">
            <label>Check every</label>
            <select onchange="Sources.updateMailDraft('pollIntervalMinutes', Number(this.value))">
              ${[5, 10, 15, 30, 60].map((m) => `<option value="${m}" ${d.pollIntervalMinutes === m ? 'selected' : ''}>${m} minutes</option>`).join('')}
            </select>
          </div>
          ${connected ? `
            <div class="field">
              <label style="display:flex;align-items:center;gap:8px;">
                <span class="switch ${d.active ? 'on' : ''}" onclick="Sources.updateMailDraft('active', ${!d.active}); Sources.renderMailCapturePanel();"></span>
                Active
              </label>
            </div>
          ` : ''}
          <div style="display:flex;gap:8px;margin-top:10px;">
            <button class="btn btn-primary" onclick="Sources.saveMailCapture()">${connected ? 'Save changes' : 'Connect'}</button>
            ${connected ? `
              <button class="btn btn-secondary" onclick="Sources.testMailCapture()">Check now</button>
              <button class="btn btn-danger" onclick="Sources.disconnectMailCapture()">Disconnect</button>
            ` : ''}
          </div>
          ${connected && this._mailConfig.last_error ? `<div class="block-sub" style="color:#e5484d;margin-top:8px;">⚠ Last check failed: ${escapeHtml(this._mailConfig.last_error)}</div>` : ''}
          ${connected && this._mailConfig.last_polled_at ? `<div class="block-sub" style="margin-top:4px;">Last checked: ${new Date(this._mailConfig.last_polled_at).toLocaleString()}</div>` : ''}
        </div>
      </div>
    `;
  },

  async saveMailCapture() {
    const d = this._mailDraft;
    if (!d.scriptUrl) return showToast('Paste the deployed Web app URL first', true);
    if (!this._mailConfig && !this._mailScriptData) return showToast('Setup script not loaded — reopen this panel and try again', true);
    try {
      this._mailConfig = await API.saveMailCaptureConfig({
        scriptUrl: d.scriptUrl,
        secret: this._mailConfig ? undefined : this._mailScriptData.secret, // only sent on first connect — see modules/mail-capture/service.js's saveConfig
        fromFilter: d.fromFilter, keywordFilter: d.keywordFilter,
        pollIntervalMinutes: d.pollIntervalMinutes, active: d.active,
      });
      showToast('Capture Mail connected');
      this.renderMailCapturePanel();
    } catch (err) {
      showToast('Failed to save: ' + err.message, true);
    }
  },

  async testMailCapture() {
    try {
      await API.testMailCaptureNow();
      showToast('Checked — any matching new emails were added as leads');
      this._mailConfig = await API.getMailCaptureConfig();
      this.renderMailCapturePanel();
    } catch (err) {
      showToast('Check failed: ' + err.message, true);
    }
  },

  async disconnectMailCapture() {
    if (!confirm('Disconnect Capture Mail? You can reconnect later, but you\'ll need to paste the Web app URL again.')) return;
    try {
      await API.deleteMailCaptureConfig();
      this._mailConfig = null;
      this._mailScriptData = null;
      this._mailDraft = null;
      showToast('Disconnected');
      await this.loadMailCapture();
    } catch (err) {
      showToast('Failed to disconnect: ' + err.message, true);
    }
  },
};
// Expose module globally (const declarations do not auto-attach to window)
window.Sources = Sources;