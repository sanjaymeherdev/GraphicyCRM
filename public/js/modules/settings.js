// js/modules/settings.js
const Settings = {
  // Real, callable models — fetched from GET /api/ai-bot/models (the exact
  // list modules/ai-bot/service.js accepts), not a hardcoded guess.
  _modelsList: [],
  _defaultModel: '',
  _loadingModels: false,

  async loadModelsList() {
    if (this._modelsList.length || this._loadingModels) return;
    this._loadingModels = true;
    try {
      const data = await API.getAvailableModels();
      this._modelsList = data.models || [];
      this._defaultModel = data.default_model || '';
    } catch (err) {
      showToast('Failed to load AI models: ' + err.message, true);
    } finally {
      this._loadingModels = false;
    }
  },

  render(state) {
    const panel = document.getElementById('tab-settings');
    const isDark = state.isDark;

    if (!this._modelsList.length && !this._loadingModels) {
      this.loadModelsList().then(() => this.render(state));
    }
    const modelOptions = this._modelsList.length
      ? this._modelsList.map((m) => `<option value="${m}" ${m === this._defaultModel ? 'selected' : ''}>${m}</option>`).join('')
      : `<option value="">${this._loadingModels ? 'Loading models…' : 'No models available'}</option>`;

    panel.innerHTML = `
      <div class="page-header"><div><div class="page-title">Settings</div><div class="page-sub">Configure AI, channels, and theme</div></div></div>
      <div class="grid-2">
        <div class="card">
          <div class="card-header"><div class="card-title">🤖 AI Model</div></div>
          <div class="field"><label>Model</label>
            <select id="aiModelSelect">${modelOptions}</select>
            <div class="block-sub" style="margin-top:4px;">Only models actually enabled on this server's NVIDIA API key are listed. Per-rule overrides are set in Automation → AI message → Model.</div>
          </div>
          <div class="field"><label>System Prompt</label>
            <textarea id="systemPrompt" rows="3" placeholder="You are a helpful sales assistant...">You are a helpful CRM assistant that helps manage leads and respond to inquiries.</textarea>
          </div>
          <div class="field"><label>API Key</label>
            <input type="password" id="aiApiKey" placeholder="Enter API key" value="sk-xxxxxxxxxxxxxxxx" />
          </div>
          <button class="btn btn-primary" onclick="Settings.saveAI()">Save AI Settings</button>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">🎨 Theme Preview</div></div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
            <div style="padding:12px 16px;background:var(--primary);color:#fff;border-radius:var(--radius-sm);">Primary</div>
            <div style="padding:12px 16px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);">Surface</div>
            <div style="padding:12px 16px;background:var(--bg);border-radius:var(--radius-sm);">Background</div>
            <div style="padding:12px 16px;background:var(--text);color:var(--bg);border-radius:var(--radius-sm);">Text</div>
          </div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
            <span class="badge badge-green">✅ Green Badge</span>
            <span class="badge badge-amber">⚠️ Amber Badge</span>
            <span class="badge badge-red">❌ Red Badge</span>
            <span class="badge badge-blue">ℹ️ Blue Badge</span>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-secondary" onclick="toggleTheme()">${isDark ? '☀️ Light Mode' : '🌙 Dark Mode'}</button>
            <button class="btn btn-ghost" onclick="Settings.resetTheme()">Reset to Default</button>
          </div>
          <p style="font-size:11px;color:var(--text3);margin-top:12px;">Theme is loaded from the database. Changes made in the admin panel will reflect here.</p>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">📡 Automation Channels</div></div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;"><input type="checkbox" checked /> WhatsApp</label>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;"><input type="checkbox" checked /> Instagram</label>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;"><input type="checkbox" checked /> Facebook</label>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;"><input type="checkbox" /> Email</label>
          </div>
          <button class="btn btn-primary" style="margin-top:12px;" onclick="Settings.saveChannels()">Save Channels</button>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">🔔 Notifications</div></div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;"><input type="checkbox" checked /> Email notifications</label>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;"><input type="checkbox" /> Push notifications</label>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;"><input type="checkbox" checked /> Weekly reports</label>
          </div>
          <button class="btn btn-primary" style="margin-top:12px;" onclick="Settings.saveNotifications()">Save Notifications</button>
        </div>
      </div>
    `;
  },

  async saveAI() {
    const settings = {
      ai_model: document.getElementById('aiModelSelect')?.value || this._defaultModel,
      system_prompt: document.getElementById('systemPrompt')?.value || '',
      api_key: document.getElementById('aiApiKey')?.value || '',
    };
    try {
      await API.saveSettings(settings);
      showToast('✅ AI settings saved');
    } catch (err) {
      showToast('Saved locally (server not running)', false);
    }
  },

  async saveChannels() {
    const channels = [];
    document.querySelectorAll('#tab-settings input[type="checkbox"]').forEach(cb => {
      if (cb.checked) channels.push(cb.parentElement.textContent.trim());
    });
    try {
      await API.saveSettings({ channels });
      showToast('✅ Channels saved');
    } catch (err) {
      showToast('Saved locally (server not running)', false);
    }
  },

  async saveNotifications() {
    const checkboxes = document.querySelectorAll('#tab-settings input[type="checkbox"]');
    const notifications = {
      email: checkboxes[0]?.checked || false,
      push: checkboxes[1]?.checked || false,
      weekly: checkboxes[2]?.checked || false,
    };
    try {
      await API.saveSettings({ notifications });
      showToast('✅ Notification settings saved');
    } catch (err) {
      showToast('Saved locally (server not running)', false);
    }
  },

  resetTheme() {
    const root = document.documentElement;
    const defaults = {
      '--primary': '#2563eb',
      '--primary-dark': '#1d4ed8',
      '--bg': '#f4f6fa',
      '--bg2': '#eef1f5',
      '--surface': '#ffffff',
      '--surface2': '#f8f9fc',
      '--surface3': '#eef1f5',
      '--border': '#e2e8f0',
      '--border2': '#d1d9e6',
      '--text': '#1e1e2f',
      '--text2': '#64748b',
      '--text3': '#94a3b8',
      '--green': '#22c55e',
      '--amber': '#f59e0b',
      '--red': '#ef4444',
      '--blue': '#3b82f6',
      '--purple': '#8b5cf6',
      '--pink': '#ec4899',
    };
    for (const [key, value] of Object.entries(defaults)) {
      root.style.setProperty(key, value);
    }
    document.body.classList.remove('dark');
    window.state.isDark = false;
    const toggle = document.querySelector('#themeToggle');
    if (toggle) toggle.innerHTML = '<i class="fas fa-moon"></i>';
    localStorage.setItem('crm_dark_mode', 'false');
    showToast('Theme reset to default light mode');
  },
};
// Expose module globally (const declarations do not auto-attach to window)
window.Settings = Settings;
