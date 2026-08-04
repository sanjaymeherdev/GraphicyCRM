// js/modules/flows.js
window.CrudTabs = window.CrudTabs || {};
window.Flows = window.CrudTabs.flows = createSimpleCrudTab({
  key: 'flows',
  title: 'Flows',
  subtitle: 'Multi-step automation builder — richer than single-reply Automation rules',
  apiBase: '/api/flows',
  listKey: 'flows',
  emptyIcon: '🧭',
  emptyText: 'No flows yet — build a multi-step conversation flow',
  columns: [
    { key: 'name', label: 'Name' },
    { key: 'trigger_type', label: 'Trigger' },
    { key: 'trigger_value', label: 'Value' },
    { key: 'channels', label: 'Channels', render: (i) => (i.channels || []).join(', ') },
    { key: 'active', label: 'Active', render: (i) => (i.active ? 'Yes' : 'No') },
  ],
  fields: [
    { name: 'name', label: 'Name', type: 'text' },
    { name: 'trigger_type', label: 'Trigger type', type: 'select', options: [{ value: 'keyword', label: 'Keyword' }, { value: 'event', label: 'Event' }, { value: 'manual', label: 'Manual' }] },
    { name: 'trigger_value', label: 'Trigger value (keyword or event name)', type: 'text' },
    { name: 'channels', label: 'Channels', type: 'tags', placeholder: 'whatsapp,facebook,instagram' },
    { name: 'steps', label: 'Steps (JSON array — e.g. [{"type":"message","text":"Hi!"},{"type":"delay","minutes":5}])', type: 'json', jsonType: 'array', default: '[]' },
    { name: 'active', label: 'Active', type: 'checkbox' },
  ],
});
