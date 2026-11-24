window.LT = window.LT || {};

// code = BCP-47 tag for text-to-speech. nonlatin = ask for romanized readings.
// nospace = script without spaces between words (no word-boundary matching).
LT.LANGS = [
  { name: 'Spanish', code: 'es-ES' },
  { name: 'French', code: 'fr-FR' },
  { name: 'German', code: 'de-DE' },
  { name: 'Italian', code: 'it-IT' },
  { name: 'Portuguese', code: 'pt-BR' },
  { name: 'Dutch', code: 'nl-NL' },
  { name: 'Swedish', code: 'sv-SE' },
  { name: 'Norwegian', code: 'nb-NO' },
  { name: 'Danish', code: 'da-DK' },
  { name: 'Polish', code: 'pl-PL' },
  { name: 'Turkish', code: 'tr-TR' },
  { name: 'Vietnamese', code: 'vi-VN' },
  { name: 'Indonesian', code: 'id-ID' },
  { name: 'Russian', code: 'ru-RU', nonlatin: true },
  { name: 'Ukrainian', code: 'uk-UA', nonlatin: true },
  { name: 'Greek', code: 'el-GR', nonlatin: true },
  { name: 'Arabic', code: 'ar-SA', nonlatin: true },
  { name: 'Hebrew', code: 'he-IL', nonlatin: true },
  { name: 'Hindi', code: 'hi-IN', nonlatin: true },
  { name: 'Japanese', code: 'ja-JP', nonlatin: true, nospace: true },
  { name: 'Korean', code: 'ko-KR', nonlatin: true },
  { name: 'Chinese (Mandarin)', code: 'zh-CN', nonlatin: true, nospace: true },
  { name: 'Thai', code: 'th-TH', nonlatin: true, nospace: true },
  { name: 'English', code: 'en-US' },
];

// Accented letters for the on-screen key row (lowercase; Shift gives uppercase).
LT.ACCENTS = {
  Spanish: 'á é í ó ú ñ ü ¿ ¡',
  French: 'é è ê ë à â ç î ï ô û ù ü œ « »',
  German: 'ä ö ü ß',
  Italian: 'à è é ì ò ù',
  Portuguese: 'á â ã à ç é ê í ó ô õ ú',
  Dutch: 'é ë ï ó ö ü',
  Swedish: 'å ä ö é',
  Norwegian: 'æ ø å é',
  Danish: 'æ ø å é',
  Polish: 'ą ć ę ł ń ó ś ź ż',
  Turkish: 'ç ğ ı İ ö ş ü',
  Vietnamese: 'ă â đ ê ô ơ ư á à ả ã ạ é è ẻ ẽ ẹ í ì ó ò ú ù ý',
  Indonesian: '',
  English: '',
};

LT.STRICTNESS = [
  { id: 'relaxed', label: 'Relaxed' },
  { id: 'normal', label: 'Normal' },
  { id: 'strict', label: 'Strict' },
];

LT.lang = (name) =>
  LT.LANGS.find((l) => l.name.toLowerCase() === String(name || '').trim().toLowerCase()) || { name, code: '' };

LT.LEVELS = [
  { id: 'beginner', label: 'Beginner', rule: 'Beginner (A1-A2): very common words, present tense, sentences under 10 words.' },
  { id: 'intermediate', label: 'Intermediate', rule: 'Intermediate (B1-B2): everyday vocabulary, past and future tenses, natural but clear sentences.' },
  { id: 'advanced', label: 'Advanced', rule: 'Advanced (C1+): natural native-speed language, idioms and colloquial phrasing.' },
];

