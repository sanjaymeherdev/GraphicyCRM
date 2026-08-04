// js/modules/interactive-templates.js
window.CrudTabs = window.CrudTabs || {};
window.InteractiveTemplates = window.CrudTabs['interactive-templates'] = createSimpleCrudTab({
  key: 'interactive-templates',
  title: 'Interactive Templates',
  subtitle: 'WhatsApp button / list / CTA-link message templates',
  apiBase: '/api/interactive-templates',
  listKey: 'templates',
  emptyIcon: '🔘',
  emptyText: 'No interactive templates yet',
  columns: [
    { key: 'name', label: 'Name' },
    { key: 'interactive_type', label: 'Type' },
  ],
  fields: [
    { name: 'name', label: 'Name', type: 'text' },
    { name: 'interactive_type', label: 'Type', type: 'select', options: [{ value: 'button', label: 'Buttons (up to 3)' }, { value: 'list', label: 'List' }, { value: 'cta_url', label: 'CTA Link' }] },
    { name: 'config', label: 'Config (JSON — see WhatsApp Cloud API "interactive" object shape)', type: 'json', jsonType: 'object', default: '{"body":"","buttons":[{"id":"1","title":"Yes"}]}' },
  ],
});
