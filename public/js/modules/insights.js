// js/modules/insights.js - Platform analytics (facebook/instagram/threads)
const Insights = {
  _platform: 'instagram',

  render(state) {
    const panel = document.getElementById('tab-insights');

    panel.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Insights</div><div class="page-sub">Follower growth, engagement, and top posts</div></div>
      </div>
      <div class="seg" id="insightsPlatformSeg">
        ${INSIGHTS_PLATFORM_OPTIONS.map(p => `<button class="${p.value === this._platform ? 'on' : ''}" onclick="Insights.setPlatform('${p.value}')">${p.label}</button>`).join('')}
      </div>
      <div id="insightsStats" class="stats-row"></div>
      <div class="card">
        <div class="card-header"><div class="card-title">📈 Trend (last 7 snapshots)</div></div>
        <div id="insightsTrendChart" style="height:200px;display:flex;align-items:flex-end;gap:10px;padding:10px 0;"></div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">🏆 Top posts</div></div>
        <div id="insightsPostsTable"></div>
      </div>
    `;

    this.load();
  },

  setPlatform(platform) {
    this._platform = platform;
    this.load();
  },

  async load() {
    const statsEl = document.getElementById('insightsStats');
    const chartEl = document.getElementById('insightsTrendChart');
    const postsEl = document.getElementById('insightsPostsTable');
    statsEl.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><p>Loading…</p></div>`;
    chartEl.innerHTML = '';
    postsEl.innerHTML = '';

    // Re-highlight the active platform tab (setPlatform's class toggle above is a
    // best-effort match on label text; this guarantees it's correct after a render).
    document.querySelectorAll('#insightsPlatformSeg button').forEach((btn, i) => {
      btn.classList.toggle('on', INSIGHTS_PLATFORM_OPTIONS[i].value === this._platform);
      btn.setAttribute('onclick', `Insights.setPlatform('${INSIGHTS_PLATFORM_OPTIONS[i].value}')`);
    });

    try {
      const [account, snapshots, posts] = await Promise.all([
        API.getAccountInsights(this._platform),
        API.getInsightsSnapshots(this._platform),
        API.getPostInsights(this._platform),
      ]);
      this.renderStats(account.data || {});
      this.renderTrend(snapshots.snapshots || []);
      this.renderPosts(posts.data || []);
    } catch (err) {
      statsEl.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><div class="empty-icon">📊</div><p>Couldn't load insights: ${escapeHtml(err.message)}</p></div>`;
    }
  },

  renderStats(data) {
    const statsEl = document.getElementById('insightsStats');
    // Different platforms surface different metrics — show whichever keys are present.
    const labels = {
      followers: { label: 'Followers', color: 'green' },
      views: { label: 'Views', color: 'blue' },
      likes: { label: 'Likes', color: 'pink' },
      comments: { label: 'Comments', color: 'purple' },
      replies: { label: 'Replies', color: 'purple' },
      reposts: { label: 'Reposts', color: 'amber' },
      quotes: { label: 'Quotes', color: 'amber' },
      shares: { label: 'Shares', color: 'amber' },
      reach: { label: 'Reach', color: 'blue' },
    };
    const keys = Object.keys(data).filter(k => labels[k] !== undefined);
    if (!keys.length) {
      statsEl.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><div class="empty-icon">📊</div><p>No data yet — connect this platform to see insights.</p></div>`;
      return;
    }
    statsEl.innerHTML = keys.map(k => `
      <div class="stat-card ${labels[k].color}">
        <div class="stat-label">${labels[k].label}</div>
        <div class="stat-value">${Number(data[k] || 0).toLocaleString()}</div>
      </div>
    `).join('');
  },

  renderTrend(snapshots) {
    const chartEl = document.getElementById('insightsTrendChart');
    if (!snapshots.length) {
      chartEl.innerHTML = `<div class="empty-state"><p>No trend data yet</p></div>`;
      return;
    }
    const maxFollowers = Math.max(1, ...snapshots.map(s => s.followers || 0));
    chartEl.innerHTML = snapshots.map(s => {
      const pct = Math.round((s.followers || 0) / maxFollowers * 100);
      return `
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
          <div style="width:100%;background:var(--surface2);border-radius:4px;height:150px;position:relative;overflow:hidden;">
            <div style="position:absolute;bottom:0;left:0;right:0;height:${pct}%;background:var(--primary);border-radius:4px 4px 0 0;transition:height 0.4s;"></div>
          </div>
          <span style="font-size:10.5px;color:var(--text2);">${new Date(s.captured_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
          <span style="font-size:11px;font-weight:600;">${(s.followers || 0).toLocaleString()}</span>
        </div>
      `;
    }).join('');
  },

  renderPosts(posts) {
    const postsEl = document.getElementById('insightsPostsTable');
    if (!posts.length) {
      postsEl.innerHTML = `<div class="empty-state"><div class="empty-icon">🖼️</div><p>No posts with insights yet</p></div>`;
      return;
    }
    const hasThreadsCols = posts.some(p => p.replies || p.reposts || p.quotes);
    postsEl.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Post</th><th>Date</th><th>Likes</th><th>Comments</th>
              ${hasThreadsCols ? '<th>Reposts</th><th>Quotes</th>' : '<th>Shares</th><th>Saves</th>'}
              <th>Reach</th>
            </tr>
          </thead>
          <tbody>
            ${posts.map(p => `
              <tr>
                <td style="max-width:260px;">
                  <div style="display:flex;align-items:center;gap:8px;">
                    ${p.thumbnail ? `<img src="${escapeHtml(p.thumbnail)}" alt="" style="width:32px;height:32px;border-radius:6px;object-fit:cover;flex-shrink:0;" />` : `<span style="width:32px;height:32px;border-radius:6px;background:var(--surface2);display:flex;align-items:center;justify-content:center;flex-shrink:0;">📝</span>`}
                    <span style="font-size:12.5px;">${escapeHtml(truncate(p.caption || p.message || '', 60)) || '<em>No caption</em>'}</span>
                  </div>
                </td>
                <td>${p.date ? formatDate(p.date) : '—'}</td>
                <td>${(p.likes || 0).toLocaleString()}</td>
                <td>${(p.comments || 0).toLocaleString()}</td>
                ${hasThreadsCols
                  ? `<td>${(p.reposts || 0).toLocaleString()}</td><td>${(p.quotes || 0).toLocaleString()}</td>`
                  : `<td>${(p.shares || 0).toLocaleString()}</td><td>${(p.saves || 0).toLocaleString()}</td>`}
                <td>${(p.reach || 0).toLocaleString()}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  },
};
// Expose module globally (const declarations do not auto-attach to window)
window.Insights = Insights;
