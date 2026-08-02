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
  // disabled "✅ Connected" state (with the actual connected account name
  // underneath, when we have one).
  connectButton(platform, label, onclick) {
    if (this.isConnected(platform)) {
      const acct = this.connectedAccountName(platform);
      return `
        <button class="btn btn-connected" style="width:100%;justify-content:center;" disabled>✅ Connected</button>
        ${acct ? `<div class="conn-account-sub">${escapeHtml(acct)}</div>` : ''}
      `;
    }
    return `<button class="btn btn-secondary" style="width:100%;justify-content:center;" onclick="${onclick}">${label}</button>`;
  },

  render(state) {
    this._connections = state.user?.connections || [];
    const panel = document.getElementById('tab-sources');
    const waConnected = this.isConnected('whatsapp');
    panel.innerHTML = `
      <div class="page-header"><div><div class="page-title">Sources</div><div class="page-sub">Connect where leads come from</div></div></div>
      <div class="conn-methods">
        <div class="conn-card">
          <div class="m-head"><span class="badge-ic">📱</span><h3>WhatsApp</h3></div>
          ${waConnected ? `
            <p class="m-desc">Connected</p>
            <button class="btn btn-connected" style="width:100%;justify-content:center;" disabled>✅ Connected</button>
            <div class="conn-account-sub">${escapeHtml(this.connectedAccountName('whatsapp'))}</div>
          ` : `
            <p class="m-desc">Connect with System User Token and WABA ID</p>
            <div class="field"><label>WABA ID</label><input type="text" id="wabaId" placeholder="e.g. 123456789" /></div>
            <div class="field"><label>Access Token</label><input type="text" id="wabaToken" placeholder="Permanent access token" /></div>
            <button class="btn btn-primary" style="width:100%;justify-content:center;" onclick="Sources.connectWhatsApp()">Connect</button>
            <div id="wabaNumbers" style="margin-top:10px;"></div>
          `}
        </div>
        <div class="conn-card">
          <div class="m-head"><span class="badge-ic">📷</span><h3>Instagram</h3></div>
          <p class="m-desc">Connect via Meta OAuth</p>
          ${this.connectButton('instagram', 'Connect with Instagram', 'Sources.connectInstagram()')}
        </div>
        <div class="conn-card">
          <div class="m-head"><span class="badge-ic">👥</span><h3>Facebook</h3></div>
          <p class="m-desc">Connect via Meta OAuth</p>
          ${this.connectButton('facebook', 'Connect with Facebook', 'Sources.connectFacebook()')}
        </div>
        <div class="conn-card">
          <div class="m-head"><span class="badge-ic">🧵</span><h3>Threads</h3></div>
          <p class="m-desc">Connect via Meta OAuth</p>
          ${this.connectButton('threads', 'Connect with Threads', 'Sources.connectThreads()')}
        </div>
        <div class="conn-card">
          <div class="m-head"><span class="badge-ic">💼</span><h3>LinkedIn</h3></div>
          <p class="m-desc">Direct login, or via Facebook if reached through a linked Page</p>
          ${this.connectButton('linkedin', 'Connect with LinkedIn', 'Sources.connectLinkedIn()')}
        </div>
        <div class="conn-card">
          <div class="m-head"><span class="badge-ic">📧</span><h3>Gmail</h3></div>
          <p class="m-desc">Connect via Google OAuth</p>
          ${this.connectButton('google', 'Connect with Google', 'Sources.connectGoogle()')}
        </div>
        <div class="conn-card">
          <div class="m-head"><span class="badge-ic">📊</span><h3>Google Sheets</h3></div>
          <p class="m-desc">Connect via Google OAuth</p>
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

    const rows = this._watchers.map(w => `
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
    `).join('');

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

  editWatcher(id) {
    const w = this._watchers.find(x => x.id === id);
    if (!w) return;
    this._watcherDraft = { ...w, placeholder_mapping: { ...(w.placeholder_mapping || {}) } };
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
        ${map.type === 'field' ? `<input type="text" placeholder="column header" value="${escapeHtml(map.field || '')}" onchange="Sources.updatePlaceholderRow('${key}','field', this.value)" />` : ''}
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
            <div class="field"><label>Spreadsheet ID</label><input type="text" placeholder="from the sheet's URL" value="${escapeHtml(d.spreadsheet_id)}" onchange="Sources.updateWatcherDraft('spreadsheet_id', this.value)" /></div>
            <div class="field"><label>Worksheet (tab name)</label><input type="text" placeholder="Sheet1" value="${escapeHtml(d.worksheet)}" onchange="Sources.updateWatcherDraft('worksheet', this.value)" /></div>
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
              <div class="field"><label>Date column</label><input type="text" placeholder="e.g. Birthday" value="${escapeHtml(d.date_column || '')}" onchange="Sources.updateWatcherDraft('date_column', this.value)" /></div>
              <div class="field"><label>Remind (days before)</label><input type="number" min="0" value="${d.offset_days || 0}" onchange="Sources.updateWatcherDraft('offset_days', parseInt(this.value)||0)" /></div>
            </div>
          ` : ''}
        </div>

        <div class="block block-action">
          <div class="block-head"><div class="block-title"><span class="badge-ic">👤</span>Lead field mapping</div><span class="block-sub">which columns identify who a row is about</span></div>
          <div class="field-row">
            <div class="field"><label>Name column</label><input type="text" placeholder="e.g. Full Name" value="${escapeHtml(d.name_column || '')}" onchange="Sources.updateWatcherDraft('name_column', this.value)" /></div>
            <div class="field"><label>Phone column</label><input type="text" placeholder="e.g. Phone" value="${escapeHtml(d.phone_column || '')}" onchange="Sources.updateWatcherDraft('phone_column', this.value)" /></div>
            <div class="field"><label>Email column</label><input type="text" placeholder="e.g. Email" value="${escapeHtml(d.email_column || '')}" onchange="Sources.updateWatcherDraft('email_column', this.value)" /></div>
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
};
// Expose module globally (const declarations do not auto-attach to window)
window.Sources = Sources;
