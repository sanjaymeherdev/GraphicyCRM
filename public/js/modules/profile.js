// js/modules/profile.js
const Profile = {
  render(state) {
    const panel = document.getElementById('tab-profile');
    const u = state.user || { name: 'Sarah Mitchell', email: 'sarah@acmecorp.com', channels: ['WhatsApp', 'Instagram', 'Facebook'] };

    panel.innerHTML = `
      <div class="page-header"><div><div class="page-title">Profile</div><div class="page-sub">Your account settings</div></div></div>
      <div class="card" style="max-width:600px;">
        <div style="display:flex;gap:16px;margin-bottom:20px;">
          <div class="user-avatar-lg" style="width:64px;height:64px;font-size:28px;">${getInitials(u.name || 'U')}</div>
          <div><h3 style="font-size:18px;">${escapeHtml(u.name || 'User')}</h3>
          <div style="color:var(--text2);">${escapeHtml(u.email || '')}</div>
          <div style="margin-top:4px;"><span class="badge badge-green">● Active</span></div></div>
        </div>
        <div class="field"><label>Full Name</label><input type="text" id="profileName" value="${escapeHtml(u.name || '')}" /></div>
        <div class="field"><label>Email</label><input type="email" id="profileEmail" value="${escapeHtml(u.email || '')}" /></div>
        <div class="field"><label>New Password</label><input type="password" id="profilePassword" placeholder="Leave blank to keep current" /></div>
        <div class="field"><label>Connected Channels</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;padding:8px 0;">
            ${(u.channels || ['WhatsApp', 'Instagram', 'Facebook']).map(c => `<span class="badge badge-green">✅ ${escapeHtml(c)}</span>`).join('')}
          </div>
        </div>
        <button class="btn btn-primary" onclick="Profile.save()">💾 Save Profile</button>
      </div>
    `;
  },

  async save() {
    const name = document.getElementById('profileName')?.value.trim();
    const email = document.getElementById('profileEmail')?.value.trim();
    const password = document.getElementById('profilePassword')?.value;
    const body = { name, email };
    if (password) body.password = password;
    try {
      await API.updateProfile(body);
      showToast('✅ Profile updated');
      if (window.state) {
        window.state.user = { ...window.state.user, ...body };
      }
    } catch (err) {
      showToast('Saved locally (server not running)', false);
      if (window.state) {
        window.state.user = { ...window.state.user, ...body };
      }
    }
  },
};
// Expose module globally (const declarations do not auto-attach to window)
window.Profile = Profile;
