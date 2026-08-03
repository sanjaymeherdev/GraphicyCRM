// js/modules/inbox.js
// Free-form WhatsApp replies are only deliverable within Meta's 24h customer
// service window. This mirrors modules/whatsapp/service.js's REPLY_WINDOW_HOURS
// (22h, a safety margin under Meta's 24h limit) so the UI stops offering the
// option before the server would reject it — server-side enforcement in
// whatsapp/service.js's assertWithinReplyWindow is still the real guard, this
// is just so the user isn't typing into a box that's guaranteed to fail.
const WHATSAPP_REPLY_WINDOW_HOURS = 22;

const Inbox = {
  render(state) {
    const panel = document.getElementById('tab-inbox');
    const threads = state.inbox || [];

    panel.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Inbox</div><div class="page-sub">Unified conversations across all channels</div></div>
        <button class="btn btn-ghost btn-sm" onclick="Inbox.refresh()">↻ Refresh</button>
      </div>
      <div class="card" style="padding:0;overflow:hidden;">
        <div class="seg" id="inboxTabSeg" style="margin:12px 12px 0;">
          <button class="${this._activeChannel === '' ? 'on' : ''}" data-channel="" onclick="Inbox.setChannelTab('')">All</button>
          <button class="${this._activeChannel === 'whatsapp' ? 'on' : ''}" data-channel="whatsapp" onclick="Inbox.setChannelTab('whatsapp')"><img src="/images/whatsapp.png" alt="WhatsApp" class="channel-option-icon" /> WhatsApp</button>
          <button class="${this._activeChannel === 'instagram' ? 'on' : ''}" data-channel="instagram" onclick="Inbox.setChannelTab('instagram')"><img src="/images/instagram.png" alt="Instagram" class="channel-option-icon" /> IG</button>
          <button class="${this._activeChannel === 'facebook' ? 'on' : ''}" data-channel="facebook" onclick="Inbox.setChannelTab('facebook')"><img src="/images/facebook.png" alt="Facebook" class="channel-option-icon" /> FB</button>
          <button class="${this._activeChannel === 'email' ? 'on' : ''}" data-channel="email" onclick="Inbox.setChannelTab('email')"><img src="/images/gmail.png" alt="Email" class="channel-option-icon" /> Email</button>
        </div>
        <div class="inbox-layout">
          <div class="inbox-list-pane">
            <div class="inbox-list-toolbar">
              <input type="text" id="inboxSearch" placeholder="🔍 Search..." oninput="Inbox.filter()" />
            </div>
            <div class="inbox-thread-list" id="inboxThreadList"></div>
          </div>
          <div class="inbox-thread-pane" id="inboxThreadPane">
            <div class="empty-state" style="margin:auto;"><div class="empty-icon">📥</div><p>Select a conversation to view.</p></div>
          </div>
        </div>
      </div>
    `;

    this._threads = threads;
    this.renderThreads(threads);
  },

  _threads: [],
  _currentId: null,
  _activeChannel: '',

  renderThreads(threads) {
    const list = document.getElementById('inboxThreadList');
    if (!threads || !threads.length) {
      list.innerHTML = '<div class="empty-state"><div class="empty-icon">📥</div><p>No conversations yet.</p></div>';
      return;
    }
    list.innerHTML = threads.map(t => `
      <div class="inbox-thread-item ${t.id === this._currentId ? 'active' : ''}" data-id="${t.id}" onclick="Inbox.openThread('${t.id}')">
        <div class="lead-avatar">${(t.name || '?').charAt(0).toUpperCase()}</div>
        <div style="flex:1;min-width:0;">
          <div class="inbox-thread-top">
            <div class="inbox-thread-name">${escapeHtml(t.name || t.phone || 'Unnamed')}</div>
            <div class="inbox-thread-time">${timeAgo(t.last_message_at)}</div>
          </div>
          <div class="inbox-thread-preview">${escapeHtml(truncate(t.last_message || '', 50))}</div>
        </div>
        <div class="inbox-thread-meta">
          <span class="source-icon inbox-channel-icon source-${t.channel}" title="${t.channel}">${getSourceIcon(t.channel)}</span>
          ${t.needs_reply ? '<div class="inbox-needs-reply-dot"></div>' : ''}
        </div>
      </div>
    `).join('');
  },

  filter() {
    const q = document.getElementById('inboxSearch')?.value?.toLowerCase() || '';
    const channel = this._activeChannel || '';
    let filtered = this._threads || [];
    if (q) filtered = filtered.filter(t => (t.name || '').toLowerCase().includes(q) || (t.last_message || '').toLowerCase().includes(q));
    if (channel) filtered = filtered.filter(t => t.channel === channel);
    this.renderThreads(filtered);
  },

  setChannelTab(channel) {
    this._activeChannel = channel;
    document.querySelectorAll('#inboxTabSeg button').forEach(btn => {
      btn.classList.toggle('on', btn.dataset.channel === channel);
    });
    this.filter();
  },

  async openThread(id) {
    this._currentId = id;
    const thread = this._threads.find(t => t.id === id);
    const pane = document.getElementById('inboxThreadPane');
    if (!thread) {
      pane.innerHTML = '<div class="empty-state"><p>Thread not found</p></div>';
      return;
    }

    document.querySelectorAll('.inbox-thread-item').forEach(el => el.classList.toggle('active', el.dataset.id === id));
    this.renderThreads(this._threads);

    try {
      const data = await API.getLeadMessages(id);
      const messages = data.messages || [];

      // WhatsApp only: once 22h have passed since the contact's last inbound
      // message, disable the free-form reply box entirely instead of letting
      // the user type a reply that the server will reject anyway.
      const channel = thread.channel || 'whatsapp';
      const lastInbound = [...messages].reverse().find(m => m.direction === 'in' && m.channel === 'whatsapp');
      const hoursSinceInbound = lastInbound ? (Date.now() - new Date(lastInbound.created_at).getTime()) / 3600000 : null;
      const replyWindowClosed = channel === 'whatsapp' && (hoursSinceInbound === null || hoursSinceInbound > WHATSAPP_REPLY_WINDOW_HOURS);

      const lastInboundMessage = [...messages].reverse().find(m => m.direction === 'in');
      const replyContext = lastInboundMessage?.message_type === 'comment'
        ? 'Comment reply'
        : (lastInboundMessage?.channel === 'instagram' || lastInboundMessage?.channel === 'facebook')
          ? 'DM reply'
          : 'Reply';

      pane.innerHTML = `
        <div class="inbox-thread-header">
          <div style="display:flex;align-items:center;gap:12px;">
            <div class="lead-avatar" style="width:40px;height:40px;font-size:16px;">${(thread.name || '?').charAt(0).toUpperCase()}</div>
            <div><div style="font-weight:700;font-size:15px;">${escapeHtml(thread.name || 'Unnamed')}</div>
            <div style="font-size:12px;color:var(--text2);">${thread.phone || thread.email || ''}</div></div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="navigateTo('leads')">View Lead →</button>
        </div>
        <div class="inbox-thread-body" id="inboxThreadMessages">
          ${messages.map(m => `
            <div class="msg-bubble msg-${m.direction}">
              <div class="inbox-msg-channel-tag" style="display:flex;align-items:center;gap:6px;">
                <span class="source-icon source-${m.channel}" style="width:16px;height:16px;border-radius:4px;">${getSourceIcon(m.channel) || ''}</span>
                <span>${m.channel}</span>
              </div>
              <div class="inbox-msg-kind">${m.message_type === 'comment' ? 'Comment' : 'DM'}</div>
              ${escapeHtml(m.body)}
              <div class="msg-time">${timeAgo(m.created_at)}</div>
            </div>
          `).join('') || '<div class="empty-state"><p>No messages</p></div>'}
        </div>
        ${replyWindowClosed ? `
        <div class="inbox-reply-bar inbox-reply-closed">
          <div class="empty-state" style="margin:0;padding:10px 4px;">
            <p>⏳ 24h reply window closed — WhatsApp only allows free-form replies within 24h of the contact's last message${hoursSinceInbound !== null ? ` (last message was ${hoursSinceInbound.toFixed(1)}h ago)` : ''}. Send an approved template to reach out again.</p>
          </div>
        </div>
        ` : `
        <div class="inbox-reply-bar">
          <div class="inbox-reply-meta">
            <div class="inbox-reply-context">${escapeHtml(replyContext)}</div>
            <select id="inboxReplyChannel">
              ${CHANNEL_OPTIONS.map(c => `<option value="${c.value}" ${c.value === (thread.channel || 'whatsapp') ? 'selected' : ''}>${c.label}</option>`).join('')}
            </select>
          </div>
          <select id="inboxReplyType" class="inbox-reply-type">
            <option value="dm">DM</option>
            <option value="comment">Comment</option>
          </select>
          <textarea id="inboxReplyBox" placeholder="Type a reply..." rows="1"></textarea>
          <button class="btn btn-primary btn-sm" onclick="Inbox.sendReply('${id}')">Send</button>
        </div>
        `}
      `;
    } catch (err) {
      pane.innerHTML = `<div class="empty-state"><p>Failed to load messages: ${err.message}</p></div>`;
    }
  },

  async sendReply(id) {
    const box = document.getElementById('inboxReplyBox');
    const channel = document.getElementById('inboxReplyChannel').value;
    const replyType = document.getElementById('inboxReplyType')?.value || 'dm';
    const body = box.value.trim();
    if (!body) return;
    try {
      const lastInboundMessage = [...(this._threads.find(t => t.id === id)?.messages || [])].reverse().find(m => m.direction === 'in');
      await API.sendMessage(id, { channel, body, replyType, replyToExternalId: lastInboundMessage?.external_id || null });
      box.value = '';
      showToast('✅ Reply sent');
      this.openThread(id);
      this.refresh();
    } catch (err) {
      showToast('Failed: ' + err.message, true);
    }
  },

  async refresh() {
    const data = await API.getInbox();
    this._threads = data.threads || [];
    this.renderThreads(this._threads);
    if (this._currentId) this.openThread(this._currentId);
  },
};
// Expose module globally (const declarations do not auto-attach to window)
window.Inbox = Inbox;
