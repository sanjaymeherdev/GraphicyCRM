// js/modules/integrations.js
const Integrations = {
  render(state) {
    const panel = document.getElementById('tab-integrations');
    const integrations = [
      { id: 'calendly', name: 'Calendly', icon: '📅', desc: 'Sync bookings and meetings' },
      { id: 'manychat', name: 'Manychat', icon: '💬', desc: 'Connect Manychat flows' },
      { id: 'resend', name: 'Resend', icon: '📧', desc: 'Email delivery via Resend' },
      { id: 'webhook_builder', name: 'Webhook Builder', icon: '🔌', desc: 'Custom webhook endpoints' },
      { id: 'shopify', name: 'Shopify', icon: '🛍️', desc: 'Sync orders and customers' },
      { id: 'slack', name: 'Slack', icon: '💼', desc: 'Get notifications in Slack' },
    ];

    panel.innerHTML = `
      <div class="page-header"><div><div class="page-title">Integrations</div><div class="page-sub">Connect external apps and services</div></div></div>
      <div class="int-grid">
        ${integrations.map(i => `
          <div class="int-card">
            <div class="top"><span class="ic">${i.icon}</span><h3>${i.name}</h3></div>
            <p>${i.desc}</p>
            <div class="int-status">
              <span class="status-pill off">Not connected</span>
              <button class="btn btn-secondary btn-sm" onclick="Integrations.connect('${i.id}')">Connect</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  },

  async connect(id) {
    try {
      await API.connectIntegration(id);
      showToast(`✅ ${id} connected successfully`);
    } catch (err) {
      showToast('Demo: Integration would be connected', false);
      const cards = document.querySelectorAll('.int-card');
      cards.forEach(card => {
        if (card.textContent.includes(id)) {
          const status = card.querySelector('.status-pill');
          const btn = card.querySelector('.btn');
          if (status) {
            status.textContent = 'Connected';
            status.className = 'status-pill on';
          }
          if (btn) {
            btn.textContent = 'Manage';
            btn.className = 'btn btn-primary btn-sm';
          }
        }
      });
    }
  },
};
// Expose module globally (const declarations do not auto-attach to window)
window.Integrations = Integrations;
