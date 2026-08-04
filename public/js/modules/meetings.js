// js/modules/meetings.js — booking list fed by the public /api/meetings/webhook/:token receiver
window.Meetings = (function () {
  let items = [];
  let loaded = false;

  async function render(state) {
    const panel = document.getElementById('tab-meetings');
    if (!panel) return;
    if (!loaded) {
      panel.innerHTML = '<div class="empty-state"><p>Loading meetings…</p></div>';
      try {
        const res = await API.get('/api/meetings');
        items = res.meetings || [];
        loaded = true;
      } catch (err) {
        panel.innerHTML = `<div class="page-header"><div class="page-title">Meetings</div></div><div class="empty-state"><p>Failed to load: ${escapeHtml(err.message)}</p></div>`;
        return;
      }
    }
    draw(panel, state);
  }

  function draw(panel, state) {
    const webhookUrl = state && state.webhookBase && state.webhookToken
      ? `${state.webhookBase}/api/meetings/webhook/${state.webhookToken}`
      : null;

    const rows = items.map((m) => `
      <tr>
        <td>${escapeHtml(m.title)}</td>
        <td>${escapeHtml(m.crm_leads?.name || m.attendee_name || '—')}</td>
        <td>${new Date(m.starts_at).toLocaleString()}</td>
        <td><span class="status-badge status-${escapeHtml(m.status)}">${escapeHtml(m.status)}</span></td>
      </tr>
    `).join('');

    panel.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Meetings</div><div class="page-sub">Bookings pushed in from your booking tool's webhook</div></div>
        <button class="btn btn-sm" onclick="Meetings.reload()"><i class="fas fa-rotate"></i> Refresh</button>
      </div>
      <div class="info-banner">
        Point your booking tool's webhook at your CRM's webhook URL (Settings → Webhook) with path
        <code>/api/meetings/webhook/&lt;your token&gt;</code>${webhookUrl ? ` — e.g. <code>${escapeHtml(webhookUrl)}</code>` : ''}.
        It expects JSON: <code>{ title, attendee_name, attendee_email, starts_at, ends_at, status, external_id }</code>.
      </div>
      ${items.length ? `
        <table class="simple-table">
          <thead><tr><th>Title</th><th>Attendee</th><th>When</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      ` : `<div class="empty-state"><div class="empty-icon">📅</div><p>No meetings yet</p></div>`}
    `;
  }

  function reload() { loaded = false; render(window.state || {}); }

  return { render, reload };
})();
