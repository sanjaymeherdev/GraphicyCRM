// js/modules/templates.js
const Templates = {
  render(state) {
    const panel = document.getElementById('tab-templates');
    const templates = state.templates || [];
    const selectedId = state.selectedTplId || (templates[0]?.id);

    panel.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Templates</div><div class="page-sub">Message templates for automations</div></div>
        <button class="btn btn-primary btn-sm" onclick="Templates.newTemplate()">+ New Template</button>
      </div>
      <div class="tpl-layout">
        <div id="tpl-list">
          ${templates.map(t => `
            <div class="tpl-card ${t.id === selectedId ? 'selected' : ''}" onclick="Templates.selectTemplate('${t.id}')">
              <div class="name">${escapeHtml(t.name)}</div>
              <div class="type">${t.type || 'text'} · ${(t.format || 'text').toUpperCase()}</div>
            </div>
          `).join('') || '<div class="empty-state"><p>No templates yet</p></div>'}
        </div>
        <div id="tpl-editor">
          ${selectedId ? this.renderEditor(selectedId, state) : '<div class="empty-state"><div class="empty-icon">📝</div><p>Select or create a template</p></div>'}
        </div>
      </div>
    `;

    this._templates = templates;
    this._selectedId = selectedId;
  },

  _templates: [],
  _selectedId: null,

  selectTemplate(id) {
    this._selectedId = id;
    const state = window.state || {};
    this.render(state);
  },

  newTemplate() {
    const tpl = {
      id: 'tpl_' + Date.now(),
      name: 'New Template',
      type: 'plaintext',
      format: 'text',
      body: '',
      header: { type: 'none', value: '' },
      footer: '',
    };
    this._templates.unshift(tpl);
    this._selectedId = tpl.id;
    const state = window.state || {};
    this.render(state);
  },

  renderEditor(id, state) {
    const tpl = this._templates.find(t => t.id === id);
    if (!tpl) return '<div class="empty-state"><p>Template not found</p></div>';
    const format = tpl.format || 'text';
    const bodyPlaceholder = format === 'json'
      ? '{\n  "type": "text",\n  "text": { "body": "Hi {{name}}, ..." }\n}'
      : format === 'html'
        ? '<p>Hi {{name}}, ...</p>'
        : 'Hi {{name}}, ...';

    return `
      <div class="split">
        <div>
          <div class="field"><label>Template name</label><input type="text" id="tpl-name" value="${escapeHtml(tpl.name)}" onchange="Templates.updateTemplate('${id}','name',this.value)" /></div>
          <div class="type-grid">
            ${['plaintext','buttons','list','cta','product'].map(type => `
              <div class="type-opt ${tpl.type === type ? 'on' : ''}" onclick="Templates.updateTemplate('${id}','type','${type}');Templates.render(window.state);">
                <span class="ic">${type === 'plaintext' ? '📝' : type === 'buttons' ? '🔘' : type === 'list' ? '📋' : type === 'cta' ? '🔗' : '🛍️'}</span>
                ${type}
              </div>
            `).join('')}
          </div>
          <div class="field">
            <label>Send format</label>
            <div class="type-grid" style="grid-template-columns:repeat(3,1fr);">
              ${[
                { v: 'text', label: 'Plain Text', hint: 'WhatsApp / Facebook / Instagram / Email' },
                { v: 'json', label: 'JSON', hint: 'Raw API payload — WhatsApp / Facebook / Instagram' },
                { v: 'html', label: 'HTML', hint: 'Email only' },
              ].map(opt => `
                <div class="type-opt ${format === opt.v ? 'on' : ''}" title="${escapeHtml(opt.hint)}" onclick="Templates.updateTemplate('${id}','format','${opt.v}');Templates.render(window.state);">
                  <span class="ic">${opt.v === 'text' ? '📝' : opt.v === 'json' ? '{ }' : '</>'}</span>
                  ${opt.label}
                </div>
              `).join('')}
            </div>
            <div class="page-sub" style="margin-top:4px;">
              ${format === 'json'
                ? 'Body must be valid JSON — the raw message payload sent to the channel API (WhatsApp/Facebook/Instagram only).'
                : format === 'html'
                  ? 'Body is sent as an HTML email — only applies when this template is used for email/Gmail sends.'
                  : 'Body is sent as-is, as plain message text.'}
            </div>
          </div>
          <div class="field">
            <label>Body${format === 'json' ? ' (JSON)' : format === 'html' ? ' (HTML)' : ''}</label>
            <textarea id="tpl-body" placeholder="${escapeHtml(bodyPlaceholder)}" style="${format !== 'text' ? 'font-family:monospace;' : ''}" onchange="Templates.updateTemplate('${id}','body',this.value)">${escapeHtml(tpl.body)}</textarea>
            ${format === 'json' ? `<div id="tpl-json-error" class="page-sub" style="color:var(--danger,#e5484d);"></div>` : ''}
          </div>
          <div class="field"><label>Footer</label><input type="text" id="tpl-footer" value="${escapeHtml(tpl.footer || '')}" onchange="Templates.updateTemplate('${id}','footer',this.value)" /></div>
        </div>
        <div class="json-panel">
          <div class="jp-head"><span>JSON preview</span></div>
          <pre>${JSON.stringify({ name: tpl.name, type: tpl.type, format, body: tpl.body, footer: tpl.footer }, null, 2)}</pre>
        </div>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;">
        <button class="btn btn-primary btn-sm" onclick="Templates.saveTemplate('${id}')">💾 Save Template</button>
        <button class="btn btn-danger btn-sm" onclick="Templates.deleteTemplate('${id}')">🗑 Delete</button>
      </div>
    `;
  },

  updateTemplate(id, field, value) {
    const tpl = this._templates.find(t => t.id === id);
    if (tpl) tpl[field] = value;
  },

  async saveTemplate(id) {
    const tpl = this._templates.find(t => t.id === id);
    if (!tpl) return;
    if (tpl.format === 'json') {
      try { JSON.parse(tpl.body || ''); }
      catch (err) {
        const errEl = document.getElementById('tpl-json-error');
        if (errEl) errEl.textContent = 'Invalid JSON: ' + err.message;
        showToast('Body is not valid JSON', true);
        return;
      }
    }
    try {
      if (tpl.serverId) {
        await API.updateTemplate(tpl.serverId, tpl);
      } else {
        const result = await API.createTemplate(tpl);
        tpl.serverId = result.id || result.template?.id;
      }
      showToast('✅ Template saved');
    } catch (err) {
      showToast('Failed: ' + err.message, true);
    }
  },

  async deleteTemplate(id) {
    if (!confirm('Delete this template?')) return;
    const tpl = this._templates.find(t => t.id === id);
    if (tpl && tpl.serverId) {
      try {
        await API.deleteTemplate(tpl.serverId);
      } catch (err) {
        showToast('Failed to delete from server: ' + err.message, true);
      }
    }
    this._templates = this._templates.filter(t => t.id !== id);
    this._selectedId = this._templates[0]?.id || null;
    const state = window.state || {};
    this.render(state);
  },
};
// Expose module globally (const declarations do not auto-attach to window)
window.Templates = Templates;
