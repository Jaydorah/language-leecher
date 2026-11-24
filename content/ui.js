(() => {
  if (window.__ltLoaded) return;
  window.__ltLoaded = true;
  const LT = window.LT;
  const site = LT.currentSite();
  const pageDriver = LT.makePageDriver(site);

  // ---------- storage ----------
  const store = {
    get: (k) => chrome.storage.local.get(k).then((v) => v[k]),
    set: (k, v) => chrome.storage.local.set({ [k]: v }),
    del: (k) => chrome.storage.local.remove(k),
  };
  const STATE_KEY = `lt_state_${site.id}`; // one conversation per site, so they don't mix
  const PENDING_KEY = `lt_pending_${site.id}`;
  const DEFAULTS = {
    target: 'Spanish',
    native: 'English',
    level: 'beginner',
    strictness: 'normal',
    mode: 'page',
    apiProvider: 'gemini',
    apiKeys: {},
    apiModels: {},
    homeSite: 'aistudio',
    autoOpen: true,
    autoSpeak: false,
    showAccents: true,
    micAutoSend: false,
  };
  const freshState = () => ({ scenarioId: null, custom: '', messages: [], history: [], system: '', suggestions: [], mode: null });

  let settings = { ...DEFAULTS };
  let state = freshState();
  let view = 'picker';
  let busy = false;
  let retryFn = null;
  const save = () => store.set(STATE_KEY, state);
  const saveSettings = () => store.set('lt_settings', settings);

  function migrateSettings(s) {
    s = { ...DEFAULTS, ...(s || {}) };
    if (s.mode === 'aistudio') s.mode = 'page';
    if (s.apiKey) { s.apiKeys = { ...s.apiKeys, gemini: s.apiKeys.gemini || s.apiKey }; delete s.apiKey; }
    if (s.model) { s.apiModels = { ...s.apiModels, gemini: s.apiModels.gemini || s.model }; delete s.model; }
    return s;
  }

  // ---------- DOM helpers (no innerHTML: Google pages enforce Trusted Types) ----------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    let value;
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'value') value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
    if (value !== undefined) el.value = value;
    return el;
  }
  const NS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
    el.append(...kids);
    return el;
  }
  const ICONS = {
    speaker: ['M11 5 6 9H3v6h3l5 4z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M18.5 5.5a9 9 0 0 1 0 13'],
    plus: ['M12 5v14', 'M5 12h14'],
    send: ['M5 12h14', 'M13 6l6 6-6 6'],
    sliders: ['M4 6h9', 'M17 6h3', 'M15 4v4', 'M4 12h3', 'M11 12h9', 'M9 10v4', 'M4 18h11', 'M19 18h1', 'M17 16v4'],
    translate: ['M4 5h8', 'M8 3v2', 'M6 5c0 4 3 7 6 8', 'M10 5c0 4-3 7-6 8', 'M13 21l4-9 4 9', 'M14.5 18h5'],
    eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z', 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6'],
    check: ['M5 12l5 5 9-10'],
    retry: ['M4 4v6h6', 'M20 12a8 8 0 0 0-14.6-4.5L4 10', 'M20 20v-6h-6', 'M4 12a8 8 0 0 0 14.6 4.5L20 14'],
    chat: ['M4 5h16v11H9l-5 4z'],
    mic: ['M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z', 'M5 11a7 7 0 0 0 14 0', 'M12 18v3'],
    shift: ['M12 4l8 8h-4v7H8v-7H4z'],
  };
  const icon = (name, size = 20) =>
    s('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
      ...ICONS[name].map((d) => s('path', { d })));

  // Simple flat character portraits.
  function avatar(a, size = 52) {
    a = a || LT.CUSTOM_AVATAR;
    const svg = s('svg', { viewBox: '0 0 64 64', width: size, height: size, class: 'av', 'aria-hidden': 'true' });
    const hc = a.hairColor || '#2b2b2b';
    if (a.hair === 'long') svg.append(s('rect', { x: 13, y: 12, width: 38, height: 40, rx: 14, fill: hc }));
    svg.append(s('path', { d: 'M8 64c0-12 10-18 24-18s24 6 24 18z', fill: a.shirt }));
    svg.append(s('rect', { x: 27, y: 38, width: 10, height: 11, rx: 3, fill: a.skin }));
    svg.append(s('rect', { x: 16, y: 12, width: 32, height: 33, rx: 13, fill: a.skin }));
    svg.append(s('rect', { x: 13, y: 26, width: 6, height: 8, rx: 3, fill: a.skin }));
    svg.append(s('rect', { x: 45, y: 26, width: 6, height: 8, rx: 3, fill: a.skin }));
    const top = 'M16 25v-3c0-7 6-12 13-12h6c7 0 13 5 13 12v3c-4-5-9-7-16-7s-12 2-16 7z';
    if (a.hair === 'short' || a.hair === 'long') svg.append(s('path', { d: top, fill: hc }));
    if (a.hair === 'bun') {
      svg.append(s('circle', { cx: 32, cy: 8, r: 6, fill: hc }));
      svg.append(s('path', { d: top, fill: hc }));
    }
    if (a.hair === 'curly') {
      for (const [cx, cy, r] of [[19, 19, 6], [26, 13, 7], [34, 11, 7], [42, 14, 7], [46, 21, 5]]) svg.append(s('circle', { cx, cy, r, fill: hc }));
    }
    svg.append(s('circle', { cx: 26, cy: 28, r: 2.3, fill: '#24282b' }));
    svg.append(s('circle', { cx: 38, cy: 28, r: 2.3, fill: '#24282b' }));
    if (a.glasses) {
      const g = { fill: 'none', stroke: '#24282b', 'stroke-width': 1.8 };
      svg.append(s('circle', { cx: 26, cy: 28, r: 5, ...g }), s('circle', { cx: 38, cy: 28, r: 5, ...g }), s('path', { d: 'M31 28h2', ...g }));
    }
    if (a.mustache) svg.append(s('path', { d: 'M24 36q8-5 16 0q-8 2-16 0z', fill: a.hairColor || '#2b2b2b' }));
    else svg.append(s('path', { d: 'M27 36q5 4 10 0', fill: 'none', stroke: '#24282b', 'stroke-width': 2, 'stroke-linecap': 'round' }));
    return svg;
  }

  // ---------- speech out ----------
  function speak(text) {
    if (!('speechSynthesis' in window) || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const code = LT.lang(settings.target).code;
    if (code) {
      u.lang = code;
      const norm = (l) => l.replace('_', '-').toLowerCase();
      const voices = speechSynthesis.getVoices();
      u.voice = voices.find((v) => norm(v.lang) === code.toLowerCase()) || voices.find((v) => norm(v.lang).startsWith(code.slice(0, 2).toLowerCase())) || null;
    }
    u.rate = settings.level === 'beginner' ? 0.85 : 0.95;
    speechSynthesis.speak(u);
  }

  // ---------- speech in (microphone) ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  function toggleMic() {
    if (rec) { rec.stop(); return; }
    if (!SR) return;
    rec = new SR();
    const code = LT.lang(settings.target).code;
    if (code) rec.lang = code;
    rec.interimResults = true;
    rec.continuous = false;
    const base = ui.input.value.trim() ? `${ui.input.value.trim()} ` : '';
    let heard = '';
    rec.onresult = (e) => {
      heard = [...e.results].map((r) => r[0].transcript).join('');
      ui.input.value = base + heard;
      autosize();
    };
    rec.onerror = (e) => {
      const msgs = {
        'not-allowed': `Microphone blocked. Allow it for ${location.hostname} in Chrome's site settings.`,
        'no-speech': "Didn't hear anything. Try again a bit closer to the mic.",
        network: 'Speech recognition needs an internet connection.',
      };
      flashHint(msgs[e.error] || `Microphone error: ${e.error}`);
    };
    rec.onend = () => {
      rec = null;
      setMicUI(false);
      ui.input.focus();
      if (settings.micAutoSend && heard.trim()) submit();
    };
    try {
      rec.start();
      setMicUI(true);
      flashHint(`Listening in ${settings.target}… click the mic again to stop.`, 0);
    } catch (e) {
      rec = null;
      flashHint(`Couldn't start the microphone: ${e.message}`);
    }
  }
  function setMicUI(on) {
    ui.mic.classList.toggle('on', on);
    ui.mic.setAttribute('aria-pressed', String(on));
    ui.mic.setAttribute('aria-label', on ? 'Stop listening' : 'Speak your answer');
    if (!on) flashHint(null);
  }

  // ---------- text marking ----------
  const LETTER = /[\p{L}\p{M}\p{N}]/u;
  function findRanges(text, needles, boundary) {
    const lower = text.toLowerCase();
    const ok = (i, n) => !boundary || ((i === 0 || !LETTER.test(text[i - 1])) && (i + n >= text.length || !LETTER.test(text[i + n])));
    const find = (needle, from) => {
      for (const [hay, nd] of [[text, needle], [lower, needle.toLowerCase()]]) {
        let i = hay.indexOf(nd, from);
        while (i >= 0 && !ok(i, nd.length)) i = hay.indexOf(nd, i + 1);
        if (i >= 0) return i;
      }
      return -1;
    };
    const ranges = [];
    let cursor = 0;
    needles.forEach((needle, idx) => {
      if (!needle) return;
      let i = find(needle, cursor);
      if (i >= 0) cursor = i + needle.length;
      else i = find(needle, 0);
      if (i < 0) return;
      const r = { start: i, end: i + needle.length, idx };
      if (ranges.some((x) => r.start < x.end && r.end > x.start)) return;
      ranges.push(r);
    });
    return ranges.sort((a, b) => a.start - b.start);
  }
  function marked(text, needles, boundary, make) {
    const out = [];
    let pos = 0;
    for (const r of findRanges(text, needles, boundary)) {
      if (r.start > pos) out.push(text.slice(pos, r.start));
      out.push(make(text.slice(r.start, r.end), r.idx));
      pos = r.end;
    }
    if (pos < text.length) out.push(text.slice(pos));
    return out;
  }

  // ---------- tooltip ----------
  const tips = new WeakMap();
  const withTip = (el, build) => (tips.set(el, build), el);

  // ---------- shell ----------
  const hostEl = document.createElement('div');
  hostEl.id = 'studio-tutor-root';
  hostEl.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
  const root = hostEl.attachShadow({ mode: 'open' });

  const ui = {};
  function buildShell() {
    ui.who = h('div', { class: 'who' });
    ui.overlay = h('div', { class: 'overlay', role: 'dialog', 'aria-label': 'Language tutor', hidden: true },
      h('header', { class: 'top' },
        ui.who,
        h('div', { class: 'actions' },
          h('button', { class: 'icon-btn', title: 'Start a new conversation', onclick: () => { view = 'picker'; render(); } }, icon('plus'), h('span', { class: 'lbl' }, 'New chat')),
          h('button', { class: 'icon-btn', title: `Hide the tutor and show ${site.name}`, onclick: () => setOpen(false) }, icon('eye'), h('span', { class: 'lbl' }, site.name)),
          h('button', { class: 'icon-btn', title: 'Settings', 'aria-label': 'Settings', onclick: openSettings }, icon('sliders')),
        ),
      ),
      (ui.scroll = h('main', { class: 'scroll' })),
      (ui.composer = h('footer', { class: 'composer' })),
    );
    ui.tip = h('div', { class: 'tip', role: 'tooltip', hidden: true });
    ui.fab = h('button', { class: 'fab', onclick: () => setOpen(true) }, icon('chat'), 'Tutor');
    ui.modal = h('div', { class: 'modal-back', hidden: true, onclick: (e) => e.target === ui.modal && closeSettings() });

    buildComposer();
    root.append(ui.overlay, ui.fab, ui.modal, ui.tip);

    const tipFrom = (e) => {
      const el = e.composedPath().find((n) => n instanceof Element && tips.has(n));
      el ? showTip(el) : hideTip();
    };
    root.addEventListener('mouseover', tipFrom);
    root.addEventListener('focusin', tipFrom);
    ui.scroll.addEventListener('scroll', hideTip, { passive: true });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !ui.modal.hidden) closeSettings();
    });
    // Keep the host site's keyboard shortcuts from firing while typing in the tutor.
    for (const t of ['keydown', 'keyup', 'keypress', 'paste']) hostEl.addEventListener(t, (e) => e.stopPropagation());
  }

  function showTip(el) {
    ui.tip.replaceChildren(...[tips.get(el)()].flat().filter((x) => x != null));
    ui.tip.hidden = false;
    const r = el.getBoundingClientRect();
    const t = ui.tip.getBoundingClientRect();
    const left = Math.max(8, Math.min(innerWidth - t.width - 8, r.left + r.width / 2 - t.width / 2));
    let top = r.top - t.height - 8;
    if (top < 8) top = r.bottom + 8;
    ui.tip.style.left = `${left}px`;
    ui.tip.style.top = `${top}px`;
  }
  const hideTip = () => { ui.tip.hidden = true; };

  function setOpen(open) {
    ui.overlay.hidden = !open;
    ui.fab.hidden = open;
    hideTip();
    document.documentElement.style.overflow = open ? 'hidden' : '';
    if (open && view === 'chat') setTimeout(() => ui.input?.focus(), 50);
  }

  // ---------- composer ----------
  const HINT = 'Enter to send · Shift+Enter for a new line · Hover dotted words for meanings · Stuck on a word? Type it in your own language';
  let hintTimer = null;
  function flashHint(text, ms = 5000) {
    clearTimeout(hintTimer);
    ui.hint.textContent = text || HINT;
    ui.hint.classList.toggle('alert', !!text);
    if (text && ms) hintTimer = setTimeout(() => flashHint(null), ms);
  }

  function buildComposer() {
    ui.chips = h('div', { class: 'chips' });
    ui.accents = h('div', { class: 'accents', role: 'group', 'aria-label': 'Accented letters' });
    ui.input = h('textarea', {
      rows: 1,
      placeholder: 'Write your answer…',
      'aria-label': 'Your message',
      oninput: autosize,
      onkeydown: (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
      },
    });
    ui.mic = h('button', { class: 'mic', 'aria-pressed': 'false', 'aria-label': 'Speak your answer', title: 'Speak your answer', onclick: toggleMic, hidden: !SR }, icon('mic', 22));
    ui.send = h('button', { class: 'btn', onclick: submit, 'aria-label': 'Send' }, 'Send', icon('send', 18));
    ui.hint = h('div', { class: 'hint', 'aria-live': 'polite' }, HINT);
    ui.composer.append(h('div', { class: 'composer-inner' },
      ui.chips,
      ui.accents,
      h('div', { class: 'form' }, ui.input, ui.mic, ui.send),
      ui.hint,
    ));
  }

  let shiftOn = false;
  function renderAccents() {
    const keys = (LT.ACCENTS[LT.lang(settings.target).name] || '').split(' ').filter(Boolean);
    ui.accents.hidden = !settings.showAccents || !keys.length;
    if (ui.accents.hidden) return;
    const up = (k) => (k.toUpperCase().length === k.length ? k.toUpperCase() : k); // ß -> SS would be wrong
    // mousedown preventDefault keeps the cursor in the textarea.
    const keep = (e) => e.preventDefault();
    ui.accents.replaceChildren(
      h('button', {
        class: 'key shift', 'aria-pressed': String(shiftOn), 'aria-label': 'Capital letters', title: 'Capitals (or hold Shift while clicking)',
        onmousedown: keep, onclick: () => { shiftOn = !shiftOn; renderAccents(); },
      }, icon('shift', 16)),
      ...keys.map((k) => h('button', {
        class: 'key', onmousedown: keep,
        onclick: (e) => {
          insertAtCursor(shiftOn || e.shiftKey ? up(k) : k);
          if (shiftOn) { shiftOn = false; renderAccents(); }
        },
      }, shiftOn ? up(k) : k)),
    );
  }
  function insertAtCursor(t) {
    const el = ui.input;
    const a = el.selectionStart ?? el.value.length;
    const b = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, a) + t + el.value.slice(b);
    el.selectionStart = el.selectionEnd = a + t.length;
    el.focus();
    autosize();
  }

  function autosize() {
    ui.input.style.height = 'auto';
    ui.input.style.height = `${Math.min(160, ui.input.scrollHeight + 4)}px`;
  }
  function submit() {
    const text = ui.input.value.trim();
    if (!text || busy) return;
    if (rec) rec.abort();
    ui.input.value = '';
    autosize();
    sendLearner(text);
  }

  // ---------- conversation ----------
  const scenario = () => LT.SCENARIOS.find((x) => x.id === state.scenarioId) || null;
  const roleName = () => (state.scenarioId === 'custom' ? 'Your scene' : scenario()?.role || 'Tutor');
  const avatarFor = () => (state.scenarioId === 'custom' ? LT.CUSTOM_AVATAR : scenario()?.avatar);
  const driver = () => ((state.mode || settings.mode) === 'api' ? LT.ApiDriver : pageDriver);

  async function startScenario(id, custom = '') {
    state = { ...freshState(), scenarioId: id, custom, mode: settings.mode };
    view = 'chat';
    await save();
    if (settings.mode === 'page' && !site.isFresh()) {
      // Every scene gets a fresh chat so old context doesn't leak in.
      await store.set(PENDING_KEY, Date.now());
      location.href = site.newChatUrl;
      return;
    }
    begin();
  }

  function begin() {
    const sc = state.scenarioId === 'custom' ? { role: 'A character that fits the scene' } : scenario();
    state.system = LT.buildPrompt(settings, sc, state.custom);
    state.history = [];
    const first = driver() === pageDriver ? `${state.system}\n\n${LT.OPENING}` : LT.OPENING;
    render();
    runTurn((err) => (err ? driver().retry(err, first, state, settings) : driver().send(first, state, settings)), null);
  }

  async function sendLearner(text) {
    const msg = { role: 'user', text, correction: undefined };
    state.messages = state.messages.filter((m) => m.role !== 'error');
    state.messages.push(msg);
    state.suggestions = [];
    await save();
    const wrapped = LT.wrapLearner(text, settings.strictness);
    runTurn((err) => (err ? driver().retry(err, wrapped, state, settings) : driver().send(wrapped, state, settings)), msg);
  }

  async function runTurn(attempt, userMsg, prevErr = null) {
    busy = true;
    retryFn = null;
    state.messages = state.messages.filter((m) => m.role !== 'error');
    render();
    try {
      const raw = await attempt(prevErr);
      const data = LT.parseTutor(raw);
      if (!data) throw Object.assign(new Error("The reply wasn't in the expected format."), { raw });
      driver().commit(state);
      if (userMsg) userMsg.correction = data.correction;
      if (data.aside) state.messages.push({ role: 'aside', text: data.aside });
      state.messages.push({ role: 'bot', data, showTr: false });
      state.suggestions = data.suggestions;
      if (settings.autoSpeak) speak(data.reply.map((r) => r.text).join(' '));
    } catch (e) {
      console.warn('[Studio Tutor]', e);
      state.messages.push({ role: 'error', text: e.message || String(e), raw: e.raw || '' });
      retryFn = () => runTurn(attempt, userMsg, e);
    }
    busy = false;
    await save();
    render();
    if (!ui.overlay.hidden) ui.input.focus();
  }

  // ---------- rendering ----------
  function render() {
    hideTip();
    const inChat = view === 'chat' && state.scenarioId;
    ui.who.replaceChildren(...[
      inChat ? avatar(avatarFor(), 36) : null,
      h('h1', null, inChat ? roleName() : 'Language tutor'),
      h('button', { class: 'chip', title: 'Change language, level or corrections', onclick: () => { view = 'picker'; render(); } },
        `${settings.target} · ${LT.LEVELS.find((l) => l.id === settings.level)?.label || ''}`),
    ].filter(Boolean));
    ui.composer.hidden = !inChat;
    if (!inChat) {
      ui.scroll.replaceChildren(renderPicker());
      ui.scroll.scrollTop = 0;
      return;
    }
    const thread = h('div', { class: 'thread', 'aria-live': 'polite' });
    for (const m of state.messages) thread.append(renderMsg(m));
    if (busy) thread.append(h('div', { class: 'row bot' }, avatar(avatarFor()), h('div', { class: 'bubble', 'aria-label': 'Typing' }, h('div', { class: 'dots' }, h('i'), h('i'), h('i')))));
    ui.scroll.replaceChildren(thread);
    ui.scroll.scrollTop = ui.scroll.scrollHeight;

    ui.chips.replaceChildren(...(busy ? [] : state.suggestions || []).map((sg) =>
      h('button', { class: 'sugg', onclick: () => { ui.input.value = sg.text; autosize(); ui.input.focus(); } },
        sg.text, sg.translation ? h('small', null, sg.translation) : null)));
    ui.chips.hidden = !ui.chips.childElementCount;
    renderAccents();
    ui.send.disabled = busy;
  }

  function renderMsg(m) {
    if (m.role === 'bot') return renderBot(m);
    if (m.role === 'user') return renderUser(m);
    if (m.role === 'aside') return h('div', { class: 'row aside' }, h('div', { class: 'aside-card' }, h('b', null, 'Tutor note'), m.text));
    if (m.role === 'error') {
      const showPage = driver() === pageDriver;
      return h('div', { class: 'row err', role: 'alert' },
        h('div', { class: 'err-card' },
          m.text,
          h('div', { class: 'tools' },
            retryFn ? h('button', { class: 'link-btn', onclick: () => retryFn && retryFn() }, icon('retry', 16), 'Retry') : null,
            showPage ? h('button', { class: 'link-btn', onclick: () => setOpen(false) }, icon('eye', 16), `Show ${site.name}`) : null,
          ),
          m.raw ? h('details', null, h('summary', { class: 'small' }, 'Raw reply'), h('pre', null, m.raw.slice(0, 4000))) : null,
        ));
    }
    return h('div');
  }

  function renderBot(m) {
    const { reply } = m.data;
    const boundary = !LT.lang(settings.target).nospace;
    const bubble = h('div', { class: 'bubble' },
      reply.map((sent, i) => h('p', { class: 'sent', dir: 'auto' },
        i === 0 ? h('button', { class: 'speak', 'aria-label': 'Listen', title: 'Listen', onclick: () => speak(reply.map((r) => r.text).join(' ')) }, icon('speaker', 22)) : null,
        marked(sent.text, sent.words.map((w) => w[0]), boundary, (txt, idx) => {
          const [, meaning, reading] = sent.words[idx];
          return withTip(h('span', { class: 'w', tabindex: 0, onclick: () => speak(txt) }, txt),
            () => [reading ? h('small', null, reading) : null, meaning || '—']);
        }),
      )),
      m.showTr ? h('div', { class: 'tr', dir: 'auto' }, reply.map((r) => r.translation).filter(Boolean).join(' ')) : null,
    );
    const hasTr = reply.some((r) => r.translation);
    return h('div', { class: 'row bot' }, avatar(avatarFor()),
      h('div', { class: 'col' }, bubble,
        hasTr ? h('div', { class: 'tools' },
          h('button', { class: 'link-btn', onclick: () => { m.showTr = !m.showTr; save(); render(); } },
            icon('translate', 16), m.showTr ? 'Hide translation' : 'Translate')) : null,
      ));
  }

  function renderUser(m) {
    const c = m.correction;
    let body;
    if (c) {
      const fixes = c.fixes || [];
      const mistakes = fixes.filter((f) => f.kind !== 'new_word');
      const newWords = fixes.filter((f) => f.kind === 'new_word');
      body = [
        h('p', { class: 'sent', dir: 'auto' },
          marked(c.corrected, fixes.map((f) => f.text), false, (txt, idx) => {
            const f = fixes[idx];
            if (f.kind === 'new_word') {
              return withTip(h('span', { class: 'newword', tabindex: 0, onclick: () => speak(txt) }, txt), () => [
                h('small', null, 'New word'),
                f.original ? `${f.original} → ${txt}` : txt,
                f.why && !f.why.includes(txt) ? h('small', null, f.why) : null,
              ]);
            }
            return withTip(h('span', { class: 'fix', tabindex: 0 }, txt), () => [
              f.original ? h('small', null, 'You wrote: ', h('s', null, f.original)) : h('small', null, 'Missing word'),
              f.why || 'Corrected',
            ]);
          })),
        h('div', { class: 'orig', dir: 'auto' }, 'You wrote: ', mistakes.length ? h('s', null, m.text) : m.text),
        newWords.length ? h('div', { class: 'note' }, `${newWords.length === 1 ? 'New word' : 'New words'}: `,
          newWords.map((f, i) => [i ? ', ' : '', h('b', null, f.text), f.original ? ` (${f.original})` : ''])) : null,
        c.note ? h('div', { class: 'note' }, c.note) : null,
      ];
    } else {
      body = h('p', { class: 'sent', dir: 'auto' }, m.text,
        c === null ? withTip(h('span', { class: 'ok', 'aria-label': 'No mistakes' }, icon('check', 18)), () => 'No mistakes') : null);
    }
    return h('div', { class: 'row user' }, h('div', { class: 'bubble' }, body));
  }

  function seg(label, items, key) {
    return h('div', { class: 'field' }, label,
      h('div', { class: 'seg', role: 'group', 'aria-label': label },
        items.map((it) => h('button', {
          'aria-pressed': String(settings[key] === it.id),
          onclick: () => { settings[key] = it.id; saveSettings(); render(); },
        }, it.label))));
  }

  function renderPicker() {
    const langList = h('datalist', { id: 'lt-langs' }, LT.LANGS.map((l) => h('option', { value: l.name })));
    const setLang = (key) => (e) => {
      const v = e.target.value.trim();
      if (v) { settings[key] = LT.lang(v).name || v; saveSettings(); render(); }
    };
    const customBox = h('textarea', { placeholder: 'Describe your own scene, e.g. "Renting a bike in Lisbon. You run the rental shop."', 'aria-label': 'Custom scene' });

    return h('div', { class: 'picker' },
      h('h2', null, 'What do you want to practice?'),
      langList,
      h('div', { class: 'langrow' },
        h('label', { class: 'field' }, "I'm learning", h('input', { list: 'lt-langs', value: settings.target, onchange: setLang('target') })),
        h('label', { class: 'field' }, 'I speak', h('input', { list: 'lt-langs', value: settings.native, onchange: setLang('native') })),
      ),
      h('div', { class: 'langrow', style: 'margin-top:14px' },
        seg('Level', LT.LEVELS, 'level'),
        seg('Corrections', LT.STRICTNESS, 'strictness'),
      ),
      h('p', { class: 'small' },
        { relaxed: 'Relaxed: only mistakes that change the meaning.', normal: 'Normal: grammar, spelling, accents and wrong words.', strict: 'Strict: everything, including punctuation and phrasing a native speaker wouldn’t use.' }[settings.strictness],
        ' You can change this mid-chat.'),
      state.scenarioId && state.messages.length
        ? h('div', { style: 'margin-top:18px' }, h('button', { class: 'btn ghost', onclick: () => { view = 'chat'; render(); } }, `Back to current chat (${roleName()})`))
        : null,
      h('h3', null, 'Pick a scene'),
      h('div', { class: 'grid' }, LT.SCENARIOS.map((sc) =>
        h('button', { class: 'card', onclick: () => startScenario(sc.id) }, avatar(sc.avatar, 48), h('div', null, h('strong', null, sc.title), h('span', null, sc.blurb))))),
      h('h3', null, 'Or make your own'),
      h('div', { class: 'custom' }, customBox,
        h('button', { class: 'btn', onclick: () => customBox.value.trim() && startScenario('custom', customBox.value.trim()) }, 'Start')),
      h('p', { class: 'small', style: 'margin-top:24px' },
        settings.mode === 'page'
          ? `Running on ${site.name}. Each scene opens a new ${site.name} chat. To pick a model, click "${site.name}" above first.`
          : `Running on the ${LT.API_PROVIDERS.find((p) => p.id === settings.apiProvider)?.label} API (change in Settings).`),
    );
  }

  // ---------- settings ----------
  function openSettings() {
    const draft = { apiKeys: { ...settings.apiKeys }, apiModels: { ...settings.apiModels } };
    const radio = (name, v, cur) => h('input', { type: 'radio', name, value: v, checked: cur === v });
    const check = (k, label) => h('label', { class: 'check' }, h('input', { type: 'checkbox', 'data-k': k, checked: settings[k] }), label);

    const provider = h('select', null, LT.API_PROVIDERS.map((p) => h('option', { value: p.id }, p.label)));
    provider.value = settings.apiProvider;
    const key = h('input', { type: 'password', autocomplete: 'off' });
    const model = h('input');
    const keyHelp = h('span', { class: 'small' });
    let shown = settings.apiProvider;
    const loadProvider = () => {
      const p = LT.API_PROVIDERS.find((x) => x.id === provider.value);
      key.value = draft.apiKeys[p.id] || '';
      model.value = draft.apiModels[p.id] || '';
      model.placeholder = p.defaultModel;
      keyHelp.textContent = `Get a key at ${p.keyUrl}. Stored only in this browser.`;
      shown = p.id;
    };
    const keepProvider = () => { draft.apiKeys[shown] = key.value.trim(); draft.apiModels[shown] = model.value.trim(); };
    provider.addEventListener('change', () => { keepProvider(); loadProvider(); });
    loadProvider();

    const home = h('select', null, LT.SITES.map((x) => h('option', { value: x.id }, x.name)));
    home.value = settings.homeSite;

    const form = h('div', { class: 'modal', role: 'dialog', 'aria-label': 'Settings' },
      h('h2', null, 'Settings'),
      h('label', { class: 'radio' }, radio('mode', 'page', settings.mode), h('div', null,
        h('b', null, `Use the ${site.name} chat on this page`),
        h('span', null, `Types into ${site.name} behind the tutor. No key needed. To use AI Studio, ChatGPT or DeepSeek instead, open the tutor on that site.`))),
      h('label', { class: 'radio' }, radio('mode', 'api', settings.mode), h('div', null,
        h('b', null, 'Use an API key'),
        h('span', null, 'Faster and more reliable. Gemini has a free tier; OpenAI and DeepSeek are pay-as-you-go.'))),
      h('div', { class: 'api-box' },
        h('label', { class: 'field' }, 'Provider', provider),
        h('label', { class: 'field' }, 'API key', key, keyHelp),
        h('label', { class: 'field' }, 'Model', model),
      ),
      h('h3', { class: 'sub' }, 'Typing and speaking'),
      check('showAccents', 'Show accented-letter keys'),
      check('micAutoSend', 'Send automatically when I stop speaking'),
      check('autoSpeak', 'Read replies aloud'),
      h('h3', { class: 'sub' }, 'General'),
      check('autoOpen', 'Open the tutor automatically on supported sites'),
      h('label', { class: 'field' }, 'Toolbar button opens', home),
      h('p', { class: 'small' }, 'Changing the mode or provider applies to your next new chat.'),
      h('div', { class: 'foot' },
        h('button', { class: 'btn ghost', onclick: closeSettings }, 'Cancel'),
        h('button', { class: 'btn', onclick: () => {
          keepProvider();
          settings.mode = form.querySelector('input[name=mode]:checked')?.value || 'page';
          settings.apiProvider = provider.value;
          settings.apiKeys = draft.apiKeys;
          settings.apiModels = draft.apiModels;
          settings.homeSite = home.value;
          for (const cb of form.querySelectorAll('input[data-k]')) settings[cb.dataset.k] = cb.checked;
          saveSettings();
          closeSettings();
          render();
        } }, 'Save')),
    );
    ui.modal.replaceChildren(form);
    ui.modal.hidden = false;
    form.querySelector('input')?.focus();
  }
  const closeSettings = () => { ui.modal.hidden = true; ui.modal.replaceChildren(); };

  // ---------- boot ----------
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'lt-toggle') setOpen(ui.overlay.hidden);
  });

  (async () => {
    try {
      const css = await fetch(chrome.runtime.getURL('content/tutor.css')).then((r) => r.text());
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      root.adoptedStyleSheets = [sheet];
    } catch (e) {
      console.warn('[Studio Tutor] stylesheet failed to load', e);
    }
    settings = migrateSettings(await store.get('lt_settings'));
    let saved = await store.get(STATE_KEY);
    if (!saved && site.id === 'aistudio') saved = await store.get('lt_state'); // from v1.0
    state = { ...freshState(), ...(saved || {}) };
    if (state.mode === 'aistudio') state.mode = 'page';
    // A reload mid-turn leaves nothing to wait for.
    state.messages = state.messages.filter((m) => m.role !== 'error');
    view = state.scenarioId ? 'chat' : 'picker';

    document.documentElement.append(hostEl);
    buildShell();

    const pending = await store.get(PENDING_KEY);
    if (pending) {
      await store.del(PENDING_KEY);
      setOpen(true);
      if (Date.now() - pending < 60000) begin();
      else render();
      return;
    }
    setOpen(settings.autoOpen);
    render();
  })();
})();
