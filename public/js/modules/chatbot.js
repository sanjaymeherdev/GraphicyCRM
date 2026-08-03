// js/modules/chatbot.js — UI for the AI chatbot engine (modules/ai-bot).
// The backend (/api/ai-bot/*: models, chat, rules CRUD) already existed but
// had no frontend page, nav item, or API bindings — hence "chatbot option
// not showing". This wires it up the same way Automation/Templates work.
const Chatbot = {
  async render(state) {
    const panel = document.getElementById('tab-chatbot');
    if (!panel) return;

    panel.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Chatbot</div><div class="page-sub">AI reply engine — keyword rules and a live test chat</div></div>
        <button class="btn btn-primary btn-sm" onclick="Chatbot.newRule()">+ New Rule</button>
      </div>
      <div class="automation-layout">
        <div class="rule-list" id="chatbotRuleList"><div class="empty-state"><p>Loading…</p></div></div>
        <div id="chatbotRuleEditor"></div>
      </div>
      <div class="page-header" style="margin-top:24px;">
        <div><div class="page-title" style="font-size:16px;">Test Chat</div><div class="page-sub">Try the model directly, outside of any rule</div></div>
      </div>
      <div id="chatbotTestPanel"></div>
    `;

    this._models = this._models || [];
    this._chatHistory = this._chatHistory || [];
    this.renderTestPanel();

    try {
      const [rulesRes, modelsRes] = await Promise.all([
        API.getChatbotRules(),
        this._models.length ? Promise.resolve({ models: this._models }) : API.getAvailableModels(),
      ]);
      this._rules = rulesRes.rules || [];
      this._models = modelsRes.models || [];
      this._defaultModel = modelsRes.default_model || this._models[0] || null;
      this._selectedId = this._selectedId || this._rules[0]?.id || null;
      this.renderRuleList();
      this.renderEditor(this._selectedId);
      this.renderTestPanel();
    } catch (err) {
      document.getElementById('chatbotRuleList').innerHTML =
        `<div class="empty-state"><p>Failed to load: ${escapeHtml(err.message)}</p></div>`;
    }
  },

  _rules: [],
  _selectedId: null,
  _models: [],
  _defaultModel: null,
  _chatHistory: [],

  renderRuleList() {
    const list = document.getElementById('chatbotRuleList');
    if (!list) return;
    const rules = this._rules || [];
    if (!rules.length) {
      list.innerHTML = `<div class="empty-state"><div class="empty-icon">🤖</div><p>No chatbot rules yet. Create one!</p></div>`;
      return;
    }
    list.innerHTML = rules.map(r => `
      <div class="rule-card ${r.id === this._selectedId ? 'selected' : ''}" onclick="Chatbot.selectRule('${r.id}')">
        <div class="kw-row">${(r.keywords || []).slice(0, 3).map(k => `<span class="kw-chip">${escapeHtml(k)}</span>`).join('') || '<span class="kw-chip">(no keywords)</span>'}</div>
        <div class="meta">
          <span>${r.action_type === 'ai_reply' ? '🤖 AI reply' : r.action_type === 'template' ? '📝 Template' : '— No action'}</span>
          <span>${r.active === false ? 'Inactive' : 'Active'}</span>
        </div>
      </div>
    `).join('');
  },

  selectRule(id) {
    this._selectedId = id;
    this.renderRuleList();
    this.renderEditor(id);
  },

  newRule() {
    const rule = {
      id: 'bot_' + Date.now(),
      name: 'New chatbot rule',
      keywords: [],
      match_type: 'contains',
      action_type: 'ai_reply',
      action_config: { ai_prompt: 'You are a helpful assistant.', model: this._defaultModel },
      active: true,
    };
    this._rules.unshift(rule);
    this._selectedId = rule.id;
    this.renderRuleList();
    this.renderEditor(rule.id);
    API.createChatbotRule(rule).then((result) => {
      rule.serverId = result.rule?.id;
    }).catch((err) => showToast('Failed to save new rule: ' + err.message, true));
  },

  renderEditor(id) {
    const editor = document.getElementById('chatbotRuleEditor');
    if (!editor) return;
    const rule = (this._rules || []).find(r => r.id === id);
    if (!rule) {
      editor.innerHTML = `<div class="empty-state"><div class="empty-icon">👈</div><p>Select a rule to edit</p></div>`;
      return;
    }
    rule.action_config = rule.action_config || {};

    editor.innerHTML = `
      <div class="field"><label>Rule name</label><input type="text" value="${escapeHtml(rule.name || '')}" onchange="Chatbot.update('${id}','name',this.value)" /></div>
      <div class="field">
        <label>Keywords (comma separated)</label>
        <input type="text" value="${escapeHtml((rule.keywords || []).join(', '))}"
          onchange="Chatbot.update('${id}','keywords',this.value.split(',').map(s=>s.trim()).filter(Boolean))" />
      </div>
      <div class="field">
        <label>Match type</label>
        <select onchange="Chatbot.update('${id}','match_type',this.value)">
          ${['contains', 'exact', 'fuzzy'].map(m => `<option value="${m}" ${rule.match_type === m ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Action</label>
        <div class="seg">
          <button class="${rule.action_type === 'ai_reply' ? 'on' : ''}" onclick="Chatbot.setActionType('${id}','ai_reply')">AI reply</button>
          <button class="${rule.action_type === 'template' ? 'on' : ''}" onclick="Chatbot.setActionType('${id}','template')">Template</button>
          <button class="${rule.action_type === 'none' ? 'on' : ''}" onclick="Chatbot.setActionType('${id}','none')">None</button>
        </div>
      </div>
      ${rule.action_type === 'ai_reply' ? `
        <div class="field">
          <label>Model</label>
          <select onchange="Chatbot.updateConfig('${id}','model',this.value)">
            ${(this._models || []).map(m => `<option value="${m}" ${rule.action_config.model === m ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>System prompt</label><textarea onchange="Chatbot.updateConfig('${id}','ai_prompt',this.value)">${escapeHtml(rule.action_config.ai_prompt || '')}</textarea></div>
      ` : ''}
      ${rule.action_type === 'template' ? `
        <div class="field">
          <label>Template</label>
          <select onchange="Chatbot.updateConfig('${id}','template_id',this.value)">
            <option value="">Choose a template…</option>
            ${(window.state?.templates || []).map(t => `<option value="${t.serverId || t.id}" ${rule.action_config.template_id === (t.serverId || t.id) ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}
          </select>
        </div>
      ` : ''}
      <div class="field">
        <label><input type="checkbox" ${rule.active !== false ? 'checked' : ''} onchange="Chatbot.update('${id}','active',this.checked)" /> Active</label>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;">
        <button class="btn btn-primary btn-sm" onclick="Chatbot.saveRule('${id}')">💾 Save Rule</button>
        <button class="btn btn-danger btn-sm" onclick="Chatbot.deleteRule('${id}')">🗑 Delete</button>
      </div>
    `;
  },

  update(id, field, value) {
    const rule = (this._rules || []).find(r => r.id === id);
    if (rule) rule[field] = value;
  },

  updateConfig(id, field, value) {
    const rule = (this._rules || []).find(r => r.id === id);
    if (rule) { rule.action_config = rule.action_config || {}; rule.action_config[field] = value; }
  },

  setActionType(id, type) {
    const rule = (this._rules || []).find(r => r.id === id);
    if (rule) { rule.action_type = type; this.renderEditor(id); }
  },

  async saveRule(id) {
    const rule = (this._rules || []).find(r => r.id === id);
    if (!rule) return;
    try {
      if (rule.serverId) await API.updateChatbotRule(rule.serverId, rule);
      else {
        const result = await API.createChatbotRule(rule);
        rule.serverId = result.rule?.id;
      }
      showToast('✅ Chatbot rule saved');
      this.renderRuleList();
    } catch (err) {
      showToast('Failed: ' + err.message, true);
    }
  },

  async deleteRule(id) {
    if (!confirm('Delete this chatbot rule?')) return;
    const rule = (this._rules || []).find(r => r.id === id);
    if (rule?.serverId) {
      try { await API.deleteChatbotRule(rule.serverId); }
      catch (err) { showToast('Failed to delete from server: ' + err.message, true); }
    }
    this._rules = (this._rules || []).filter(r => r.id !== id);
    this._selectedId = this._rules[0]?.id || null;
    this.renderRuleList();
    this.renderEditor(this._selectedId);
  },

  // ─── Test chat ───
  renderTestPanel() {
    const panel = document.getElementById('chatbotTestPanel');
    if (!panel) return;
    panel.innerHTML = `
      <div id="chatbotWindow" style="max-height:260px;overflow-y:auto;margin-bottom:8px;border:1px solid var(--border,#e5e7eb);border-radius:8px;padding:8px;">
        ${(this._chatHistory || []).map(m => `
          <div style="padding:4px 0;"><b>${m.role === 'user' ? 'You' : 'Bot'}:</b> ${escapeHtml(m.content)}</div>
        `).join('') || '<div class="page-sub">Say something below to try the model.</div>'}
      </div>
      <div style="display:flex;gap:8px;">
        <input type="text" id="chatbotTestInput" placeholder="Type a test message…" style="flex:1;" onkeydown="if(event.key==='Enter')Chatbot.sendTestMessage();" />
        <button class="btn btn-primary btn-sm" onclick="Chatbot.sendTestMessage()">Send</button>
      </div>
    `;
  },

  async sendTestMessage() {
    const input = document.getElementById('chatbotTestInput');
    const text = input?.value?.trim();
    if (!text) return;
    input.value = '';
    this._chatHistory.push({ role: 'user', content: text });
    this.renderTestPanel();
    try {
      const res = await API.sendChatbotMessage(this._chatHistory, { model: this._defaultModel });
      this._chatHistory.push({ role: 'assistant', content: res.content || '(no reply)' });
    } catch (err) {
      this._chatHistory.push({ role: 'assistant', content: 'Error: ' + err.message });
    }
    this.renderTestPanel();
  },
};
// Expose module globally (const declarations do not auto-attach to window)
window.Chatbot = Chatbot;
