// js/modules/leads.js
const Leads = {
  render(state) {
    const panel = document.getElementById('tab-leads');
    const leads = state.leads || [];
    const stats = { all: leads.length, new: 0, contacted: 0, engaged: 0, converted: 0, lost: 0 };
    leads.forEach(l => { if (stats[l.status] !== undefined) stats[l.status]++; });

    panel.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Leads</div><div class="page-sub">Manage your pipeline</div></div>
        <button class="btn btn-primary btn-sm" onclick="Leads.openModal()">+ Add Lead</button>
      </div>
      <div class="stats-row">
        <div class="stat-card blue" onclick="Leads.filter('')"><div class="stat-label">All</div><div class="stat-value">${stats.all}</div></div>
        <div class="stat-card amber" onclick="Leads.filter('new')"><div class="stat-label">New</div><div class="stat-value">${stats.new}</div></div>
        <div class="stat-card purple" onclick="Leads.filter('contacted')"><div class="stat-label">Contacted</div><div class="stat-value">${stats.contacted}</div></div>
        <div class="stat-card pink" onclick="Leads.filter('engaged')"><div class="stat-label">Engaged</div><div class="stat-value">${stats.engaged}</div></div>
        <div class="stat-card green" onclick="Leads.filter('converted')"><div class="stat-label">Converted</div><div class="stat-value">${stats.converted}</div></div>
        <div class="stat-card red" onclick="Leads.filter('lost')"><div class="stat-label">Lost</div><div class="stat-value">${stats.lost}</div></div>
      </div>
      <div class="card">
        <div class="filter-bar">
          <input type="text" id="leadSearch" placeholder="🔍 Search..." oninput="Leads.filter()" />
          <select id="leadSourceFilter" onchange="Leads.filter()">
            <option value="">All sources</option>
            ${SOURCE_OPTIONS.map(s => `<option value="${s.value}">${s.label}</option>`).join('')}
          </select>
          <select id="leadStatusFilter" onchange="Leads.filter()">
            <option value="">All statuses</option>
            ${STATUS_OPTIONS.map(s => `<option value="${s.value}">${s.label}</option>`).join('')}
          </select>
          <button class="btn btn-ghost btn-sm" onclick="Leads.refresh()">↻ Refresh</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Lead</th><th>Source</th><th>Status</th><th>Last Activity</th><th></th></tr></thead>
            <tbody id="leadsTableBody"></tbody>
          </table>
        </div>
      </div>
    `;

    this._leads = leads;
    this.renderTable(leads);
  },

  _leads: [],

  renderTable(leads) {
    const tbody = document.getElementById('leadsTableBody');
    if (!leads.length) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">🎯</div><p>No leads yet.</p></div></td></tr>`;
      return;
    }
    tbody.innerHTML = leads.map(l => `
      <tr class="clickable" onclick="Leads.openDetail('${l.id}')">
        <td><div style="display:flex;align-items:center;gap:10px;">
          <div class="lead-avatar">${((l.name || l.account_name || '?').charAt(0).toUpperCase())}</div>
          <div><div style="font-weight:600;">${escapeHtml(l.name || l.account_name || 'Unnamed')}</div>
          <div style="font-size:11px;color:var(--text2);">${[l.phone, l.whatsapp, l.email].filter(Boolean).join(' • ') || ''}</div></div>
        </div></td>
        <td><span class="source-icon source-${l.source}">${getSourceIcon(l.source)}</span></td>
        <td><span class="badge badge-${getStatusBadgeClass(l.status)}">${l.status || 'new'}</span></td>
        <td>${timeAgo(l.updated_at)}</td>
        <td><button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();Leads.openDetail('${l.id}')">View →</button></td>
      </tr>
    `).join('');
  },

  filter(status) {
    if (status !== undefined) {
      const sel = document.getElementById('leadStatusFilter');
      if (sel) sel.value = status;
    }
    const q = document.getElementById('leadSearch')?.value?.toLowerCase() || '';
    const source = document.getElementById('leadSourceFilter')?.value || '';
    const statusVal = document.getElementById('leadStatusFilter')?.value || '';
    let filtered = this._leads || [];
    if (q) filtered = filtered.filter(l => (l.name || '').toLowerCase().includes(q) || (l.phone || '').includes(q) || (l.email || '').toLowerCase().includes(q));
    if (source) filtered = filtered.filter(l => l.source === source);
    if (statusVal) filtered = filtered.filter(l => l.status === statusVal);
    this.renderTable(filtered);
  },

  async refresh() {
    const data = await API.getLeads();
    this._leads = data.leads || [];
    this.renderTable(this._leads);
  },

  openModal() {
    openModal('Add Lead', `
      <div class="field"><label>Name</label><input type="text" id="modalLeadName" /></div>
      <div class="field"><label>Phone</label><input type="tel" id="modalLeadPhone" /></div>
      <div class="field"><label>Email</label><input type="email" id="modalLeadEmail" /></div>
      <div class="field"><label>Source</label>
        <select id="modalLeadSource">
          ${SOURCE_OPTIONS.map(s => `<option value="${s.value}">${s.label}</option>`).join('')}
        </select>
      </div>
    `, 'Add Lead', async () => {
      const name = document.getElementById('modalLeadName').value.trim();
      const phone = document.getElementById('modalLeadPhone').value.trim();
      const email = document.getElementById('modalLeadEmail').value.trim();
      const source = document.getElementById('modalLeadSource').value;
      if (!name) { showToast('Name is required', true); return; }
      try {
        await API.createLead({ name, phone, email, source });
        showToast('✅ Lead added');
        refreshAllData();
      } catch (err) {
        showToast('Failed: ' + err.message, true);
      }
    });
  },

  async openDetail(id) {
    const lead = this._leads.find(l => l.id === id);
    if (!lead) return;
    openModal(`Lead: ${lead.name || lead.account_name || 'Unnamed'}`, `
      <div style="display:flex;gap:12px;margin-bottom:12px;">
        <div class="lead-avatar" style="width:48px;height:48px;font-size:20px;">${((lead.name || lead.account_name || '?').charAt(0).toUpperCase())}</div>
        <div>
          <div style="font-weight:700;font-size:16px;">${escapeHtml(lead.name || lead.account_name || 'Unnamed')}</div>
          <div style="color:var(--text2);">${[lead.phone, lead.whatsapp, lead.email].filter(Boolean).join(' • ')}</div>
          <div style="margin-top:4px;"><span class="badge badge-${getStatusBadgeClass(lead.status)}">${lead.status || 'new'}</span></div>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--border);">
        <span class="source-icon source-${lead.source}">${getSourceIcon(lead.source)}</span>
        <span class="badge badge-gray">${timeAgo(lead.updated_at)}</span>
      </div>
      <div class="field"><label>Saved name</label><input id="leadName" value="${escapeHtml(lead.name || '')}" /></div>
      <div class="field"><label>Account name / fallback</label><input id="leadAccountName" value="${escapeHtml(lead.account_name || '')}" /></div>
      <div class="field"><label>Phone</label><input id="leadPhone" value="${escapeHtml(lead.phone || '')}" /></div>
      <div class="field"><label>WhatsApp</label><input id="leadWhatsapp" value="${escapeHtml(lead.whatsapp || '')}" /></div>
      <div class="field"><label>Instagram</label><input id="leadInstagram" value="${escapeHtml(lead.instagram || '')}" /></div>
      <div class="field"><label>Facebook</label><input id="leadFacebook" value="${escapeHtml(lead.facebook || '')}" /></div>
      <div class="field"><label>Email</label><input id="leadEmail" value="${escapeHtml(lead.email || '')}" /></div>
      <div class="field"><label>Status</label><select id="leadStatus">
        ${STATUS_OPTIONS.map(s => `<option value="${s.value}" ${lead.status === s.value ? 'selected' : ''}>${s.label}</option>`).join('')}
      </select></div>
      <div class="field"><label>Notes</label><textarea rows="3" id="leadNotes">${escapeHtml(lead.notes || '')}</textarea></div>
      <div style="font-size:12px;color:var(--text2);margin-top:6px;">If no saved name exists, the account name is used as the fallback label for this lead.</div>
    `, 'Save', async () => {
      const payload = {
        name: document.getElementById('leadName').value.trim(),
        account_name: document.getElementById('leadAccountName').value.trim(),
        phone: document.getElementById('leadPhone').value.trim(),
        whatsapp: document.getElementById('leadWhatsapp').value.trim(),
        instagram: document.getElementById('leadInstagram').value.trim(),
        facebook: document.getElementById('leadFacebook').value.trim(),
        email: document.getElementById('leadEmail').value.trim(),
        status: document.getElementById('leadStatus').value,
        notes: document.getElementById('leadNotes').value,
      };
      try {
        await API.updateLead(id, payload);
        showToast('✅ Lead updated');
        refreshAllData();
      } catch (err) {
        showToast('Failed: ' + err.message, true);
      }
    });
  },
};
// Expose module globally (const declarations do not auto-attach to window)
window.Leads = Leads;
