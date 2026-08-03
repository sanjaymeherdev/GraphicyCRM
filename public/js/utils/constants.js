// js/utils/constants.js
const SOURCE_ICON = {
  whatsapp: '<img src="/images/whatsapp.png" alt="WhatsApp" />',
  instagram: '<img src="/images/instagram.png" alt="Instagram" />',
  facebook: '<img src="/images/facebook.png" alt="Facebook" />',
  webform: '📝',
  sheet: '📊',
  email: '<img src="/images/gmail.png" alt="Gmail" />',
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
  { value: 'whatsapp', label: '<img src="/images/whatsapp.png" alt="WhatsApp" class="channel-option-icon" /> WhatsApp' },
  { value: 'instagram', label: '<img src="/images/instagram.png" alt="Instagram" class="channel-option-icon" /> Instagram' },
  { value: 'facebook', label: '<img src="/images/facebook.png" alt="Facebook" class="channel-option-icon" /> Facebook' },
  { value: 'webform', label: '📝 Web Form' },
  { value: 'sheet', label: '📊 Sheet' },
  { value: 'email', label: '<img src="/images/gmail.png" alt="Email" class="channel-option-icon" /> Email' },
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
  { value: 'whatsapp', label: '<img src="/images/whatsapp.png" alt="WhatsApp" class="channel-option-icon" /> WhatsApp' },
  { value: 'instagram', label: '<img src="/images/instagram.png" alt="Instagram" class="channel-option-icon" /> Instagram' },
  { value: 'facebook', label: '<img src="/images/facebook.png" alt="Facebook" class="channel-option-icon" /> Facebook' },
  { value: 'email', label: '<img src="/images/gmail.png" alt="Gmail" class="channel-option-icon" /> Email' },
];

// ─── SCHEDULE / INSIGHTS (content publishing platforms — distinct from
// CHANNEL_OPTIONS above, which is for inbox/messaging channels) ───
const PLATFORM_ICON = {
  facebook: '<img src="/images/facebook.png" alt="Facebook" />',
  instagram: '<img src="/images/instagram.png" alt="Instagram" />',
  threads: '<img src="/images/Threads.png" alt="Threads" />',
  linkedin: '💼',
};

const PLATFORM_OPTIONS = [
  { value: 'facebook', label: '<img src="/images/facebook.png" alt="Facebook" class="channel-option-icon" /> Facebook' },
  { value: 'instagram', label: '<img src="/images/instagram.png" alt="Instagram" class="channel-option-icon" /> Instagram' },
  { value: 'threads', label: '<img src="/images/Threads.png" alt="Threads" class="channel-option-icon" /> Threads' },
  { value: 'linkedin', label: '💼 LinkedIn' },
];

// Platforms Meta's Graph Insights API actually supports (LinkedIn has no
// insights/analytics endpoint reachable with a personal-profile token).
const INSIGHTS_PLATFORM_OPTIONS = [
  { value: 'facebook', label: '<img src="/images/facebook.png" alt="Facebook" class="channel-option-icon" /> Facebook' },
  { value: 'instagram', label: '<img src="/images/instagram.png" alt="Instagram" class="channel-option-icon" /> Instagram' },
  { value: 'threads', label: '<img src="/images/Threads.png" alt="Threads" class="channel-option-icon" /> Threads' },
];

const POST_STATUS_BADGE = {
  draft: 'gray',
  scheduled: 'blue',
  published: 'green',
  partial: 'amber',
  failed: 'red',
};