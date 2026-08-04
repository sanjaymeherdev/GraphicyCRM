// js/modules/field-mappings.js
window.CrudTabs = window.CrudTabs || {};
window.FieldMappings = window.CrudTabs['field-mappings'] = createSimpleCrudTab({
  key: 'field-mappings',
  title: 'Field Mappings',
  subtitle: 'Map incoming sheet/webform column names to lead fields',
  apiBase: '/api/field-mappings',
  listKey: 'mappings',
  emptyIcon: '🔗',
  emptyText: 'No field mappings yet',
  columns: [
    { key: 'channel', label: 'Source' },
    { key: 'source_field', label: 'Incoming field' },
    { key: 'target_field', label: 'Maps to' },
  ],
  fields: [
    { name: 'channel', label: 'Source', type: 'select', options: [{ value: 'sheet', label: 'Google Sheet' }, { value: 'webform', label: 'Webform' }] },
    { name: 'source_field', label: 'Incoming column/field name (e.g. "Full Name")', type: 'text' },
    { name: 'target_field', label: 'Maps to lead field', type: 'select', options: ['name', 'phone', 'email', 'whatsapp', 'instagram', 'facebook', 'notes'].map((v) => ({ value: v, label: v })) },
  ],
});
