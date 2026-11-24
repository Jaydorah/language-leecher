window.LT = window.LT || {};

// The schema below is written in plain notation, not as valid JSON, on purpose:
// in AI Studio tab mode the driver looks for new JSON code blocks on the page,
// so the instruction message itself must never parse as a tutor reply.
LT.buildPrompt = (settings, scenario, custom) => {
  const target = settings.target;
  const native = settings.native;
  const level = LT.LEVELS.find((l) => l.id === settings.level) || LT.LEVELS[0];
  const lang = LT.lang(target);
  const role = scenario ? scenario.role : 'Conversation partner';
  const setting = custom ? custom : scenario.setting;
  const reading = lang.nonlatin
    ? `; because ${target} uses a non-Latin script, make each pair a triple [word, meaning, romanized reading]`
    : '';

  return `You are a language tutor inside a chat app. Stay in this role for the whole conversation.

LEARNER
- Native language: ${native}
- Learning: ${target}
- Level: ${level.rule}

SCENE
- You play: ${role}. Give yourself a first name that fits a ${target}-speaking place.
- Situation: ${setting}
- Keep the scene moving. End most turns with one question so the learner has something to answer.

HOW TO REPLY
- "reply" is always in ${target}, matched to the learner's level. 1 to 3 short sentences.
- If the learner asks something about the language, answer briefly in ${native} in "aside", then continue the scene in "reply".

CORRECTIONS
Each learner message ends with a tag like [corrections: normal]. Apply that level to that message:
- relaxed: only fix mistakes that change the meaning or make the message hard to understand. Ignore accents, small spelling slips and style.
- normal: fix grammar, spelling, accents, gender/agreement and wrong words. Ignore missing capitals and final punctuation.
- strict: fix everything, including accents, capitals, punctuation, formal/informal address, and phrasing that is correct but not what a native speaker would say.

WORDS THE LEARNER DOESN'T KNOW
If the learner uses a ${native} word (or any word that isn't ${target}) inside their message, assume they don't know the ${target} word. This is not a mistake: put the ${target} word in "corrected" and add a fix with kind "new_word", original = the word they used, why = a short gloss like "coffee = café". If the whole message is in ${native}, translate all of it this way and carry on with the scene. New words are always shown, at every correction level.

OUTPUT FORMAT
Every message you send is exactly one JSON object inside a \`\`\`json code block, with nothing before or after it. Keys:

correction: null if the learner's last message needs no changes or there is no learner message yet. Otherwise an object with:
  corrected: the learner's whole message rewritten correctly in ${target}
  fixes: a list with one object per change, each with:
    text: the corrected word(s), copied exactly as they appear in "corrected"
    original: what the learner wrote there ("" if they left something out)
    kind: "mistake" or "new_word"
    why: a short explanation in ${native}
  note: an optional one-line tip in ${native}, or ""
aside: null, or a short answer in ${native} to a question the learner asked
reply: a list of sentences, each an object with:
  text: one sentence in ${target}
  translation: that sentence in ${native}
  words: a list of [word, meaning] pairs, in order, covering every word or set phrase in "text". Copy each word exactly as written in "text". Meanings are in ${native}, a few words at most${reading}
suggestions: 2 or 3 short things the learner could say next, each an object with text (in ${target}) and translation (in ${native})

Use double quotes and valid JSON. No other keys, no commentary outside the code block.`;
};

LT.OPENING = 'Start the scene now with your first line. "correction" must be null.';

// The strictness tag goes on every message so changing it mid-chat works, even in page mode.
LT.wrapLearner = (text, strictness = 'normal') =>
  `Learner: ${text}\n\n[corrections: ${strictness}] (Answer with the JSON code block only.)`;

LT.REPAIR = 'Your last message was not in the required format. Send that same reply again as one ```json code block that follows the schema, and nothing else.';

// Pull every top-level {...} object out of free text (string-aware brace matching).
function extractObjects(s) {
  const out = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = depth > 0;
    else if (c === '{') { if (depth++ === 0) start = i; }
    else if (c === '}' && depth > 0) { if (--depth === 0) out.push(s.slice(start, i + 1)); }
  }
  return out;
}

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

function normalize(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  let reply = o.reply;
  if (typeof reply === 'string') reply = [{ text: reply }];
  if (!Array.isArray(reply)) return null;
  reply = reply
    .map((r) => (typeof r === 'string' ? { text: r } : r))
    .filter((r) => r && typeof r === 'object' && str(r.text).trim())
    .map((r) => ({
      text: str(r.text),
      translation: str(r.translation),
      words: (Array.isArray(r.words) ? r.words : [])
        .map((w) => (Array.isArray(w) ? w : w && typeof w === 'object' ? [w.word ?? w.w, w.meaning ?? w.g, w.reading ?? w.r] : null))
        .filter((w) => w && str(w[0]).trim())
        .map((w) => [str(w[0]), str(w[1]), str(w[2])]),
    }));
  if (!reply.length) return null;

  let correction = null;
  const c = o.correction;
  if (c && typeof c === 'object' && str(c.corrected).trim()) {
    correction = {
      corrected: str(c.corrected),
      fixes: (Array.isArray(c.fixes) ? c.fixes : [])
        .filter((f) => f && typeof f === 'object' && str(f.text).trim())
        .map((f) => ({
          text: str(f.text),
          original: str(f.original),
          why: str(f.why),
          kind: /new/i.test(str(f.kind)) ? 'new_word' : 'mistake',
        })),
      note: str(c.note),
    };
  }

  const suggestions = (Array.isArray(o.suggestions) ? o.suggestions : [])
    .map((x) => (typeof x === 'string' ? { text: x, translation: '' } : x && { text: str(x.text), translation: str(x.translation) }))
    .filter((x) => x && x.text.trim())
    .slice(0, 3);

  const aside = typeof o.aside === 'string' && o.aside.trim() ? o.aside.trim() : null;
  return { correction, aside, reply, suggestions };
}

LT.parseTutor = (raw) => {
  if (!raw) return null;
  const s = String(raw);
  const candidates = [];
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m;
  while ((m = fence.exec(s))) candidates.push(m[1]);
  candidates.push(s.trim());
  candidates.push(...extractObjects(s).reverse()); // last object first: the answer comes after any "thinking" text
  for (const c of candidates) {
    try {
      const parsed = normalize(JSON.parse(c.trim()));
      if (parsed) return parsed;
    } catch {}
  }
  return null;
};
