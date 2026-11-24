const SITE_URLS = {
  aistudio: 'https://aistudio.google.com/prompts/new_chat',
  chatgpt: 'https://chatgpt.com/',
  deepseek: 'https://chat.deepseek.com/',
};
const SUPPORTED = /^https:\/\/(aistudio\.google\.com|ai\.studio|chatgpt\.com|chat\.openai\.com|chat\.deepseek\.com)\//;

// Toolbar button: toggle the tutor on a supported site, otherwise open the preferred one.
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url && SUPPORTED.test(tab.url)) {
    chrome.tabs.sendMessage(tab.id, { type: 'lt-toggle' }).catch(() => {});
    return;
  }
  const { lt_settings: s } = await chrome.storage.local.get('lt_settings');
  chrome.tabs.create({ url: SITE_URLS[s?.homeSite] || SITE_URLS.aistudio });
});

// API mode: content scripts can't call these APIs cross-origin, so requests go through here.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'lt-api') return;
  callApi(msg)
    .then((text) => sendResponse({ ok: true, text }))
    .catch((e) => sendResponse({ ok: false, error: e.message || String(e) }));
  return true;
});

const PROVIDERS = {
  gemini: { label: 'Gemini', defaultModel: 'gemini-flash-latest' },
  openai: { label: 'OpenAI', defaultModel: 'gpt-4.1-mini', url: 'https://api.openai.com/v1/chat/completions' },
  deepseek: { label: 'DeepSeek', defaultModel: 'deepseek-chat', url: 'https://api.deepseek.com/chat/completions' },
};

// history: [{ role: 'user' | 'assistant', text }]
async function callApi({ provider, apiKey, model, system, history }) {
  const p = PROVIDERS[provider] || PROVIDERS.gemini;
  if (!apiKey) throw new Error(`No ${p.label} API key set. Add one in Settings, or switch to "Use the chat on this page".`);
  model = (model || p.defaultModel).trim();
  return provider === 'openai' || provider === 'deepseek'
    ? openAiCompatible(p, apiKey, model, system, history)
    : gemini(apiKey, model, system, history);
}

async function gemini(apiKey, model, system, history) {
  const name = model.replace(/^models\//, '');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(name)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: history.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })),
      generationConfig: { responseMimeType: 'application/json', temperature: 0.8 },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || `Gemini API returned HTTP ${res.status}`);
  const cand = json.candidates?.[0];
  const text = (cand?.content?.parts || []).filter((x) => !x.thought).map((x) => x.text || '').join('');
  if (!text) throw new Error(`Empty response (${cand?.finishReason || json.promptFeedback?.blockReason || 'unknown reason'})`);
  return text;
}

async function openAiCompatible(p, apiKey, model, system, history) {
  const res = await fetch(p.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, ...history.map((m) => ({ role: m.role, content: m.text }))],
      response_format: { type: 'json_object' },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || `${p.label} API returned HTTP ${res.status}`);
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new Error(`Empty response (${json.choices?.[0]?.finish_reason || 'unknown reason'})`);
  return text;
}
