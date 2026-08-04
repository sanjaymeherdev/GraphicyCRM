// js/modules/api-keys.js
window.ApiKeys = (function () {
  let items = [];
  let loaded = false;

  async function render() {
    const panel = document.getElementById('tab-api-keys');
    if (!panel) return;
    if (!loaded) {
      panel.innerHTML = '<div class="empty-state"><p>Loading API keys…</p></div>';
      try {
        const res = await API.get('/api/api-keys');
        items = res.keys || [];
        loaded = true;
      } catch (err) {
        panel.innerHTML = `<div class="page-header"><div class="page-title">API Keys</div></div><div class="empty-state"><p>Failed to load: ${escapeHtml(err.message)}</p></div>`;
        return;
      }
    }
    draw(panel);
  }

  function draw(panel) {
    const rows = items.map((k) => `
      <tr>
        <td>${escapeHtml(k.name)}</td>
        <td><code>${escapeHtml(k.key_prefix)}…</code></td>
        <td>${k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'Never'}</td>
        <td>${k.revoked_at ? '<span class="status-badge status-cancelled">Revoked</span>' : '<span class="status-badge status-active">Active</span>'}</td>
        <td>${!k.revoked_at ? `<button class="btn btn-sm btn-danger" onclick="ApiKeys.revoke('${k.id}')">Revoke</button>` : ''}</td>
      </tr>
    `).join('');

    panel.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">API Keys</div><div class="page-sub">Let external scripts call this CRM's API with a key instead of a login (X-API-Key header)</div></div>
        <button class="btn btn-primary btn-sm" onclick="ApiKeys.openCreate()">+ New Key</button>
      </div>
      ${items.length ? `
        <table class="simple-table">
          <thead><tr><th>Name</th><th>Prefix</th><th>Last used</th><th>Status</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      ` : `<div class="empty-state"><div class="empty-icon">🔑</div><p>No API keys yet</p></div>`}
    `;
  }

  function openCreate() {
    openModal('New API Key', `
      <div class="crud-form">
        <div class="form-group"><label>Name</label><input id="apiKeyNameInput" type="text" placeholder="e.g. Zapier integration"/></div>
      </div>
    `, 'Create', async () => {
      const name = document.getElementById('apiKeyNameInput').value.trim();
      if (!name) return alert('Name is required');
      try {
        const res = await API.post('/api/api-keys', { name });
        reveal(res.apiKey);
        loaded = false;
        render();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  function reveal(apiKey) {
    // Shown once, in its own modal, right after the create modal closes —
    // this key is never retrievable again after this.
    setTimeout(() => {
      openModal('Your new API key', `
        <div class="crud-form">
          <p>Copy this now — it won't be shown again.</p>
          <input type="text" readonly value="${escapeHtml(apiKey)}" onclick="this.select()" style="width:100%;font-family:monospace;padding:8px;"/>
        </div>
      `, 'Done', () => {});
    }, 50);
  }

  async function revoke(id) {
    if (!confirm('Revoke this key? Anything using it will stop working immediately.')) return;
    try {
      await API.del(`/api/api-keys/${id}`);
      loaded = false;
      render();
    } catch (err) {
      alert(err.message);
    }
  }

  return { render, openCreate, revoke };
})();
