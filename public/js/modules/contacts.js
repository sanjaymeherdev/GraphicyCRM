// js/modules/contacts.js
const Contacts = {
  render(state) {
    const panel = document.getElementById('tab-contacts');
    const contacts = state.contacts || [];

    panel.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Contacts</div><div class="page-sub">All contacts across all sources</div></div>
        <button class="btn btn-primary btn-sm" onclick="Contacts.openModal()">+ Add Contact</button>
      </div>
      <div class="card">
        <div class="filter-bar">
          <input type="text" id="contactSearch" placeholder="🔍 Search contacts..." oninput="Contacts.filter()" />
          <select id="contactSourceFilter" onchange="Contacts.filter()">
            <option value="">All sources</option>
            ${SOURCE_OPTIONS.map(s => `<option value="${s.value}">${s.label}</option>`).join('')}
          </select>
          <select id="contactStatusFilter" onchange="Contacts.filter()">
            <option value="">All statuses</option>
            ${STATUS_OPTIONS.map(s => `<option value="${s.value}">${s.label}</option>`).join('')}
          </select>
          <button class="btn btn-ghost btn-sm" onclick="Contacts.refresh()">↻ Refresh</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Source</th><th>Status</th><th>Last Activity</th><th></th></tr></thead>
            <tbody id="contactsTableBody"></tbody>
          </table>
        </div>
      </div>
    `;

    this._contacts = contacts;
    this.renderTable(contacts);
  },

  _contacts: [],

  renderTable(contacts) {
    const tbody = document.getElementById('contactsTableBody');
    if (!contacts.length) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">👤</div><p>No contacts yet.</p></div></td></tr>`;
      return;
    }
    tbody.innerHTML = contacts.map(c => `
      <tr class="clickable" onclick="Contacts.openDetail('${c.id}')">
        <td><div style="display:flex;align-items:center;gap:10px;">
          <div class="lead-avatar" style="width:32px;height:32px;font-size:12px;">${(c.name || '?').charAt(0).toUpperCase()}</div>
          <div><div style="font-weight:600;">${escapeHtml(c.name || 'Unnamed')}</div>
          <div style="font-size:11px;color:var(--text2);">${c.phone || c.email || ''}</div></div>
        </div></td>
        <td><span class="source-icon source-${c.source}">${getSourceIcon(c.source)}</span></td>
        <td><span class="badge badge-${getStatusBadgeClass(c.status)}">${c.status || 'new'}</span></td>
        <td>${timeAgo(c.updated_at)}</td>
        <td><button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();Contacts.openDetail('${c.id}')">View →</button></td>
      </tr>
    `).join('');
  },

  filter() {
    const q = document.getElementById('contactSearch')?.value?.toLowerCase() || '';
    const source = document.getElementById('contactSourceFilter')?.value || '';
    const status = document.getElementById('contactStatusFilter')?.value || '';
    let filtered = this._contacts || [];
    if (q) filtered = filtered.filter(c => (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q) || (c.email || '').toLowerCase().includes(q));
    if (source) filtered = filtered.filter(c => c.source === source);
    if (status) filtered = filtered.filter(c => c.status === status);
    this.renderTable(filtered);
  },

  async refresh() {
    try {
      const data = await API.getContacts();
      this._contacts = data.contacts || [];
      this.renderTable(this._contacts);
    } catch (err) {
      showToast('Failed to load contacts: ' + err.message, true);
    }
  },

  openModal() {
    openModal('Add Contact', `
      <div class="field"><label>Name</label><input type="text" id="modalContactName" /></div>
      <div class="field"><label>Phone</label><input type="tel" id="modalContactPhone" /></div>
      <div class="field"><label>Email</label><input type="email" id="modalContactEmail" /></div>
      <div class="field"><label>Source</label>
        <select id="modalContactSource">
          ${SOURCE_OPTIONS.map(s => `<option value="${s.value}">${s.label}</option>`).join('')}
        </select>
      </div>
    `, 'Add Contact', async () => {
      const name = document.getElementById('modalContactName').value.trim();
      const phone = document.getElementById('modalContactPhone').value.trim();
      const email = document.getElementById('modalContactEmail').value.trim();
      const source = document.getElementById('modalContactSource').value;
      if (!name) { showToast('Name is required', true); return; }
      try {
        await API.createContact({ name, phone, email, source });
        showToast('✅ Contact added');
        refreshAllData();
      } catch (err) {
        showToast('Failed: ' + err.message, true);
      }
    });
  },

  async openDetail(id) {
    const contact = this._contacts.find(c => c.id === id);
    if (!contact) return;
    openModal(`Contact: ${contact.name || 'Unnamed'}`, `
      <div style="display:flex;gap:12px;margin-bottom:12px;">
        <div class="lead-avatar" style="width:48px;height:48px;font-size:20px;">${(contact.name || '?').charAt(0).toUpperCase()}</div>
        <div>
          <div style="font-weight:700;font-size:16px;">${escapeHtml(contact.name || 'Unnamed')}</div>
          <div style="color:var(--text2);">${contact.phone || ''} ${contact.email ? '· ' + contact.email : ''}</div>
          <div style="margin-top:4px;"><span class="badge badge-${getStatusBadgeClass(contact.status)}">${contact.status || 'new'}</span></div>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--border);">
        <span class="source-icon source-${contact.source}">${getSourceIcon(contact.source)}</span>
        <span class="badge badge-gray">${timeAgo(contact.updated_at)}</span>
      </div>
    `, 'Close', closeModal);
  },
};
// Expose module globally (const declarations do not auto-attach to window)
window.Contacts = Contacts;
