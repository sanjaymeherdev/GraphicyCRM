// js/modules/sources.js
const Sources = {
  render(state) {
    const panel = document.getElementById('tab-sources');
    panel.innerHTML = `
      <div class="page-header"><div><div class="page-title">Sources</div><div class="page-sub">Connect where leads come from</div></div></div>
      <div class="conn-methods">
        <div class="conn-card">
          <div class="m-head"><span class="badge-ic">📱</span><h3>WhatsApp</h3></div>
          <p class="m-desc">Connect with System User Token and WABA ID</p>
          <div class="field"><label>WABA ID</label><input type="text" id="wabaId" placeholder="e.g. 123456789" /></div>
          <div class="field"><label>Access Token</label><input type="text" id="wabaToken" placeholder="Permanent access token" /></div>
          <button class="btn btn-primary" style="width:100%;justify-content:center;" onclick="Sources.connectWhatsApp()">Connect</button>
          <div id="wabaNumbers" style="margin-top:10px;"></div>
        </div>
        <div class="conn-card">
          <div class="m-head"><span class="badge-ic">📷</span><h3>Instagram</h3></div>
          <p class="m-desc">Connect via Meta OAuth</p>
          <button class="btn btn-secondary" style="width:100%;justify-content:center;" onclick="Sources.connectInstagram()">Connect with Instagram</button>
        </div>
        <div class="conn-card">
          <div class="m-head"><span class="badge-ic">👥</span><h3>Facebook</h3></div>
          <p class="m-desc">Connect via Meta OAuth</p>
          <button class="btn btn-secondary" style="width:100%;justify-content:center;" onclick="Sources.connectFacebook()">Connect with Facebook</button>
        </div>
        <div class="conn-card">
          <div class="m-head"><span class="badge-ic">📧</span><h3>Gmail</h3></div>
          <p class="m-desc">Connect via Google OAuth</p>
          <button class="btn btn-secondary" style="width:100%;justify-content:center;" onclick="Sources.connectGoogle()">Connect with Google</button>
        </div>
        <div class="conn-card">
          <div class="m-head"><span class="badge-ic">📊</span><h3>Google Sheets</h3></div>
          <p class="m-desc">Connect via Google OAuth</p>
          <button class="btn btn-secondary" style="width:100%;justify-content:center;" onclick="Sources.connectGoogle()">Connect with Google</button>
        </div>
        <div class="conn-card">
          <div class="m-head"><span class="badge-ic">📝</span><h3>Webhook / Web Form</h3></div>
          <p class="m-desc">Point any form builder at this URL</p>
          <div class="webhook-url-box" id="webhookUrlBox">Connect to generate URL</div>
          <button class="btn btn-secondary" style="margin-top:10px;width:100%;justify-content:center;" onclick="Sources.generateWebhook()">Generate Webhook URL</button>
        </div>
        <div class="conn-card">
          <div class="m-head"><span class="badge-ic">📅</span><h3>Calendar / smbooking</h3></div>
          <p class="m-desc">Sync scheduled meetings</p>
          <button class="btn btn-secondary" style="width:100%;justify-content:center;" onclick="Sources.connectCalendar()">Connect</button>
        </div>
      </div>
    `;
  },

  async connectWhatsApp() {
    const wabaId = document.getElementById('wabaId').value.trim();
    const token = document.getElementById('wabaToken').value.trim();
    if (!wabaId || !token) { showToast('Please enter WABA ID and token', true); return; }
    try {
      const data = await API.verifyWhatsApp(wabaId, token);
      if (data.numbers && data.numbers.length) {
        const container = document.getElementById('wabaNumbers');
        container.innerHTML = data.numbers.map((n, i) => `
          <div class="num-pick" onclick="Sources.selectNumber(${i})" data-i="${i}">
            <div><div class="n-name">${escapeHtml(n.display_name || n.phone_number)}</div>
            <div class="n-phone">${escapeHtml(n.phone_number)}</div></div>
            <span class="badge badge-green">${escapeHtml(n.quality_rating || '—')}</span>
          </div>
        `).join('');
        window._wabaNumbers = data.numbers;
        showToast('✅ Numbers loaded, click one to connect');
      } else {
        showToast('No numbers found under this WABA', true);
      }
    } catch (err) {
      showToast('Failed: ' + err.message, true);
    }
  },

  selectNumber(idx) {
    const nums = window._wabaNumbers || [];
    if (!nums[idx]) return;
    document.querySelectorAll('.num-pick').forEach(el => el.classList.remove('sel'));
    document.querySelector(`.num-pick[data-i="${idx}"]`)?.classList.add('sel');
    window._selectedNumber = nums[idx];
    showToast(`Selected ${nums[idx].phone_number}`);
  },

  async connectInstagram() {
    try {
      const data = await API.getOAuthUrl('instagram');
      window.location.href = data.url;
    } catch (err) {
      showToast('Failed: ' + err.message, true);
    }
  },

  async connectFacebook() {
    try {
      const data = await API.getOAuthUrl('facebook');
      window.location.href = data.url;
    } catch (err) {
      showToast('Failed: ' + err.message, true);
    }
  },

  async connectGoogle() {
    try {
      const data = await API.getOAuthUrl('google');
      window.location.href = data.url;
    } catch (err) {
      showToast('Failed: ' + err.message, true);
    }
  },

  async generateWebhook() {
    try {
      const data = await API.generateWebhook();
      document.getElementById('webhookUrlBox').textContent = data.url;
      showToast('✅ Webhook URL generated');
    } catch (err) {
      showToast('Failed: ' + err.message, true);
    }
  },

  async connectCalendar() {
    try {
      await API.connectIntegration('calendar');
      showToast('✅ Connected to calendar');
    } catch (err) {
      showToast('Failed: ' + err.message, true);
    }
  },
};
// Expose module globally (const declarations do not auto-attach to window)
window.Sources = Sources;
