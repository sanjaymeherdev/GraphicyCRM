// js/modules/automation.js - Full Automation Builder (from reference)
const Automation = {
  render(state) {
    const panel = document.getElementById('tab-automation');
    const rules = state.automations || [];
    const selectedId = state.selectedRuleId || (rules[0]?.id);

    panel.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Automation Builder</div><div class="page-sub">Build rules with triggers, conditions, and actions</div></div>
        <button class="btn btn-primary" onclick="Automation.newRule()">+ New Rule</button>
      </div>
      <div class="automation-layout">
        <div class="rule-list" id="automationRuleList"></div>
        <div id="automationRuleEditor"></div>
      </div>
    `;

    this._rules = rules;
    this._selectedId = selectedId;
    this.renderRuleList();
    this.renderEditor(selectedId);
  },

  _rules: [],
  _selectedId: null,

  renderRuleList() {
    const list = document.getElementById('automationRuleList');
    const rules = this._rules || [];

    if (!rules.length) {
      list.innerHTML = `<div class="empty-state"><div class="empty-icon">⚡</div><p>No rules yet. Create one!</p></div>`;
      return;
    }

    list.innerHTML = rules.map(r => `
      <div class="rule-card ${r.id === this._selectedId ? 'selected' : ''}" data-id="${r.id}" onclick="Automation.selectRule('${r.id}')">
        <div class="kw-row">${(r.keywords || []).slice(0, 3).map(k => `<span class="kw-chip">${escapeHtml(k)}</span>`).join('')}${(r.keywords || []).length > 3 ? `<span class="kw-chip">+${r.keywords.length - 3}</span>` : ''}</div>
        <div class="meta">
          <span>${r.action_type === 'ai' ? '🤖 AI' : '📝 ' + (r.template_name || 'Template')}</span>
          ${r.follow_up?.enabled ? '<span>⏰ follow-up</span>' : ''}
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
      id: 'rule_' + Date.now(),
      name: 'New Rule',
      keywords: [],
      match_type: 'contains',
      action_type: 'template',
      template_id: null,
      ai_prompt: '',
      ai_fallback: "I'll get a teammate to help with that.",
      conditions: [],
      else_template_id: null,
      follow_up: { enabled: false, hours: 4, condition: 'no_reply', template_id: null },
    };
    this._rules.unshift(rule);
    this._selectedId = rule.id;
    this.renderRuleList();
    this.renderEditor(rule.id);
    // Save to API
    API.createAutomation(rule).catch(() => {});
  },

  renderEditor(id) {
    const editor = document.getElementById('automationRuleEditor');
    const rule = this._rules.find(r => r.id === id);
    if (!rule) {
      editor.innerHTML = `<div class="empty-state"><div class="empty-icon">👈</div><p>Select a rule to edit</p></div>`;
      return;
    }

    const templates = window.state?.templates || [];
    const tplOptions = (selected) => `<option value="">Choose a template…</option>` + templates.map(t =>
      `<option value="${t.id}" ${t.id === selected ? 'selected' : ''}>${escapeHtml(t.name)}</option>`
    ).join('');

    editor.innerHTML = `
      <div class="chain">
        <!-- TRIGGER -->
        <div class="block block-trigger">
          <div class="block-head">
            <div class="block-title"><span class="badge-ic">🎯</span>Trigger</div>
            <span class="block-sub">when a keyword matches</span>
          </div>
          <div class="field">
            <label>Rule name</label>
            <input type="text" id="rule-name" value="${escapeHtml(rule.name)}" onchange="Automation.updateRule('${rule.id}', 'name', this.value)" />
          </div>
          <div class="field">
            <label>Keywords</label>
            <div class="tag-input" id="kw-wrap">
              ${(rule.keywords || []).map(k => `<span class="tag">${escapeHtml(k)}<button onclick="Automation.removeKeyword('${rule.id}','${escapeHtml(k)}')">&times;</button></span>`).join('')}
              <input type="text" id="kw-input" placeholder="Type keyword, press Enter" onkeydown="Automation.addKeyword(event, '${rule.id}')" />
            </div>
          </div>
          <div class="field">
            <label>Match type</label>
            <div class="seg" id="match-seg">
              <button class="${rule.match_type === 'exact' ? 'on' : ''}" onclick="Automation.setMatch('${rule.id}','exact')">Exact</button>
              <button class="${rule.match_type === 'contains' ? 'on' : ''}" onclick="Automation.setMatch('${rule.id}','contains')">Contains</button>
              <button class="${rule.match_type === 'fuzzy' ? 'on' : ''}" onclick="Automation.setMatch('${rule.id}','fuzzy')">Fuzzy</button>
            </div>
          </div>
        </div>

        <!-- ACTION -->
        <div class="block ${rule.action_type === 'ai' ? 'block-ai' : 'block-action'}">
          <div class="block-head">
            <div class="block-title"><span class="badge-ic">${rule.action_type === 'ai' ? '🤖' : '📝'}</span>Reply with</div>
            <div class="seg" id="action-seg">
              <button class="${rule.action_type === 'template' ? 'on' : ''}" onclick="Automation.setActionType('${rule.id}','template')">Template</button>
              <button class="${rule.action_type === 'ai' ? 'on' : ''}" onclick="Automation.setActionType('${rule.id}','ai')">AI message</button>
            </div>
          </div>
          <div id="action-body">
            ${rule.action_type === 'template' ? `
              <div class="field">
                <label>Template</label>
                <select id="action-template" onchange="Automation.updateRule('${rule.id}', 'template_id', this.value)">
                  ${tplOptions(rule.template_id)}
                </select>
              </div>
            ` : `
              <div class="field">
                <label>System prompt</label>
                <textarea id="ai-prompt" onchange="Automation.updateRule('${rule.id}', 'ai_prompt', this.value)">${escapeHtml(rule.ai_prompt)}</textarea>
              </div>
              <div class="field">
                <label>Fallback</label>
                <input type="text" id="ai-fallback" value="${escapeHtml(rule.ai_fallback)}" onchange="Automation.updateRule('${rule.id}', 'ai_fallback', this.value)" />
              </div>
            `}
          </div>
        </div>

        <!-- CONDITIONS -->
        <div class="block block-cond">
          <div class="block-head">
            <div class="block-title"><span class="badge-ic">🔀</span>Conditions</div>
            <span class="block-sub">if / else on the reply</span>
          </div>
          <div id="cond-rows">
            ${(rule.conditions || []).map((c, i) => `
              <div class="cond-row">
                <select onchange="Automation.updateCondition('${rule.id}', ${i}, 'variable', this.value)">
                  <option value="reply_option" ${c.variable === 'reply_option' ? 'selected' : ''}>Reply option</option>
                  <option value="sheet_lookup" ${c.variable === 'sheet_lookup' ? 'selected' : ''}>Sheet lookup</option>
                  <option value="order_status" ${c.variable === 'order_status' ? 'selected' : ''}>Order status</option>
                </select>
                <select onchange="Automation.updateCondition('${rule.id}', ${i}, 'operator', this.value)">
                  <option value="equals" ${c.operator === 'equals' ? 'selected' : ''}>equals</option>
                  <option value="contains" ${c.operator === 'contains' ? 'selected' : ''}>contains</option>
                  <option value="gt" ${c.operator === 'gt' ? 'selected' : ''}>&gt;</option>
                  <option value="lt" ${c.operator === 'lt' ? 'selected' : ''}>&lt;</option>
                </select>
                <input type="text" value="${escapeHtml(c.value || '')}" placeholder="value" onchange="Automation.updateCondition('${rule.id}', ${i}, 'value', this.value)" />
                <select onchange="Automation.updateCondition('${rule.id}', ${i}, 'template_id', this.value)">
                  ${tplOptions(c.template_id)}
                </select>
                <button class="rm" onclick="Automation.removeCondition('${rule.id}', ${i})">&times;</button>
              </div>
            `).join('')}
          </div>
          <button class="add-row" onclick="Automation.addCondition('${rule.id}')">+ Add condition</button>
          <div class="cond-else">
            Else, reply with
            <select id="else-template" onchange="Automation.updateRule('${rule.id}', 'else_template_id', this.value)">
              ${tplOptions(rule.else_template_id)}
            </select>
          </div>
        </div>

        <!-- FOLLOW UP -->
        <div class="block block-follow">
          <div class="block-head">
            <div class="block-title"><span class="badge-ic">⏰</span>Follow-up</div>
            <div class="follow-toggle">
              <span class="switch ${rule.follow_up?.enabled ? 'on' : ''}" onclick="Automation.toggleFollowUp('${rule.id}')"></span>
              <span class="lbl">${rule.follow_up?.enabled ? 'On' : 'Off'}</span>
            </div>
          </div>
          <div class="follow-body ${rule.follow_up?.enabled ? '' : 'disabled'}">
            <div class="field-row">
              <div class="field">
                <label>Wait (hours)</label>
                <select id="follow-hours" onchange="Automation.updateFollowUp('${rule.id}', 'hours', parseInt(this.value))">
                  ${Array.from({ length: 20 }, (_, i) => i + 1).map(h => `<option value="${h}" ${rule.follow_up?.hours === h ? 'selected' : ''}>${h}h</option>`).join('')}
                </select>
              </div>
              <div class="field">
                <label>If</label>
                <select id="follow-condition" onchange="Automation.updateFollowUp('${rule.id}', 'condition', this.value)">
                  <option value="no_reply" ${rule.follow_up?.condition === 'no_reply' ? 'selected' : ''}>No reply</option>
                  <option value="no_purchase" ${rule.follow_up?.condition === 'no_purchase' ? 'selected' : ''}>No purchase</option>
                </select>
              </div>
            </div>
            <div class="field">
              <label>Then send</label>
              <select id="follow-template" onchange="Automation.updateFollowUp('${rule.id}', 'template_id', this.value)">
                ${tplOptions(rule.follow_up?.template_id)}
              </select>
            </div>
          </div>
        </div>
      </div>
      <div style="display:flex;gap:10px;margin-top:6px;padding-left:28px;">
        <button class="btn btn-primary btn-sm" onclick="Automation.saveRule('${rule.id}')">💾 Save Rule</button>
        <button class="btn btn-danger btn-sm" onclick="Automation.deleteRule('${rule.id}')">🗑 Delete</button>
      </div>
    `;
  },

  // ─── HELPERS ───
  addKeyword(event, ruleId) {
    if (event.key === 'Enter') {
      const input = document.getElementById('kw-input');
      const val = input.value.trim();
      if (val) {
        const rule = this._rules.find(r => r.id === ruleId);
        if (rule) {
          rule.keywords = rule.keywords || [];
          rule.keywords.push(val);
          input.value = '';
          this.renderEditor(ruleId);
          this.renderRuleList();
        }
      }
    }
  },

  removeKeyword(ruleId, keyword) {
    const rule = this._rules.find(r => r.id === ruleId);
    if (rule) {
      rule.keywords = (rule.keywords || []).filter(k => k !== keyword);
      this.renderEditor(ruleId);
      this.renderRuleList();
    }
  },

  setMatch(ruleId, matchType) {
    const rule = this._rules.find(r => r.id === ruleId);
    if (rule) { rule.match_type = matchType; this.renderEditor(ruleId); }
  },

  setActionType(ruleId, type) {
    const rule = this._rules.find(r => r.id === ruleId);
    if (rule) { rule.action_type = type; this.renderEditor(ruleId); }
  },

  updateRule(ruleId, field, value) {
    const rule = this._rules.find(r => r.id === ruleId);
    if (rule) { rule[field] = value; }
  },

  addCondition(ruleId) {
    const rule = this._rules.find(r => r.id === ruleId);
    if (rule) {
      rule.conditions = rule.conditions || [];
      rule.conditions.push({ variable: 'reply_option', operator: 'equals', value: '', template_id: null });
      this.renderEditor(ruleId);
    }
  },

  removeCondition(ruleId, index) {
    const rule = this._rules.find(r => r.id === ruleId);
    if (rule && rule.conditions) {
      rule.conditions.splice(index, 1);
      this.renderEditor(ruleId);
    }
  },

  updateCondition(ruleId, index, field, value) {
    const rule = this._rules.find(r => r.id === ruleId);
    if (rule && rule.conditions && rule.conditions[index]) {
      rule.conditions[index][field] = value;
    }
  },

  toggleFollowUp(ruleId) {
    const rule = this._rules.find(r => r.id === ruleId);
    if (rule) {
      rule.follow_up = rule.follow_up || { enabled: false, hours: 4, condition: 'no_reply', template_id: null };
      rule.follow_up.enabled = !rule.follow_up.enabled;
      this.renderEditor(ruleId);
      this.renderRuleList();
    }
  },

  updateFollowUp(ruleId, field, value) {
    const rule = this._rules.find(r => r.id === ruleId);
    if (rule) {
      rule.follow_up = rule.follow_up || { enabled: false, hours: 4, condition: 'no_reply', template_id: null };
      rule.follow_up[field] = value;
    }
  },

  async saveRule(ruleId) {
    const rule = this._rules.find(r => r.id === ruleId);
    if (!rule) return;
    try {
      await API.updateAutomation(rule.serverId || rule.id, rule);
      showToast('✅ Rule saved');
    } catch (err) {
      // Try creating if it doesn't exist
      try {
        const result = await API.createAutomation(rule);
        rule.serverId = result.id || result.automation?.id;
        showToast('✅ Rule created');
      } catch (e) {
        showToast('Failed: ' + e.message, true);
      }
    }
  },

  async deleteRule(ruleId) {
    if (!confirm('Delete this rule?')) return;
    const rule = this._rules.find(r => r.id === ruleId);
    if (rule && rule.serverId) {
      try {
        await API.deleteAutomation(rule.serverId);
      } catch (err) {
        showToast('Failed to delete from server: ' + err.message, true);
      }
    }
    this._rules = this._rules.filter(r => r.id !== ruleId);
    this._selectedId = this._rules[0]?.id || null;
    this.renderRuleList();
    this.renderEditor(this._selectedId);
  },
};
// Expose module globally (const declarations do not auto-attach to window)
window.Automation = Automation;
