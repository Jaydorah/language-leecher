window.LT = window.LT || {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const isVisible = (el) => {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none';
};

async function waitFor(fn, timeout, every = 300) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(every);
  }
  return null;
}

const notSent = (message) => Object.assign(new Error(message), { notSent: true });
const squash = (s) => String(s || '').replace(/\s+/g, '');

/*
 * Each chat site gets a list of selectors to try. These sites change their markup
 * often, so every lookup also has a generic fallback. Replies are found by looking
 * for a new code block (or assistant message) whose text parses as a tutor reply.
 */
LT.SITES = [
  {
    id: 'aistudio',
    name: 'AI Studio',
    hosts: ['aistudio.google.com', 'ai.studio'],
    newChatUrl: 'https://aistudio.google.com/prompts/new_chat',
    isFresh: () => location.hostname === 'aistudio.google.com' && /^\/prompts\/new_chat/.test(location.pathname),
    inputs: [
      'ms-prompt-input-wrapper textarea',
      'ms-chunk-input textarea',
      'ms-prompt-box textarea',
      'textarea[aria-label*="prompt" i]',
      'textarea[placeholder*="prompt" i]',
      'textarea[aria-label*="type something" i]',
      'footer textarea',
    ],
    sendButtons: ['run-button button', 'button[aria-label="Run"]', 'button.run-button'],
    stopButtons: [],
    replyTurns: [],
    submitKey: 'ctrl+enter',
    replyText() {
      const model = [...document.querySelectorAll('ms-chat-turn')].filter((t) => {
        if (t.querySelector('[data-turn-role="Model"], .model')) return true;
        return /\bmodel\b/i.test(`${t.className} ${t.firstElementChild?.className || ''}`);
      });
      return model.length ? model[model.length - 1].innerText || '' : '';
    },
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    hosts: ['chatgpt.com', 'chat.openai.com'],
    newChatUrl: 'https://chatgpt.com/',
    isFresh: () => location.pathname === '/',
    inputs: ['#prompt-textarea', 'div.ProseMirror[contenteditable="true"]', 'textarea[name="prompt-textarea"]'],
    sendButtons: ['button[data-testid="send-button"]', '#composer-submit-button', 'button[aria-label*="Send" i]'],
    stopButtons: ['button[data-testid="stop-button"]', 'button[aria-label*="Stop" i]'],
    replyTurns: ['[data-message-author-role="assistant"]'],
    submitKey: 'enter',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    hosts: ['chat.deepseek.com'],
    newChatUrl: 'https://chat.deepseek.com/',
    isFresh: () => !/\/s\//.test(location.pathname),
    inputs: ['textarea#chat-input', 'textarea[placeholder*="DeepSeek" i]', 'textarea[placeholder*="message" i]'],
    sendButtons: [],
    stopButtons: [],
    replyTurns: ['.ds-markdown'],
    submitKey: 'enter',
  },
];

LT.currentSite = () => LT.SITES.find((s) => s.hosts.includes(location.hostname)) || LT.SITES[0];

