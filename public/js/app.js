// js/app.js - Main App Controller
(function() {
  'use strict';

  // ─── STATE ───
  const state = {
    user: null,
    client: null,
    theme: null,
    isDark: false,
    activeTab: 'dashboard',
    loading: false,
    leads: [],
    contacts: [],
    inbox: [],
    automations: [],
    templates: [],
    stats: {},
    selectedRuleId: null,
    selectedTplId: null,
  };

  // ─── DOM REFS ───
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    sidebar: $('#sidebar'),
    menuToggle: $('#menuToggle'),
    main: $('#mainContent'),
    loadingOverlay: $('#loadingOverlay'),
    toast: $('#toast'),
    modalOverlay: $('#modalOverlay'),
    modal: $('#modal'),
    modalTitle: $('#modalTitle'),
    modalBody: $('#modalBody'),
    modalClose: $('#modalClose'),
    modalCancel: $('#modalCancel'),
    modalConfirm: $('#modalConfirm'),

    notifBtn: $('#notifBtn'),
    notifDot: $('#notifDot'),
    themeToggle: $('#themeToggle'),
    userBtn: $('#userBtn'),
    userAvatar: $('#userAvatar'),
    userName: $('#userName'),
    userDropdown: $('#userDropdown'),
    userAvatarLg: $('#userAvatarLg'),
    userDropdownName: $('#userDropdownName'),
    userDropdownEmail: $('#userDropdownEmail'),
    profileBtn: $('#profileBtn'),
    settingsBtn: $('#settingsBtn'),
    logoutBtn: $('#logoutBtn'),
    sidebarLogoutBtn: $('#sidebarLogoutBtn'),

    navItems: $$('.nav-item[data-tab]'),
    sidebarClientBadge: $('#sidebarClientBadge'),
    sidebarClientName: $('#sidebarClientName'),
    sidebarClientRole: $('#sidebarClientRole'),
    navContactsCount: $('#navContactsCount'),
    navInboxCount: $('#navInboxCount'),
    navLeadsCount: $('#navLeadsCount'),

    panels: $$('.tab-panel'),
  };

  // ─── EXPOSE STATE GLOBALLY ───
  window.state = state;

  // ─── LOADING ───
  function showLoading() {
    dom.loadingOverlay.classList.add('show');
    state.loading = true;
  }

  function hideLoading() {
    dom.loadingOverlay.classList.remove('show');
    state.loading = false;
  }

  // ─── TOAST ───
  function showToast(msg, isError = false) {
    dom.toast.textContent = msg;
    dom.toast.className = 'toast show ' + (isError ? 'error' : 'success');
    clearTimeout(dom.toast._timeout);
    dom.toast._timeout = setTimeout(() => dom.toast.classList.remove('show'), 3000);
  }
  window.showToast = showToast;

  // ─── MODAL ───
  function openModal(title, bodyHTML, confirmText = 'Confirm', onConfirm = null) {
    dom.modalTitle.textContent = title;
    dom.modalBody.innerHTML = bodyHTML;
    dom.modalConfirm.textContent = confirmText;
    dom.modalOverlay.classList.add('open');
    dom.modalConfirm.onclick = () => {
      if (onConfirm) onConfirm();
      closeModal();
    };
  }
  window.openModal = openModal;

  function closeModal() {
    dom.modalOverlay.classList.remove('open');
  }
  window.closeModal = closeModal;

  dom.modalClose.addEventListener('click', closeModal);
  dom.modalCancel.addEventListener('click', closeModal);
  dom.modalOverlay.addEventListener('click', (e) => {
    if (e.target === dom.modalOverlay) closeModal();
  });

  // ─── NAVIGATION ───
  function navigateTo(tab) {
    state.activeTab = tab;

    dom.navItems.forEach(item => {
      item.classList.toggle('active', item.dataset.tab === tab);
    });

    dom.panels.forEach(panel => {
      panel.classList.toggle('active', panel.id === `tab-${tab}`);
    });

    // Load tab data
    const loaders = {
      dashboard: loadDashboard,
      contacts: loadContacts,
      inbox: loadInbox,
      leads: loadLeads,
      sources: loadSources,
      settings: loadSettings,
      profile: loadProfile,
      schedule: loadSchedule,
      insights: loadInsights,
      automation: loadAutomation,
      templates: loadTemplates,
      integrations: loadIntegrations,
      reports: loadReports,
    };

    if (loaders[tab]) loaders[tab]();

    dom.sidebar.classList.remove('open');
  }
  window.navigateTo = navigateTo;

  // ─── THEME ───
  function applyTheme(theme) {
    if (!theme) return;
    const root = document.documentElement;
    const map = {
      primary: '--primary',
      primaryDark: '--primary-dark',
      bg: '--bg',
      bg2: '--bg2',
      surface: '--surface',
      surface2: '--surface2',
      surface3: '--surface3',
      border: '--border',
      border2: '--border2',
      text: '--text',
      text2: '--text2',
      text3: '--text3',
      green: '--green',
      amber: '--amber',
      red: '--red',
      blue: '--blue',
      purple: '--purple',
      pink: '--pink',
      radius: '--radius',
      radiusSm: '--radius-sm',
      fontFamily: '--font',
    };
    for (const [key, cssVar] of Object.entries(map)) {
      if (theme[key] !== undefined) {
        root.style.setProperty(cssVar, theme[key]);
      }
    }
    if (theme.isDark !== undefined) {
      document.body.classList.toggle('dark', theme.isDark);
      state.isDark = theme.isDark;
      dom.themeToggle.innerHTML = theme.isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
    }
  }

  async function loadTheme() {
    try {
      const theme = await API.getTheme();
      state.theme = theme;
      applyTheme(theme);
    } catch (err) {
      const saved = localStorage.getItem('crm_dark_mode');
      if (saved !== null) {
        document.body.classList.toggle('dark', saved === 'true');
        state.isDark = saved === 'true';
        dom.themeToggle.innerHTML = state.isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
      } else {
        document.body.classList.add('dark');
        state.isDark = true;
        dom.themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
      }
    }
  }

  function toggleTheme() {
    state.isDark = !state.isDark;
    document.body.classList.toggle('dark', state.isDark);
    dom.themeToggle.innerHTML = state.isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
    localStorage.setItem('crm_dark_mode', String(state.isDark));
    if (state.theme) {
      state.theme.isDark = state.isDark;
      API.saveTheme(state.theme).catch(() => {});
    }
  }
  window.toggleTheme = toggleTheme;

  dom.themeToggle.addEventListener('click', toggleTheme);

  // ─── CLIENT INFO (sidebar) ───
  // Single-client frontend: just display this client's name/badge, no switching or listing.
  function renderClientInfo() {
    const client = state.client;
    if (!client) return;
    dom.sidebarClientBadge.textContent = client.name.charAt(0).toUpperCase();
    dom.sidebarClientName.textContent = client.name;
    dom.sidebarClientRole.textContent = client.role || 'Client';
  }

  // ─── DATA LOADING ───
  async function loadAllData() {
    showLoading();
    try {
      const [profile, client, leads, contacts, inbox, stats] = await Promise.all([
        API.getProfile(),
        API.getMyClient(),
        API.getLeads(),
        API.getContacts(),
        API.getInbox(),
        API.getDashboardStats(),
      ]);

      state.user = profile.user;
      state.client = client.client || null;
      state.leads = leads.leads || [];
      state.contacts = contacts.contacts || [];
      state.inbox = inbox.threads || [];
      state.stats = stats;

      dom.navContactsCount.textContent = state.contacts.length;
      dom.navInboxCount.textContent = state.inbox.filter(t => t.needs_reply).length;
      dom.navLeadsCount.textContent = state.leads.length;

      const u = state.user;
      if (u) {
        dom.userAvatar.textContent = getInitials(u.name || u.email);
        dom.userName.textContent = u.name || u.email;
        dom.userAvatarLg.textContent = getInitials(u.name || u.email);
        dom.userDropdownName.textContent = u.name || u.email;
        dom.userDropdownEmail.textContent = u.email || '';
      }

      renderClientInfo();

      loadTabData(state.activeTab);

    } catch (err) {
      console.error('Failed to load data:', err);
      renderClientInfo();
      loadTabData(state.activeTab);
    } finally {
      hideLoading();
    }
  }

  async function refreshAllData() {
    await loadAllData();
  }
  window.refreshAllData = refreshAllData;

  function loadTabData(tab) {
    const loaders = {
      dashboard: loadDashboard,
      contacts: loadContacts,
      inbox: loadInbox,
      leads: loadLeads,
      sources: loadSources,
      settings: loadSettings,
      profile: loadProfile,
      schedule: loadSchedule,
      insights: loadInsights,
      automation: loadAutomation,
      templates: loadTemplates,
      integrations: loadIntegrations,
      reports: loadReports,
    };
    if (loaders[tab]) loaders[tab]();
  }

  // ─── TAB LOADERS ───
  function loadDashboard() {
    if (window.Dashboard) Dashboard.render(state);
    else console.warn('Dashboard module not loaded');
  }

  function loadContacts() {
    if (window.Contacts) Contacts.render(state);
    else console.warn('Contacts module not loaded');
  }

  function loadInbox() {
    if (window.Inbox) Inbox.render(state);
    else console.warn('Inbox module not loaded');
  }

  function loadLeads() {
    if (window.Leads) Leads.render(state);
    else console.warn('Leads module not loaded');
  }

  function loadSources() {
    if (window.Sources) Sources.render(state);
    else console.warn('Sources module not loaded');
  }

  function loadSettings() {
    if (window.Settings) Settings.render(state);
    else console.warn('Settings module not loaded');
  }

  function loadProfile() {
    if (window.Profile) Profile.render(state);
    else console.warn('Profile module not loaded');
  }

  function loadSchedule() {
    if (window.Schedule) Schedule.render(state);
    else console.warn('Schedule module not loaded');
  }

  function loadInsights() {
    if (window.Insights) Insights.render(state);
    else console.warn('Insights module not loaded');
  }

  function loadAutomation() {
    if (window.Automation) Automation.render(state);
    else console.warn('Automation module not loaded');
  }

  function loadTemplates() {
    if (window.Templates) Templates.render(state);
    else console.warn('Templates module not loaded');
  }

  function loadIntegrations() {
    if (window.Integrations) Integrations.render(state);
    else console.warn('Integrations module not loaded');
  }

  function loadReports() {
    if (window.Reports) Reports.render(state);
    else console.warn('Reports module not loaded');
  }

  // ─── UI EVENT BINDING ───
  function initUI() {
    dom.menuToggle.addEventListener('click', () => dom.sidebar.classList.toggle('open'));

    dom.navItems.forEach(item => {
      item.addEventListener('click', () => {
        navigateTo(item.dataset.tab);
        dom.sidebar.classList.remove('open');
      });
    });

    dom.userBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dom.userDropdown.classList.toggle('open');
    });
    document.addEventListener('click', () => dom.userDropdown.classList.remove('open'));

    dom.profileBtn.addEventListener('click', () => {
      dom.userDropdown.classList.remove('open');
      navigateTo('profile');
    });
    dom.settingsBtn.addEventListener('click', () => {
      dom.userDropdown.classList.remove('open');
      navigateTo('settings');
    });

    dom.logoutBtn.addEventListener('click', API.logout);
    dom.sidebarLogoutBtn.addEventListener('click', API.logout);
  }

  // ─── INIT ───
  async function init() {
    initUI();
    await loadTheme();
    await loadAllData();
  }

  // Make modules available globally
  window.API = API;
  window.escapeHtml = escapeHtml;
  window.timeAgo = timeAgo;
  window.formatDate = formatDate;
  window.formatDateTime = formatDateTime;
  window.getInitials = getInitials;
  window.getStatusBadgeClass = getStatusBadgeClass;
  window.getSourceIcon = getSourceIcon;
  window.truncate = truncate;
  window.SOURCE_ICON = SOURCE_ICON;
  window.STATUS_BADGE = STATUS_BADGE;

  // Start app
  document.addEventListener('DOMContentLoaded', init);
})();