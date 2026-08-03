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
          <span>${r.action_type === 'ai_reply' ? '🤖 AI' : '📝 ' + (r.template_name || 'Template')}</span>
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
      action_config: {},
      follow_up: { enabled: false, hours: 4, condition: 'no_reply', template_id: null },
    };
    this._rules.unshift(rule);
    this._selectedId = rule.id;
    this.renderRuleList();
    this.renderEditor(rule.id);
    // Save to API — capture the server-assigned id (crm_automations.id is a
    // uuid) into rule.serverId. Without this, saveRule() falls back to using
    // the client-generated 'rule_<timestamp>' id, which is not a valid uuid
    // and never matches a row, so every future Save silently fails the
    // UPDATE and re-creates a duplicate row instead of updating this one.
    API.createAutomation(rule).then((result) => {
      rule.serverId = result.id || result.automation?.id;
    }).catch((err) => {
      showToast('Failed to save new rule: ' + err.message, true);
    });
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

    if (rule.action_config?.knowledge_doc?.docId !== undefined && !this._docsList.length && !this._loadingDocs) {
      this.loadGoogleDocsList().then(() => this.renderEditor(id));
    }
    if (rule.action_type === 'ai_reply' && !this._modelsList.length && !this._loadingModels) {
      this.loadModelsList().then(() => this.renderEditor(id));
    }
    const sheetLookup = rule.action_config?.sheet_lookup;
    if (sheetLookup?.spreadsheetId !== undefined && !this._sheetsList.length && !this._loadingSheets) {
      this.loadGoogleSheetsList().then(() => this.renderEditor(id));
    }
    if (sheetLookup?.spreadsheetId && !this._tabsCache[sheetLookup.spreadsheetId] && !this._loadingTabs[sheetLookup.spreadsheetId]) {
      this.loadTabsFor(sheetLookup.spreadsheetId).then(() => this.renderEditor(id));
    }
    if (sheetLookup?.spreadsheetId && sheetLookup?.worksheet) {
      const key = `${sheetLookup.spreadsheetId}::${sheetLookup.worksheet}`;
      if (!this._headersCache[key] && !this._loadingHeaders[key]) {
        this.loadHeadersFor(sheetLookup.spreadsheetId, sheetLookup.worksheet).then(() => this.renderEditor(id));
      }
    }

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
        <div class="block ${rule.action_type === 'ai_reply' ? 'block-ai' : 'block-action'}">
          <div class="block-head">
            <div class="block-title"><span class="badge-ic">${rule.action_type === 'ai_reply' ? '🤖' : '📝'}</span>Reply with</div>
            <div class="seg" id="action-seg">
              <button class="${rule.action_type === 'template' ? 'on' : ''}" onclick="Automation.setActionType('${rule.id}','template')">Template</button>
              <button class="${rule.action_type === 'ai_reply' ? 'on' : ''}" onclick="Automation.setActionType('${rule.id}','ai_reply')">AI message</button>
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
                <label>Model</label>
                <select onchange="Automation.updateActionConfigField('${rule.id}', 'model', this.value)">
                  ${this._modelsList.map((m) => `<option value="${m}" ${(rule.action_config?.model || this._defaultModel) === m ? 'selected' : ''}>${m}</option>`).join('')
                    || `<option value="">${this._loadingModels ? 'Loading models…' : 'No models available'}</option>`}
                </select>
                <div class="block-sub">Only models actually enabled on this server's NVIDIA API key are listed.</div>
              </div>
              <div class="field">
                <label>Fallback</label>
                <input type="text" id="ai-fallback" value="${escapeHtml(rule.ai_fallback)}" onchange="Automation.updateRule('${rule.id}', 'ai_fallback', this.value)" />
              </div>
            `}
          </div>
        </div>

        <!-- ADVANCED: SHEET LOOKUP + KNOWLEDGE DOC -->
        <div class="block block-advanced">
          <div class="block-head">
            <div class="block-title"><span class="badge-ic">🔎</span>Advanced grounding</div>
            <span class="block-sub">look up a value or fetch a doc before replying</span>
          </div>
          <div class="field">
            <label style="display:flex;align-items:center;gap:8px;">
              <span class="switch ${rule.action_config?.sheet_lookup?.spreadsheetId ? 'on' : ''}" onclick="Automation.toggleSheetLookup('${rule.id}')"></span>
              Sheet lookup <span class="block-sub" style="margin-left:4px;">— each rule gets its own lookup, so different keywords can search different sheets ("multi lookup")</span>
            </label>
          </div>
          ${rule.action_config?.sheet_lookup?.spreadsheetId !== undefined ? (() => {
            const sl = rule.action_config.sheet_lookup;
            const tabs = this._tabsCache[sl.spreadsheetId] || [];
            const tabsLoading = !!this._loadingTabs[sl.spreadsheetId];
            const headersKey = `${sl.spreadsheetId}::${sl.worksheet}`;
            const headers = this._headersCache[headersKey] || [];
            const headersLoading = !!this._loadingHeaders[headersKey];
            // Same "fall back to the raw stored value if it's no longer in the
            // fetched list" pattern as sources.js's columnSelect — so editing an
            // existing rule never silently blanks out its saved mapping.
            const columnSelect = (field, currentValue) => `
              <select onchange="Automation.updateActionConfig('${rule.id}','sheet_lookup','${field}', this.value)" ${!headers.length && !headersLoading ? 'disabled' : ''}>
                <option value="">${headersLoading ? 'Loading columns…' : (headers.length ? '— pick a column —' : 'Pick a spreadsheet + worksheet first')}</option>
                ${headers.map((h) => `<option value="${escapeHtml(h)}" ${h === currentValue ? 'selected' : ''}>${escapeHtml(h)}</option>`).join('')}
                ${currentValue && !headers.includes(currentValue) ? `<option value="${escapeHtml(currentValue)}" selected>${escapeHtml(currentValue)} (not found in sheet)</option>` : ''}
              </select>
            `;
            return `
            <div class="field-row">
              <div class="field">
                <label>Spreadsheet</label>
                <select onchange="Automation.onSheetLookupSpreadsheetChange('${rule.id}', this.value)">
                  <option value="">${this._loadingSheets ? 'Loading your Google Sheets…' : '— Select a spreadsheet —'}</option>
                  ${this._sheetsList.map((s) => `<option value="${s.id}" ${s.id === sl.spreadsheetId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
                  ${sl.spreadsheetId && !this._sheetsList.some((s) => s.id === sl.spreadsheetId) ? `<option value="${escapeHtml(sl.spreadsheetId)}" selected>${escapeHtml(sl.spreadsheetId)} (not found — check Google connection)</option>` : ''}
                </select>
              </div>
              <div class="field">
                <label>Worksheet (tab name)</label>
                <select onchange="Automation.onSheetLookupWorksheetChange('${rule.id}', this.value)" ${!sl.spreadsheetId ? 'disabled' : ''}>
                  <option value="">${tabsLoading ? 'Loading tabs…' : (tabs.length ? '— pick a tab —' : (sl.spreadsheetId ? 'No tabs found' : 'Pick a spreadsheet first'))}</option>
                  ${tabs.map((t) => `<option value="${escapeHtml(t)}" ${t === sl.worksheet ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
                  ${sl.worksheet && !tabs.includes(sl.worksheet) ? `<option value="${escapeHtml(sl.worksheet)}" selected>${escapeHtml(sl.worksheet)} (not found in sheet)</option>` : ''}
                </select>
              </div>
            </div>
            <div class="field-row">
              <div class="field">
                <label>Lookup column</label>
                ${columnSelect('lookupColumn', sl.lookupColumn)}
              </div>
              <div class="field">
                <label>Return column</label>
                ${columnSelect('returnColumn', sl.returnColumn)}
              </div>
              <div class="field">
                <label>Match type</label>
                <select onchange="Automation.updateActionConfig('${rule.id}','sheet_lookup','matchType', this.value)">
                  <option value="contains" ${(sl.matchType || 'contains') === 'contains' ? 'selected' : ''}>Contains</option>
                  <option value="exact" ${sl.matchType === 'exact' ? 'selected' : ''}>Exact</option>
                </select>
              </div>
            </div>
            <div class="block-sub" style="margin:2px 0 10px;">The message text is matched against every row's lookup column. Use <code>{{sheet_lookup}}</code> in a template body, or add a condition above on "Sheet lookup" (e.g. equals <code>__not_found__</code> for a no-match branch).</div>
          `; })() : ''}
          ${rule.action_type === 'ai_reply' ? `
            <div class="field">
              <label style="display:flex;align-items:center;gap:8px;">
                <span class="switch ${rule.action_config?.knowledge_doc?.docId ? 'on' : ''}" onclick="Automation.toggleKnowledgeDoc('${rule.id}')"></span>
                Knowledge doc <span class="block-sub" style="margin-left:4px;">— a Google Doc's text gets fetched and added to the AI's context</span>
              </label>
            </div>
            ${rule.action_config?.knowledge_doc?.docId !== undefined ? `
              <div class="field-row">
                <div class="field">
                  <label>Google Doc</label>
                  <select onchange="Automation.onKnowledgeDocChange('${rule.id}', this.value)">
                    <option value="">${this._loadingDocs ? 'Loading your Google Docs…' : '— Select a doc —'}</option>
                    ${this._docsList.map((doc) => `<option value="${doc.id}" ${doc.id === rule.action_config?.knowledge_doc?.docId ? 'selected' : ''}>${escapeHtml(doc.name)}</option>`).join('')}
                    ${rule.action_config?.knowledge_doc?.docId && !this._docsList.some((doc) => doc.id === rule.action_config.knowledge_doc.docId) ? `<option value="${escapeHtml(rule.action_config.knowledge_doc.docId)}" selected>${escapeHtml(rule.action_config.knowledge_doc.docName || rule.action_config.knowledge_doc.docId)} (not found — check Google connection)</option>` : ''}
                  </select>
                </div>
              </div>
              <div class="block-sub" style="margin:2px 0 10px;">Fetched text is cached for 5 minutes and capped at 8,000 characters so the AI prompt stays bounded.</div>
            ` : ''}
          ` : ''}
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

  // AI model dropdown — fetched from GET /api/ai-bot/models, which returns
  // exactly the ALLOWED_MODELS list modules/ai-bot/service.js will actually
  // accept (and rejects anything else with a 400) — so this can never show
  // a model that doesn't really work.
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

  updateActionConfigField(ruleId, field, value) {
    const rule = this._rules.find(r => r.id === ruleId);
    if (rule) {
      rule.action_config = rule.action_config || {};
      rule.action_config[field] = value;
    }
  },

  toggleSheetLookup(ruleId) {
    const rule = this._rules.find(r => r.id === ruleId);
    if (!rule) return;
    rule.action_config = rule.action_config || {};
    if (rule.action_config.sheet_lookup?.spreadsheetId !== undefined) {
      delete rule.action_config.sheet_lookup;
      this.renderEditor(ruleId);
    } else {
      rule.action_config.sheet_lookup = { spreadsheetId: '', worksheet: '', lookupColumn: '', returnColumn: '', matchType: 'contains' };
      this.renderEditor(ruleId);
      this.loadGoogleSheetsList().then(() => this.renderEditor(ruleId));
    }
  },

  // Sheet lookup dropdown pickers — spreadsheet/tabs/headers, fetched from
  // Google via the same /api/sheets endpoints (and same caches-by-id shape)
  // as the Sheet→Leads watcher picker in sources.js, so a spreadsheet's tabs
  // or a worksheet's headers only ever get fetched once per id.
  _sheetsList: [],
  _loadingSheets: false,
  _tabsCache: {},    // spreadsheetId -> string[]
  _loadingTabs: {},  // spreadsheetId -> bool
  _headersCache: {},   // "spreadsheetId::worksheet" -> string[]
  _loadingHeaders: {}, // "spreadsheetId::worksheet" -> bool

  async loadGoogleSheetsList() {
    if (this._sheetsList.length || this._loadingSheets) return;
    this._loadingSheets = true;
    try {
      const data = await API.listGoogleSheets();
      this._sheetsList = data.spreadsheets || [];
    } catch (err) {
      showToast('Failed to load your Google Sheets: ' + err.message, true);
    } finally {
      this._loadingSheets = false;
    }
  },

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
    const key = `${spreadsheetId}::${worksheet}`;
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

  // Spreadsheet dropdown changed — reset worksheet + column choices (they no
  // longer apply to the new spreadsheet), then fetch its tabs.
  async onSheetLookupSpreadsheetChange(ruleId, spreadsheetId) {
    const rule = this._rules.find(r => r.id === ruleId);
    const sl = rule?.action_config?.sheet_lookup;
    if (!sl) return;
    sl.spreadsheetId = spreadsheetId;
    sl.worksheet = ''; sl.lookupColumn = ''; sl.returnColumn = '';
    this.renderEditor(ruleId);
    await this.loadTabsFor(spreadsheetId);
    this.renderEditor(ruleId);
  },

  // Worksheet dropdown changed — reset column choices, then fetch the new
  // worksheet's header row.
  async onSheetLookupWorksheetChange(ruleId, worksheet) {
    const rule = this._rules.find(r => r.id === ruleId);
    const sl = rule?.action_config?.sheet_lookup;
    if (!sl) return;
    sl.worksheet = worksheet;
    sl.lookupColumn = ''; sl.returnColumn = '';
    this.renderEditor(ruleId);
    await this.loadHeadersFor(sl.spreadsheetId, worksheet);
    this.renderEditor(ruleId);
  },

  toggleKnowledgeDoc(ruleId) {
    const rule = this._rules.find(r => r.id === ruleId);
    if (!rule) return;
    rule.action_config = rule.action_config || {};
    if (rule.action_config.knowledge_doc?.docId !== undefined) {
      delete rule.action_config.knowledge_doc;
      this.renderEditor(ruleId);
    } else {
      rule.action_config.knowledge_doc = { docId: '', docName: '' };
      this.renderEditor(ruleId);
      this.loadGoogleDocsList().then(() => this.renderEditor(ruleId));
    }
  },

  // Google Docs dropdown (AI bot "knowledge doc" picker) — fetched once via
  // Drive API and cached; picking one auto-fills docName from the doc's
  // actual title instead of the user typing both an ID and a label.
  _docsList: [],
  _loadingDocs: false,
  async loadGoogleDocsList() {
    if (this._docsList.length || this._loadingDocs) return;
    this._loadingDocs = true;
    try {
      const data = await API.listGoogleDocs();
      this._docsList = data.docs || [];
    } catch (err) {
      showToast('Failed to load your Google Docs: ' + err.message, true);
    } finally {
      this._loadingDocs = false;
    }
  },

  onKnowledgeDocChange(ruleId, docId) {
    const rule = this._rules.find(r => r.id === ruleId);
    if (!rule) return;
    const doc = this._docsList.find((d) => d.id === docId);
    rule.action_config = rule.action_config || {};
    rule.action_config.knowledge_doc = { docId, docName: doc?.name || '' };
    this.renderEditor(ruleId);
  },

  updateActionConfig(ruleId, group, field, value) {
    const rule = this._rules.find(r => r.id === ruleId);
    if (rule) {
      rule.action_config = rule.action_config || {};
      rule.action_config[group] = rule.action_config[group] || {};
      rule.action_config[group][field] = value;
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
