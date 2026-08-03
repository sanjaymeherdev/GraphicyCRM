// js/modules/help-assistant.js — Floating "Help Assistant" popup (🤖 FAB,
// bottom-right, available on every tab). Talks to /api/help-bot/chat, the
// same general product-help bot already used in public/mobile.html. This
// desktop version adds one extra thing mobile doesn't have: a "Tag a
// module" picker — when set, the backend attaches that module's
// routes.js/service.js as extra context, so the assistant can explain the
// code or propose a fix as a unified diff the user can save as fix.patch.
//
// NOTE: this is a distinct feature from the old "Chatbot" tab (removed),
// which configured customer-facing keyword automations — see
// modules/ai-bot and modules/automations for that.

const HelpAssistant = {
  history: [], // [{role:'user'|'assistant', content}] — in-memory only, resets on reload
  modulesLoaded: false,

  async init() {
    // Populate the module picker once, lazily (first time the panel opens).
    if (this.modulesLoaded) return;
    try {
      const res = await API.getHelpBotModules();
      const select = document.getElementById('assistantModuleSelect');
      if (select && Array.isArray(res.modules)) {
        for (const name of res.modules) {
          const opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name;
          select.appendChild(opt);
        }
      }
      this.modulesLoaded = true;
    } catch (err) {
      console.warn('Help Assistant: failed to load module list', err);
    }
  },

  toggle() {
    const panel = document.getElementById('assistantPanel');
    if (!panel) return;
    const willOpen = !panel.classList.contains('open');
    panel.classList.toggle('open');
    if (willOpen) this.init();
  },

  autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 100) + 'px';
  },

  // Very small, safe markdown-lite: escapes everything, then turns fenced
  // ```diff blocks into a <pre><code> with Copy + "Save as fix.patch"
  // buttons. Per product requirement, the bot should only ever show *text*
  // to the user — a patch is the one exception. Any other ```lang fenced
  // block (the model shouldn't produce one, but just in case) is rendered
  // as plain text with the fences stripped, not as a code block.
  renderContent(container, content) {
    const parts = String(content || '').split(/```(\w*)\n([\s\S]*?)```/g);
    // split() with a capturing regex interleaves: [plain, lang, code, plain, lang, code, ..., plain]
    container.innerHTML = '';
    for (let i = 0; i < parts.length; i += 3) {
      const plain = parts[i];
      if (plain) {
        const span = document.createElement('span');
        span.textContent = plain;
        container.appendChild(span);
      }
      const lang = parts[i + 1];
      const code = parts[i + 2];
      if (code === undefined) continue;

      if (lang !== 'diff') {
        // Not a patch — treat as plain text, no code styling.
        const span = document.createElement('span');
        span.textContent = code;
        container.appendChild(span);
        continue;
      }

      const pre = document.createElement('pre');
      const codeEl = document.createElement('code');
      codeEl.textContent = code;
      pre.appendChild(codeEl);
      container.appendChild(pre);

      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:6px;margin:-2px 0 8px;';

      const copyBtn = document.createElement('button');
      copyBtn.className = 'btn btn-ghost btn-sm';
      copyBtn.textContent = '📋 Copy';
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(code).then(() => {
          if (window.showToast) showToast('Copied to clipboard');
        });
      };
      actions.appendChild(copyBtn);

      const saveBtn = document.createElement('button');
      saveBtn.className = 'btn btn-ghost btn-sm';
      saveBtn.textContent = '💾 Save fix.patch';
      saveBtn.onclick = () => {
        const blob = new Blob([code], { type: 'text/x-diff' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'fix.patch';
        a.click();
        URL.revokeObjectURL(url);
      };
      actions.appendChild(saveBtn);
      container.appendChild(actions);
    }
  },

  renderMessage(content, role) {
    const body = document.getElementById('assistantBody');
    if (!body) return null;
    const div = document.createElement('div');
    div.className = `assistant-msg ${role === 'user' ? 'user' : 'bot'}`;
    if (role === 'user') div.textContent = content;
    else this.renderContent(div, content);
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
    return div;
  },

  async send() {
    const input = document.getElementById('assistantInput');
    const btn = document.getElementById('assistantSendBtn');
    const moduleSelect = document.getElementById('assistantModuleSelect');
    const text = input?.value?.trim();
    if (!text) return;

    const moduleTag = moduleSelect?.value || undefined;

    this.renderMessage(text, 'user');
    this.history.push({ role: 'user', content: text });
    input.value = '';
    this.autoResize(input);
    btn.disabled = true;

    const pending = this.renderMessage('Thinking…', 'bot');
    pending.classList.add('pending');

    try {
      const res = await API.sendHelpBotMessage(this.history, { module: moduleTag });
      pending.remove();
      if (res && res.success && res.content) {
        this.renderMessage(res.content, 'bot');
        this.history.push({ role: 'assistant', content: res.content });
      } else {
        this.renderMessage(res?.error || "Sorry, I couldn't get an answer just now. Please try again.", 'bot');
      }
    } catch (err) {
      pending.remove();
      this.renderMessage('Sorry, something went wrong: ' + err.message, 'bot');
    } finally {
      btn.disabled = false;
    }
  },
};

function toggleAssistant() { HelpAssistant.toggle(); }
function sendAssistantMessage() { HelpAssistant.send(); }
function autoResize(el) { HelpAssistant.autoResize(el); }

window.HelpAssistant = HelpAssistant;
window.toggleAssistant = toggleAssistant;
window.sendAssistantMessage = sendAssistantMessage;
window.autoResize = autoResize;

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('assistantInput');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendAssistantMessage();
      }
    });
  }
});
