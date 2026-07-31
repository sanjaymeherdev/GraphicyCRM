// js/modules/reports.js
const Reports = {
  render(state) {
    const panel = document.getElementById('tab-reports');
    const leads = state.leads || [];

    panel.innerHTML = `
      <div class="page-header"><div><div class="page-title">Reports</div><div class="page-sub">Advanced analytics and filtering</div></div></div>
      <div class="card">
        <div class="filter-bar">
          <select id="reportSourceFilter" onchange="Reports.generate()">
            <option value="">All sources</option>
            ${SOURCE_OPTIONS.map(s => `<option value="${s.value}">${s.label}</option>`).join('')}
          </select>
          <select id="reportStatusFilter" onchange="Reports.generate()">
            <option value="">All statuses</option>
            ${STATUS_OPTIONS.map(s => `<option value="${s.value}">${s.label}</option>`).join('')}
          </select>
          <input type="date" id="reportDateFrom" onchange="Reports.generate()" />
          <input type="date" id="reportDateTo" onchange="Reports.generate()" />
          <button class="btn btn-primary btn-sm" onclick="Reports.generate()"><i class="fas fa-chart-bar"></i> Generate</button>
          <button class="btn btn-ghost btn-sm" onclick="Reports.reset()"><i class="fas fa-undo"></i> Reset</button>
        </div>
        <div id="reportResults">
          <div class="empty-state"><div class="empty-icon">📊</div><p>Apply filters to generate a report</p></div>
        </div>
      </div>
      <div class="grid-2">
        <div class="card">
          <div class="card-header"><div class="card-title">📈 Conversion Rate</div></div>
          <div id="conversionChart" style="height:200px;display:flex;align-items:flex-end;gap:12px;padding:10px 0;">
            ${Reports.renderConversionChart(leads)}
          </div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">📊 Source Distribution</div></div>
          <div id="sourceChart" style="display:flex;flex-wrap:wrap;gap:12px;padding:10px 0;">
            ${Reports.renderSourceChart(leads)}
          </div>
        </div>
      </div>
    `;
  },

  renderConversionChart(leads) {
    const total = leads.length || 1;
    const converted = leads.filter(l => l.status === 'converted' || l.status === 'won').length;
    const contacted = leads.filter(l => l.status === 'contacted' || l.status === 'engaged').length;
    const lost = leads.filter(l => l.status === 'lost' || l.status === 'cold').length;
    const pending = total - converted - contacted - lost;

    const data = [
      { label: 'Converted', value: converted, color: 'var(--green)' },
      { label: 'Contacted', value: contacted, color: 'var(--blue)' },
      { label: 'Pending', value: pending, color: 'var(--amber)' },
      { label: 'Lost', value: lost, color: 'var(--red)' },
    ];

    const maxVal = Math.max(1, ...data.map(d => d.value));

    return data.map(d => `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
        <div style="width:100%;background:var(--surface2);border-radius:4px;height:160px;position:relative;overflow:hidden;">
          <div style="position:absolute;bottom:0;left:0;right:0;height:${Math.round(d.value / maxVal * 100)}%;background:${d.color};border-radius:4px 4px 0 0;transition:height 0.4s;"></div>
        </div>
        <span style="font-size:11px;color:var(--text2);">${d.label}</span>
        <span style="font-size:12px;font-weight:600;">${d.value}</span>
      </div>
    `).join('');
  },

  renderSourceChart(leads) {
    const sources = {};
    leads.forEach(l => {
      sources[l.source] = (sources[l.source] || 0) + 1;
    });
    const total = leads.length || 1;
    const colors = ['var(--green)', 'var(--blue)', 'var(--purple)', 'var(--amber)', 'var(--pink)', 'var(--red)'];
    let idx = 0;

    return Object.entries(sources).map(([source, count]) => {
      const pct = Math.round(count / total * 100);
      const color = colors[idx++ % colors.length];
      return `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 12px;background:var(--surface2);border-radius:var(--radius-sm);flex:1;min-width:120px;">
          <span style="width:12px;height:12px;border-radius:50%;background:${color};flex-shrink:0;"></span>
          <span style="flex:1;font-size:12px;">${getSourceIcon(source)} ${source}</span>
          <span style="font-weight:600;font-size:13px;">${count} (${pct}%)</span>
        </div>
      `;
    }).join('') || '<div class="empty-state"><p>No data available</p></div>';
  },

  generate() {
    const el = document.getElementById('reportResults');
    const leads = window.state?.leads || [];
    const source = document.getElementById('reportSourceFilter')?.value || '';
    const status = document.getElementById('reportStatusFilter')?.value || '';
    const from = document.getElementById('reportDateFrom')?.value;
    const to = document.getElementById('reportDateTo')?.value;

    let filtered = leads;
    if (source) filtered = filtered.filter(l => l.source === source);
    if (status) filtered = filtered.filter(l => l.status === status);
    if (from) filtered = filtered.filter(l => l.created_at && l.created_at >= from);
    if (to) filtered = filtered.filter(l => l.created_at && l.created_at <= to);

    if (!filtered.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">📊</div><p>No results found for the selected filters</p></div>`;
      return;
    }

    el.innerHTML = `
      <div style="margin-bottom:12px;font-weight:600;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <span>${filtered.length} results found</span>
        <span style="font-size:12px;color:var(--text2);">${source ? 'Source: ' + source : ''} ${status ? '· Status: ' + status : ''}</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Source</th><th>Status</th><th>Created</th><th>Notes</th></tr></thead>
          <tbody>
            ${filtered.map(l => `
              <tr>
                <td><strong>${escapeHtml(l.name || 'Unnamed')}</strong></td>
                <td><span class="source-icon source-${l.source}">${getSourceIcon(l.source)}</span></td>
                <td><span class="badge badge-${getStatusBadgeClass(l.status)}">${l.status || 'new'}</span></td>
                <td>${l.created_at ? formatDate(l.created_at) : '—'}</td>
                <td style="font-size:12px;color:var(--text2);">${escapeHtml(truncate(l.notes || '', 40))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  reset() {
    const selects = document.querySelectorAll('#reportSourceFilter, #reportStatusFilter');
    selects.forEach(s => s.value = '');
    const dates = document.querySelectorAll('#reportDateFrom, #reportDateTo');
    dates.forEach(d => d.value = '');
    this.generate();
  },
};
// Expose module globally (const declarations do not auto-attach to window)
window.Reports = Reports;
