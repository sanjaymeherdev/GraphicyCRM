// js/modules/dashboard.js
const Dashboard = {
  render(state) {
    const panel = document.getElementById('tab-dashboard');
    const stats = state.stats || { total: 0, converted: 0, lost: 0, pending: 0 };
    const leads = state.leads || [];

    const sourceCounts = {};
    ['whatsapp', 'instagram', 'facebook', 'webform', 'sheet', 'email'].forEach(s => {
      sourceCounts[s] = leads.filter(l => l.source === s).length;
    });
    const maxCount = Math.max(1, ...Object.values(sourceCounts));

    panel.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Dashboard</div><div class="page-sub">Overview of your pipeline</div></div>
        <button class="btn btn-primary btn-sm" onclick="navigateTo('leads')">View All Leads →</button>
      </div>
      <div class="stats-row">
        <div class="stat-card green"><div class="stat-label">Total Contacts</div><div class="stat-value">${stats.total || 0}</div></div>
        <div class="stat-card blue"><div class="stat-label">Converted</div><div class="stat-value">${stats.converted || 0}</div></div>
        <div class="stat-card red"><div class="stat-label">Lost</div><div class="stat-value">${stats.lost || 0}</div></div>
        <div class="stat-card amber"><div class="stat-label">Pending</div><div class="stat-value">${stats.pending || 0}</div></div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">📊 Leads by Source</div></div>
        <div style="height:200px;display:flex;align-items:flex-end;gap:16px;padding:10px 0;">
          ${Object.entries(sourceCounts).map(([source, count]) => {
            const pct = maxCount ? Math.round(count / maxCount * 100) : 0;
            const icon = SOURCE_ICON[source] || '🎯';
            return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
              <div style="width:100%;background:var(--surface2);border-radius:4px;height:160px;position:relative;overflow:hidden;">
                <div style="position:absolute;bottom:0;left:0;right:0;height:${pct}%;background:var(--primary);border-radius:4px 4px 0 0;transition:height 0.4s;"></div>
              </div>
              <span style="font-size:11px;color:var(--text2);">${icon} ${source}</span>
              <span style="font-size:12px;font-weight:600;">${count}</span>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">🔄 Recent Activity</div></div>
        <div id="recentActivity">
          ${leads.slice(0, 5).map(l => `
            <div class="data-row">
              <div><div class="data-row-title">${escapeHtml(l.name || 'Unnamed')}</div>
              <div class="data-row-sub">${getSourceIcon(l.source)} ${l.source} · ${l.status || 'new'} · ${timeAgo(l.updated_at)}</div></div>
              <span class="badge badge-${getStatusBadgeClass(l.status)}">${l.status || 'new'}</span>
            </div>
          `).join('') || '<div class="empty-state"><p>No recent activity</p></div>'}
        </div>
      </div>
    `;
  }
};
// Expose module globally (const declarations do not auto-attach to window)
window.Dashboard = Dashboard;
