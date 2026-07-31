// js/utils/constants.js
const SOURCE_ICON = {
  whatsapp: '📱',
  instagram: '📷',
  facebook: '👥',
  webform: '📝',
  sheet: '📊',
  email: '📧',
  manual: '✍️',
  web_chat: '🤖',
};

const STATUS_BADGE = {
  new: 'amber',
  contacted: 'purple',
  engaged: 'pink',
  converted: 'green',
  won: 'green',
  lost: 'red',
  cold: 'red',
  follow_up: 'blue',
  booked: 'blue',
};

const SOURCE_OPTIONS = [
  { value: 'whatsapp', label: '📱 WhatsApp' },
  { value: 'instagram', label: '📷 Instagram' },
  { value: 'facebook', label: '👥 Facebook' },
  { value: 'webform', label: '📝 Web Form' },
  { value: 'sheet', label: '📊 Sheet' },
  { value: 'email', label: '📧 Email' },
  { value: 'manual', label: '✍️ Manual' },
];

const STATUS_OPTIONS = [
  { value: 'new', label: '🆕 New' },
  { value: 'contacted', label: '📞 Contacted' },
  { value: 'engaged', label: '👁 Engaged' },
  { value: 'booked', label: '✅ Booked' },
  { value: 'converted', label: '🏆 Converted' },
  { value: 'won', label: '🏆 Won' },
  { value: 'follow_up', label: '🔁 Follow Up' },
  { value: 'cold', label: '❄️ Cold' },
  { value: 'lost', label: '❌ Lost' },
];

const CHANNEL_OPTIONS = [
  { value: 'whatsapp', label: '📱 WhatsApp' },
  { value: 'instagram', label: '📷 Instagram' },
  { value: 'facebook', label: '👥 Facebook' },
  { value: 'email', label: '📧 Email' },
];

// ─── SCHEDULE / INSIGHTS (content publishing platforms — distinct from
// CHANNEL_OPTIONS above, which is for inbox/messaging channels) ───
const PLATFORM_ICON = {
  facebook: '👥',
  instagram: '📷',
  threads: '🧵',
  linkedin: '💼',
};

const PLATFORM_OPTIONS = [
  { value: 'facebook', label: '👥 Facebook' },
  { value: 'instagram', label: '📷 Instagram' },
  { value: 'threads', label: '🧵 Threads' },
  { value: 'linkedin', label: '💼 LinkedIn' },
];

// Platforms Meta's Graph Insights API actually supports (LinkedIn has no
// insights/analytics endpoint reachable with a personal-profile token).
const INSIGHTS_PLATFORM_OPTIONS = [
  { value: 'facebook', label: '👥 Facebook' },
  { value: 'instagram', label: '📷 Instagram' },
  { value: 'threads', label: '🧵 Threads' },
];

const POST_STATUS_BADGE = {
  draft: 'gray',
  scheduled: 'blue',
  published: 'green',
  partial: 'amber',
  failed: 'red',
};