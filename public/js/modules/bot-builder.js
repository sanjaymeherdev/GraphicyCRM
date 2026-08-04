// js/modules/bot-builder.js
window.CrudTabs = window.CrudTabs || {};
window.BotBuilder = window.CrudTabs['bot-builder'] = createSimpleCrudTab({
  key: 'bot-builder',
  title: 'Bot Builder',
  subtitle: 'Deterministic reply rules, checked before the AI auto-reply falls through',
  apiBase: '/api/bot-builder',
  listKey: 'rules',
  emptyIcon: '🤖',
  emptyText: 'No bot rules yet',
  columns: [
    { key: 'name', label: 'Name' },
    { key: 'match_type', label: 'Match' },
    { key: 'match_value', label: 'Value' },
    { key: 'priority', label: 'Priority' },
    { key: 'active', label: 'Active', render: (i) => (i.active ? 'Yes' : 'No') },
  ],
  fields: [
    { name: 'name', label: 'Name', type: 'text' },
    { name: 'match_type', label: 'Match type', type: 'select', options: [{ value: 'contains', label: 'Contains' }, { value: 'exact', label: 'Exact' }, { value: 'starts_with', label: 'Starts with' }, { value: 'regex', label: 'Regex' }] },
    { name: 'match_value', label: 'Match value', type: 'text' },
    { name: 'channels', label: 'Channels', type: 'tags', placeholder: 'whatsapp,facebook,instagram' },
    { name: 'reply_type', label: 'Reply type', type: 'select', options: [{ value: 'text', label: 'Text' }, { value: 'interactive_template', label: 'Interactive Template (WhatsApp)' }] },
    { name: 'reply_text', label: 'Reply text (if reply type is Text)', type: 'textarea' },
    { name: 'interactive_template_id', label: 'Interactive Template ID (if reply type is Interactive Template)', type: 'text' },
    { name: 'priority', label: 'Priority (higher checked first)', type: 'number' },
    { name: 'active', label: 'Active', type: 'checkbox' },
  ],
});
