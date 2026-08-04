// js/utils/simpleCrudTab.js — one reusable factory for the simple
// list+add/edit-modal tabs (flows, interactive templates, follow-up rules,
// field mappings, bot rules). Each module file just supplies a config
// (title, API base path, columns, form fields) instead of re-writing the
// same table/modal/save/delete plumbing seven times.
//
// Field types supported in a module's `fields` config:
//   text, textarea, number, checkbox,
//   select      { options: [{value,label}] }
//   tags        comma-separated -> array of strings (e.g. `channels`)
//   json        raw JSON textarea, parsed/stringified on save (e.g. `steps`, `config`)
function createSimpleCrudTab(config) {
  const { key, title, subtitle, apiBase, listKey, idField = 'id', columns, fields, emptyIcon = '🗂️', emptyText = 'Nothing here yet' } = config;

  return {
    _items: [],
    _loaded: false,
    _error: null,

    async render(state) {
      const panel = document.getElementById(`tab-${key}`);
      if (!panel) return;
      if (!this._loaded) {
        panel.innerHTML = `<div class="empty-state"><p>Loading ${escapeHtml(title)}…</p></div>`;
        try {
          const res = await API.get(apiBase);
          this._items = res[listKey] || [];
          this._loaded = true;
          this._error = null;
        } catch (err) {
          this._error = err.message;
        }
      }
      this._draw(panel);
    },

    reload() { this._loaded = false; this.render(window.state || {}); },

    _draw(panel) {
      if (this._error) {
        panel.innerHTML = `<div class="page-header"><div class="page-title">${escapeHtml(title)}</div></div><div class="empty-state"><p>Failed to load: ${escapeHtml(this._error)}</p></div>`;
        return;
      }
      const rows = this._items.map((item) => `
        <tr>
          ${columns.map((c) => `<td>${escapeHtml(c.render ? c.render(item) : String(item[c.key] ?? ''))}</td>`).join('')}
          <td class="row-actions">
            <button class="btn btn-sm" onclick="window.CrudTabs['${key}'].openForm('${item[idField]}')"><i class="fas fa-pen"></i></button>
            <button class="btn btn-sm btn-danger" onclick="window.CrudTabs['${key}'].remove('${item[idField]}')"><i class="fas fa-trash"></i></button>
          </td>
        </tr>
      `).join('');

      panel.innerHTML = `
        <div class="page-header">
          <div><div class="page-title">${escapeHtml(title)}</div><div class="page-sub">${escapeHtml(subtitle || '')}</div></div>
          <button class="btn btn-primary btn-sm" onclick="window.CrudTabs['${key}'].openForm(null)">+ New</button>
        </div>
        ${this._items.length ? `
          <table class="simple-table">
            <thead><tr>${columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('')}<th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        ` : `<div class="empty-state"><div class="empty-icon">${emptyIcon}</div><p>${escapeHtml(emptyText)}</p></div>`}
      `;
    },

    _fieldHtml(f, value) {
      const id = `crud-field-${f.name}`;
      const v = value === undefined || value === null ? '' : value;
      if (f.type === 'textarea' || f.type === 'json') {
        const text = f.type === 'json' ? (v ? JSON.stringify(v, null, 2) : (f.default || '')) : v;
        return `<div class="form-group"><label>${escapeHtml(f.label)}</label><textarea id="${id}" rows="${f.type === 'json' ? 6 : 3}" placeholder="${escapeHtml(f.placeholder || '')}">${escapeHtml(text)}</textarea></div>`;
      }
      if (f.type === 'select') {
        return `<div class="form-group"><label>${escapeHtml(f.label)}</label><select id="${id}">${f.options.map((o) => `<option value="${escapeHtml(o.value)}" ${o.value === v ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select></div>`;
      }
      if (f.type === 'checkbox') {
        return `<div class="form-group form-check"><label><input type="checkbox" id="${id}" ${v ? 'checked' : ''}/> ${escapeHtml(f.label)}</label></div>`;
      }
      if (f.type === 'tags') {
        return `<div class="form-group"><label>${escapeHtml(f.label)}</label><input id="${id}" type="text" placeholder="${escapeHtml(f.placeholder || 'comma,separated,values')}" value="${escapeHtml(Array.isArray(v) ? v.join(',') : v)}"/></div>`;
      }
      return `<div class="form-group"><label>${escapeHtml(f.label)}</label><input id="${id}" type="${f.type === 'number' ? 'number' : 'text'}" placeholder="${escapeHtml(f.placeholder || '')}" value="${escapeHtml(v)}"/></div>`;
    },

    _readField(f) {
      const el = document.getElementById(`crud-field-${f.name}`);
      if (!el) return undefined;
      if (f.type === 'checkbox') return el.checked;
      if (f.type === 'number') return el.value === '' ? null : Number(el.value);
      if (f.type === 'tags') return el.value.split(',').map((s) => s.trim()).filter(Boolean);
      if (f.type === 'json') {
        if (!el.value.trim()) return f.default ? JSON.parse(f.default) : (f.jsonType === 'array' ? [] : {});
        try { return JSON.parse(el.value); } catch { throw new Error(`${f.label} must be valid JSON`); }
      }
      return el.value;
    },

    openForm(id) {
      const item = id ? this._items.find((i) => String(i[idField]) === String(id)) : {};
      const bodyHTML = fields.map((f) => this._fieldHtml(f, item[f.name])).join('');
      openModal(id ? `Edit ${title}` : `New ${title}`, `<div class="crud-form">${bodyHTML}</div>`, id ? 'Save' : 'Create', async () => {
        try {
          const payload = {};
          for (const f of fields) payload[f.name] = this._readField(f);
          if (id) await API.put(`${apiBase}/${id}`, payload);
          else await API.post(apiBase, payload);
          this.reload();
        } catch (err) {
          alert(err.message);
        }
      });
    },

    async remove(id) {
      if (!confirm('Delete this? This can\'t be undone.')) return;
      try {
        await API.del(`${apiBase}/${id}`);
        this.reload();
      } catch (err) {
        alert(err.message);
      }
    },
  };
}
window.createSimpleCrudTab = createSimpleCrudTab;
window.CrudTabs = window.CrudTabs || {};