LT.makePageDriver = (site) => ({
  site,

  findInput() {
    for (const sel of site.inputs) {
      const el = [...document.querySelectorAll(sel)].find(isVisible);
      if (el) return el;
    }
    const tas = [...document.querySelectorAll('textarea')].filter(isVisible);
    if (tas.length) return tas[tas.length - 1];
    const ce = [...document.querySelectorAll('[contenteditable="true"]')].filter(isVisible);
    return ce[ce.length - 1] || null;
  },

  findSendButton() {
    for (const sel of [...site.sendButtons, 'button[type="submit"]']) {
      const el = [...document.querySelectorAll(sel)].find(isVisible);
      if (el) return el;
    }
    return (
      [...document.querySelectorAll('button')].find((b) => {
        if (!isVisible(b)) return false;
        const label = (b.getAttribute('aria-label') || b.textContent || '').trim();
        return /^(run|send)\b/i.test(label);
      }) || null
    );
  },

  isGenerating() {
    if (site.stopButtons.some((sel) => [...document.querySelectorAll(sel)].some(isVisible))) return true;
    return [...document.querySelectorAll('button')].some((b) => {
      const label = (b.getAttribute('aria-label') || b.textContent || '').trim();
      return /^stop\b/i.test(label) && isVisible(b);
    });
  },

  // ChatGPT wraps code in a header ("json", "Copy code"), so prefer the <code> inside.
  codeBlockTexts() {
    return [...document.querySelectorAll('pre')].map((p) => {
      const code = p.querySelector('code');
      return (code ? code.textContent : p.innerText || p.textContent) || '';
    });
  },

  lastReplyText() {
    if (site.replyText) return site.replyText();
    for (const sel of site.replyTurns) {
      const all = document.querySelectorAll(sel);
      if (all.length) return all[all.length - 1].innerText || '';
    }
    return '';
  },

  findNewReply(seen, prevTurn) {
    const blocks = this.codeBlockTexts().filter((t) => !seen.has(t));
    for (let i = blocks.length - 1; i >= 0; i--) if (LT.parseTutor(blocks[i])) return blocks[i];
    const turn = this.lastReplyText();
    if (turn && turn !== prevTurn && LT.parseTutor(turn)) return turn;
    return null;
  },

  readInput(el) {
    return el.tagName === 'TEXTAREA' ? el.value : el.textContent;
  },

  fill(el, text) {
    el.focus();
    if (el.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    // Rich editors (ChatGPT's ProseMirror) handle a synthetic paste best; fall back to insertText.
    document.execCommand('selectAll', false);
    document.execCommand('delete', false);
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    } catch {}
    if (!squash(el.textContent).includes(squash(text).slice(0, 40))) {
      document.execCommand('insertText', false, text);
    }
  },

  pressSubmitKey(el) {
    const ctrl = site.submitKey === 'ctrl+enter';
    for (const type of ['keydown', 'keypress', 'keyup']) {
      el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, ctrlKey: ctrl, bubbles: true, cancelable: true }));
    }
  },

  async typeAndSubmit(text) {
    const input = await waitFor(() => this.findInput(), 20000);
    if (!input) {
      throw notSent(`Couldn't find ${site.name}'s message box. Open ${site.name}, check you're signed in and on a chat page, then retry.`);
    }
    this.fill(input, text);
    await sleep(400);

    const stillThere = () => input.isConnected && squash(this.readInput(input)) === squash(text);
    const btn = this.findSendButton();
    if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') btn.click();
    else this.pressSubmitKey(input);

    // Text still in the box means the first attempt didn't take; try the other way.
    if (await waitFor(() => !stillThere(), 3000, 200)) return;
    this.pressSubmitKey(input);
    if (await waitFor(() => !stillThere(), 3000, 200)) return;
    throw notSent(`${site.name} didn't accept the message (the send button may be disabled). Open ${site.name} to check, then retry.`);
  },

  async send(text) {
    const seen = new Set(this.codeBlockTexts());
    const prevTurn = this.lastReplyText();
    await this.typeAndSubmit(text);

    const end = Date.now() + 180000;
    let last = null, stable = 0;
    while (Date.now() < end) {
      await sleep(700);
      const found = this.findNewReply(seen, prevTurn);
      if (!found) continue;
      if (found === last) {
        stable++;
        if ((stable >= 2 && !this.isGenerating()) || stable >= 6) return found;
      } else {
        last = found;
        stable = 0;
      }
    }
    const err = new Error(`Timed out waiting for a reply from ${site.name}. Open ${site.name} to see what happened (rate limit, error, sign-in).`);
    err.raw = this.lastReplyText();
    throw err;
  },

  // Message already sent but the reply was bad: ask for a resend instead of duplicating the message.
  retry(err, original) {
    return err?.notSent ? this.send(original) : this.send(LT.REPAIR);
  },

  commit() {},
});

/* API mode: Gemini, OpenAI or DeepSeek through the background worker. History is kept in state. */
LT.API_PROVIDERS = [
  { id: 'gemini', label: 'Gemini', defaultModel: 'gemini-flash-latest', keyUrl: 'aistudio.google.com/apikey' },
  { id: 'openai', label: 'OpenAI (ChatGPT)', defaultModel: 'gpt-4.1-mini', keyUrl: 'platform.openai.com/api-keys' },
  { id: 'deepseek', label: 'DeepSeek', defaultModel: 'deepseek-chat', keyUrl: 'platform.deepseek.com/api_keys' },
];

LT.ApiDriver = {
  pending: null,

  async send(text, state, settings) {
    const provider = settings.apiProvider || 'gemini';
    const history = [...(state.history || []), { role: 'user', text }];
    let res;
    try {
      res = await chrome.runtime.sendMessage({
        type: 'lt-api',
        provider,
        apiKey: settings.apiKeys?.[provider] || '',
        model: settings.apiModels?.[provider] || '',
        system: state.system,
        history,
      });
    } catch (e) {
      throw notSent(`Extension error: ${e.message}. Try reloading the page.`);
    }
    if (!res?.ok) throw notSent(res?.error || 'No response from the API.');
    this.pending = [...history, { role: 'assistant', text: res.text }];
    return res.text;
  },

  retry(_err, original, state, settings) {
    return this.send(original, state, settings);
  },

  // Only keep the turn in history once its reply parsed.
  commit(state) {
    if (this.pending) state.history = this.pending;
    this.pending = null;
  },
};