// Avatars are drawn in ui.js from these traits.
LT.SCENARIOS = [
  {
    id: 'cafe', title: 'At the café', role: 'Barista',
    blurb: 'Order a drink and something to eat',
    setting: "A small neighborhood café. You are the barista: greet the learner, take their order, suggest items, tell them the price and take payment.",
    avatar: { skin: '#c68a64', hair: 'short', hairColor: '#2d1b12', shirt: '#f49ac1', mustache: true },
  },
  {
    id: 'hotel', title: 'Hotel check-in', role: 'Receptionist',
    blurb: 'Check in, ask about breakfast and wifi',
    setting: 'A hotel front desk. You are the receptionist checking the learner in: name, reservation, room, breakfast times, wifi, local tips.',
    avatar: { skin: '#f1c6a5', hair: 'bun', hairColor: '#7a4a2a', shirt: '#5b8def' },
  },
  {
    id: 'directions', title: 'Lost in the city', role: 'Local',
    blurb: 'Ask for directions to places in town',
    setting: 'A busy street. You are a helpful local the learner stops to ask for directions to a station, museum, pharmacy or restaurant.',
    avatar: { skin: '#8d5a3b', hair: 'curly', hairColor: '#1d1d1d', shirt: '#ffb547' },
  },
  {
    id: 'friend', title: 'New friend', role: 'Student',
    blurb: 'Small talk: names, hobbies, where you are from',
    setting: "A friend's party. You are a friendly student meeting the learner for the first time. Chat about names, where you're from, studies, work and hobbies.",
    avatar: { skin: '#f3d2b8', hair: 'long', hairColor: '#d9a441', shirt: '#7bd389' },
  },
  {
    id: 'market', title: 'At the market', role: 'Vendor',
    blurb: 'Buy fruit and vegetables, ask prices',
    setting: 'An open-air market. You sell fruit and vegetables. Offer produce, give prices by the kilo, and let the learner haggle a little.',
    avatar: { skin: '#e0a77e', hair: 'none', shirt: '#ff7a59', glasses: true, mustache: true },
  },
  {
    id: 'restaurant', title: 'Dinner out', role: 'Waiter',
    blurb: 'Get a table, order, ask for the bill',
    setting: 'A restaurant in the evening. You are the waiter: seat the learner, explain the specials, take the order, handle requests and bring the bill.',
    avatar: { skin: '#f0c08f', hair: 'short', hairColor: '#5a3825', shirt: '#2f3a4a' },
  },
  {
    id: 'doctor', title: 'At the doctor', role: 'Doctor',
    blurb: 'Describe symptoms and understand advice',
    setting: "A doctor's office. You are a calm doctor asking the learner about their symptoms, how long they've had them, and giving simple advice.",
    avatar: { skin: '#6b4329', hair: 'short', hairColor: '#111111', shirt: '#dfe9ef', glasses: true },
  },
  {
    id: 'shopping', title: 'Clothes shopping', role: 'Shop assistant',
    blurb: 'Find your size, try things on, return an item',
    setting: 'A clothing store. You are the shop assistant helping the learner find items, sizes and colors, the fitting rooms, and handling a return.',
    avatar: { skin: '#f6d5c0', hair: 'long', hairColor: '#2b1a10', shirt: '#b28dff' },
  },
  {
    id: 'interview', title: 'Job interview', role: 'Hiring manager',
    blurb: 'Talk about your experience and strengths',
    setting: 'A job interview at a mid-size company. You are the hiring manager asking about experience, strengths, weaknesses and why the learner wants the job.',
    avatar: { skin: '#a8714a', hair: 'bun', hairColor: '#141414', shirt: '#3f6e73', glasses: true },
  },
  {
    id: 'free', title: 'Free talk', role: 'Tutor',
    blurb: 'Chat about anything and ask language questions',
    setting: "A relaxed conversation. You are a friendly tutor chatting about the learner's day, interests and plans, and answering questions about the language.",
    avatar: { skin: '#e9b48a', hair: 'curly', hairColor: '#8a3b12', shirt: '#1cb0c6' },
  },
];

LT.CUSTOM_AVATAR = { skin: '#d9a07a', hair: 'short', hairColor: '#3b2a20', shirt: '#9aa5b1' };
