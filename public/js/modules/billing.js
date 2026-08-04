// js/modules/billing.js
window.Billing = (function () {
  let sub = null;
  let loaded = false;

  async function render() {
    const panel = document.getElementById('tab-billing');
    if (!panel) return;
    if (!loaded) {
      panel.innerHTML = '<div class="empty-state"><p>Loading billing…</p></div>';
      try {
        const res = await API.get('/api/billing/subscription');
        sub = res.subscription;
        loaded = true;
      } catch (err) {
        panel.innerHTML = `<div class="page-header"><div class="page-title">Billing</div></div><div class="empty-state"><p>Failed to load: ${escapeHtml(err.message)}</p></div>`;
        return;
      }
    }
    draw(panel);
  }

  function draw(panel) {
    panel.innerHTML = `
      <div class="page-header"><div class="page-title">Billing</div></div>
      <div class="billing-card">
        <div class="billing-plan">${escapeHtml(sub.plan)}</div>
        <div class="billing-status">Status: <span class="status-badge status-${escapeHtml(sub.status)}">${escapeHtml(sub.status)}</span></div>
        ${sub.current_period_end ? `<div class="billing-period">Renews: ${new Date(sub.current_period_end).toLocaleDateString()}</div>` : ''}
        <div class="billing-actions">
          <select id="billingPlanSelect">
            <option value="starter">Starter</option>
            <option value="pro">Pro</option>
            <option value="enterprise">Enterprise</option>
          </select>
          <select id="billingProviderSelect">
            <option value="razorpay">Razorpay</option>
            <option value="stripe">Stripe</option>
            <option value="paypal">PayPal</option>
          </select>
          <button class="btn btn-primary btn-sm" onclick="Billing.checkout()">Upgrade</button>
        </div>
        <p class="billing-note">Payment provider isn't wired up yet on the backend (modules/billing/service.js#createCheckout is a documented TODO) — clicking Upgrade will show that message until a provider SDK is connected.</p>
      </div>
    `;
  }

  async function checkout() {
    const plan = document.getElementById('billingPlanSelect').value;
    const provider = document.getElementById('billingProviderSelect').value;
    try {
      const res = await API.post('/api/billing/checkout', { plan, provider });
      if (res.checkoutUrl) window.location.href = res.checkoutUrl;
    } catch (err) {
      alert(err.message);
    }
  }

  function reload() { loaded = false; render(); }

  return { render, reload, checkout };
})();
