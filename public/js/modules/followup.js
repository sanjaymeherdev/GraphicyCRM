// js/modules/followup.js
window.CrudTabs = window.CrudTabs || {};
window.Followup = window.CrudTabs.followup = createSimpleCrudTab({
  key: 'followup',
  title: 'Follow-up Rules',
  subtitle: 'Re-engage leads on a channel after N hours of no reply',
  apiBase: '/api/followup/rules',
  listKey: 'rules',
  emptyIcon: '⏰',
  emptyText: 'No follow-up rules yet',
  columns: [
    { key: 'name', label: 'Name' },
    { key: 'channel', label: 'Channel' },
    { key: 'inactivity_hours', label: 'After (hours)' },
    { key: 'active', label: 'Active', render: (i) => (i.active ? 'Yes' : 'No') },
  ],
  fields: [
    { name: 'name', label: 'Name', type: 'text' },
    { name: 'channel', label: 'Channel', type: 'select', options: [{ value: 'whatsapp', label: 'WhatsApp' }, { value: 'facebook', label: 'Facebook' }, { value: 'instagram', label: 'Instagram' }, { value: 'threads', label: 'Threads (no DM API — will be skipped)' }, { value: 'gmail', label: 'Gmail' }] },
    { name: 'inactivity_hours', label: 'Inactive for (hours) before sending', type: 'number' },
    { name: 'message', label: 'Follow-up message', type: 'textarea' },
    { name: 'active', label: 'Active', type: 'checkbox' },
  ],
});
