// js/modules/schedule.js - Content Scheduler (facebook/instagram/threads/linkedin)
const Schedule = {
  render(state) {
    const panel = document.getElementById('tab-schedule');

    panel.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Schedule</div><div class="page-sub">Plan and publish posts across your connected platforms</div></div>
        <button class="btn btn-primary" onclick="Schedule.newPost()">+ New Post</button>
      </div>
      <div class="filter-bar">
        <select id="scheduleStatusFilter" onchange="Schedule.applyFilters()">
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="scheduled">Scheduled</option>
          <option value="published">Published</option>
          <option value="partial">Partial</option>
          <option value="failed">Failed</option>
        </select>
        <select id="schedulePlatformFilter" onchange="Schedule.applyFilters()">
          <option value="">All platforms</option>
          ${PLATFORM_OPTIONS.map(p => `<option value="${p.value}">${p.label}</option>`).join('')}
        </select>
      </div>
      <div class="post-list" id="scheduleList"></div>
    `;

    this._posts = [];
    this.load();
  },

  _posts: [],

  async load() {
    const list = document.getElementById('scheduleList');
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">⏳</div><p>Loading posts…</p></div>`;
    try {
      const res = await API.getScheduledPosts();
      this._posts = res.posts || [];
    } catch (err) {
      this._posts = [];
    }
    this.applyFilters();
  },

  applyFilters() {
    const status = document.getElementById('scheduleStatusFilter')?.value || '';
    const platform = document.getElementById('schedulePlatformFilter')?.value || '';
    let filtered = this._posts;
    if (status) filtered = filtered.filter(p => p.status === status);
    if (platform) filtered = filtered.filter(p => (p.platforms || []).includes(platform));

    // Soonest scheduled first, drafts last, published most-recent-first within their group.
    filtered = [...filtered].sort((a, b) => {
      const rank = (p) => p.status === 'scheduled' ? 0 : p.status === 'draft' ? 2 : 1;
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      const at = a.scheduled_date || a.created_at;
      const bt = b.scheduled_date || b.created_at;
      return rank(a) === 0 ? new Date(at) - new Date(bt) : new Date(bt) - new Date(at);
    });

    this.renderList(filtered);
  },

  renderList(posts) {
    const list = document.getElementById('scheduleList');
    if (!posts.length) {
      list.innerHTML = `<div class="empty-state"><div class="empty-icon">🗓️</div><p>No posts yet. Schedule your first one!</p></div>`;
      return;
    }

    list.innerHTML = posts.map(p => `
      <div class="post-card" data-id="${p.id}">
        ${p.media_url ? `<div class="post-thumb"><img src="${escapeHtml(p.media_url)}" alt="" onerror="this.parentElement.style.display='none'" /></div>` : `<div class="post-thumb post-thumb-empty">📝</div>`}
        <div class="post-body">
          <div class="post-top">
            <div class="post-platforms">${(p.platforms || []).map(pl => `<span class="platform-chip" title="${pl}">${PLATFORM_ICON[pl] || '🔗'}</span>`).join('')}</div>
            <span class="badge badge-${POST_STATUS_BADGE[p.status] || 'gray'}">${p.status}</span>
          </div>
          <div class="post-caption">${escapeHtml(truncate(p.caption || '', 140)) || '<em>No caption</em>'}</div>
          <div class="post-meta">
            ${p.scheduled_date ? `<span><i class="fas fa-clock"></i> ${formatDateTime(p.scheduled_date)}</span>` : `<span><i class="fas fa-pen"></i> Draft</span>`}
            ${p.status === 'failed' || p.status === 'partial' ? `<span class="post-error" title="${escapeHtml(JSON.stringify(p.publish_errors || {}))}"><i class="fas fa-triangle-exclamation"></i> Error</span>` : ''}
          </div>
        </div>
        <div class="post-actions">
          <button class="btn btn-ghost btn-xs" onclick="Schedule.editPost('${p.id}')"><i class="fas fa-pen"></i></button>
          ${p.status !== 'published' ? `<button class="btn btn-secondary btn-xs" onclick="Schedule.publishNow('${p.id}')"><i class="fas fa-paper-plane"></i> Publish now</button>` : ''}
          <button class="btn btn-danger btn-xs" onclick="Schedule.deletePost('${p.id}')"><i class="fas fa-trash"></i></button>
        </div>
      </div>
    `).join('');
  },

  newPost() {
    this.openComposer(null);
  },

  editPost(id) {
    const post = this._posts.find(p => p.id === id);
    if (post) this.openComposer(post);
  },

  openComposer(post) {
    const isEdit = !!post;
    const p = post || { id: null, title: '', caption: '', hook: '', platforms: [], media_url: '', google_drive_file_id: '', scheduled_date: null, status: 'draft' };
    const dt = p.scheduled_date ? new Date(p.scheduled_date) : null;
    const dateVal = dt ? dt.toISOString().slice(0, 10) : '';
    const timeVal = dt ? dt.toTimeString().slice(0, 5) : '';

    const body = `
      <div class="field">
        <label>Title <span style="color:var(--text3);font-weight:400;">(internal only)</span></label>
        <input type="text" id="postTitle" value="${escapeHtml(p.title || '')}" placeholder="e.g. Launch teaser" />
      </div>
      <div class="field">
        <label>Platforms</label>
        <div class="platform-check-row">
          ${PLATFORM_OPTIONS.map(pl => `
            <label class="platform-check ${(p.platforms || []).includes(pl.value) ? 'checked' : ''}">
              <input type="checkbox" value="${pl.value}" ${(p.platforms || []).includes(pl.value) ? 'checked' : ''} onchange="Schedule.togglePlatformCheck(this)" />
              ${pl.label}
            </label>
          `).join('')}
        </div>
      </div>
      <div class="field">
        <label>Hook <span style="color:var(--text3);font-weight:400;">(optional opening line)</span></label>
        <input type="text" id="postHook" value="${escapeHtml(p.hook || '')}" placeholder="A scroll-stopping first line…" />
      </div>
      <div class="field">
        <label>Caption</label>
        <textarea id="postCaption" rows="4" placeholder="Write your post…">${escapeHtml(p.caption || '')}</textarea>
      </div>
      <div class="field">
        <label>Media <span style="color:var(--text3);font-weight:400;">(image/video — ignored for LinkedIn text-only posts, supported with media)</span></label>
        <div class="media-upload-row" style="display:flex;gap:8px;align-items:center;">
          <input type="text" id="postMediaUrl" value="${escapeHtml(p.media_url || '')}" placeholder="https://… or upload a file" style="flex:1;" oninput="Schedule.clearUploadedFileId()" />
          <label class="btn btn-secondary btn-xs" style="cursor:pointer;white-space:nowrap;margin:0;">
            <i class="fas fa-cloud-arrow-up"></i> Upload
            <input type="file" id="postMediaFile" accept="image/*,video/*" style="display:none;" onchange="Schedule.handleFileUpload(this)" />
          </label>
        </div>
        <input type="hidden" id="postDriveFileId" value="${escapeHtml(p.google_drive_file_id || '')}" />
        <div id="postUploadStatus" style="font-size:11.5px;color:var(--text2);margin-top:6px;"></div>
        <div id="postMediaPreview">${p.media_url ? `<img src="${escapeHtml(p.media_url)}" alt="" style="max-height:120px;border-radius:6px;margin-top:6px;" onerror="this.style.display='none'" />` : ''}</div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Date</label>
          <input type="date" id="postDate" value="${dateVal}" />
        </div>
        <div class="field">
          <label>Time</label>
          <input type="time" id="postTime" value="${timeVal}" />
        </div>
      </div>
      <p style="font-size:11.5px;color:var(--text2);margin-top:-4px;">Leave date/time empty to save as a draft. Set both to schedule it.</p>
    `;

    openModal(isEdit ? 'Edit post' : 'New post', body, isEdit ? 'Save changes' : 'Save post', () => this.savePost(p.id));
  },

  togglePlatformCheck(input) {
    input.closest('.platform-check').classList.toggle('checked', input.checked);
  },

  // Fires on file select in the composer's "Upload" button — uploads
  // straight to the shared owner Google Drive via POST /api/media/upload
  // (see modules/media/routes.js) and fills in the Media URL field with the
  // signed proxy link that comes back, so the rest of the form (and
  // publishPost on every platform) doesn't need to know the file came from
  // an upload rather than a pasted URL.
  async handleFileUpload(input) {
    const file = input.files?.[0];
    if (!file) return;

    const status = document.getElementById('postUploadStatus');
    const urlField = document.getElementById('postMediaUrl');
    const driveIdField = document.getElementById('postDriveFileId');
    const preview = document.getElementById('postMediaPreview');

    status.textContent = `Uploading ${file.name}… 0%`;
    input.disabled = true;

    try {
      const result = await API.uploadMedia(file, (pct) => {
        status.textContent = `Uploading ${file.name}… ${Math.round(pct * 100)}%`;
      });
      urlField.value = result.media_url || '';
      driveIdField.value = result.google_drive_file_id || '';
      status.textContent = `✅ Uploaded ${result.filename || file.name}`;
      if (preview) {
        preview.innerHTML = result.media_url
          ? `<img src="${escapeHtml(result.media_url)}" alt="" style="max-height:120px;border-radius:6px;margin-top:6px;" onerror="this.style.display='none'" />`
          : '';
      }
    } catch (err) {
      status.textContent = '';
      showToast('Upload failed: ' + err.message, true);
    } finally {
      input.disabled = false;
      input.value = ''; // allow re-selecting the same file later
    }
  },

  // A previously-uploaded file's Drive id is only valid for whatever URL is
  // currently in the Media URL field — if the person hand-edits that field
  // after uploading, the stale google_drive_file_id must be cleared so we
  // don't save a post whose media_url and google_drive_file_id point at two
  // different files.
  clearUploadedFileId() {
    const driveIdField = document.getElementById('postDriveFileId');
    if (driveIdField) driveIdField.value = '';
  },

  async savePost(id) {
    const title = document.getElementById('postTitle').value.trim();
    const hook = document.getElementById('postHook').value.trim();
    const caption = document.getElementById('postCaption').value.trim();
    const media_url = document.getElementById('postMediaUrl').value.trim();
    const google_drive_file_id = document.getElementById('postDriveFileId').value.trim() || null;
    const date = document.getElementById('postDate').value;
    const time = document.getElementById('postTime').value;
    const platforms = Array.from(document.querySelectorAll('.platform-check input:checked')).map(el => el.value);

    if (!caption) { showToast('Caption is required', true); return; }
    if (!platforms.length) { showToast('Select at least one platform', true); return; }

    const scheduled_date = (date && time) ? new Date(`${date}T${time}:00`).toISOString() : null;
    const status = scheduled_date ? 'scheduled' : 'draft';
    const payload = { title, hook, caption, media_url, google_drive_file_id, platforms, scheduled_date, status };

    try {
      if (id) {
        await API.updateScheduledPost(id, payload);
        showToast('✅ Post updated');
      } else {
        await API.createScheduledPost(payload);
        showToast('✅ Post saved');
      }
      this.load();
    } catch (err) {
      showToast('Failed: ' + err.message, true);
    }
  },

  async publishNow(id) {
    try {
      await API.publishPostNow(id);
      showToast('🚀 Publishing…');
      this.load();
    } catch (err) {
      showToast('Failed: ' + err.message, true);
    }
  },

  async deletePost(id) {
    if (!confirm('Delete this post?')) return;
    try {
      await API.deleteScheduledPost(id);
      this._posts = this._posts.filter(p => p.id !== id);
      this.applyFilters();
      showToast('🗑 Post deleted');
    } catch (err) {
      showToast('Failed to delete: ' + err.message, true);
    }
  },
};
// Expose module globally (const declarations do not auto-attach to window)
window.Schedule = Schedule;
