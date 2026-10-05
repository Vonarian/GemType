// GemType background service worker.
// Owns all Gemini API traffic: the content script never talks to the network
// directly (page CSP would break it); everything is routed through here.

// Cross-browser: alias Firefox's promise-based `browser` to `chrome`. No-op in
// Chrome. (In Firefox this file runs as an event-page background script.)
if (typeof browser !== 'undefined') globalThis.chrome = browser;

try {
  importScripts('storage.js', 'background-helper.js');
} catch (_) {}

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-3.1-flash-lite';

const DEFAULT_SETTINGS = {
  apiKey: '',
  model: DEFAULT_MODEL,
  enabled: true,
  disabledSites: [],
  language: 'auto',
  tone: 'neutral',
  temperature: 0.3,
  topP: 0.95,
  fastZeroShot: true,
  minTextLength: 15,
};

// ---------------------------------------------------------------------------
// Settings

async function getSettings() {
  if (typeof GTStorage !== 'undefined' && GTStorage.getSettings) {
    return GTStorage.getSettings();
  }
  const stored = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
}

// ---------------------------------------------------------------------------
// Response cache + in-flight dedup. The SW may be killed at any time, which
// just empties the cache — that's fine, it's a cost optimization only.

const cache = new Map(); // key -> { corrections }
const inFlight = new Map(); // key -> Promise
const CACHE_MAX = 200;

function cacheKey(kind, model, text) {
  return `${kind}:${model}:${text}`;
}

function cachePut(key, value) {
  if (cache.size >= CACHE_MAX) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, value);
}

// ---------------------------------------------------------------------------
// Rate limiting: never run more than one Gemini call at a time, and back off
// on 429 so a free-tier key degrades gracefully instead of erroring.

let backoffUntil = 0;
let queue = Promise.resolve();

function enqueue(fn) {
  const run = queue.then(fn, fn);
  // Keep the chain alive even when a call rejects.
  queue = run.catch(() => {});
  return run;
}

async function callGemini(settings, body) {
  const wait = backoffUntil - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));

  const url = `${API_BASE}/${encodeURIComponent(settings.model)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': settings.apiKey,
    },
    body: JSON.stringify(body),
  });

  if (res.status === 429) {
    backoffUntil = Date.now() + 20000;
    throw new Error('RATE_LIMITED');
  }
  if (res.status === 400 || res.status === 403) {
    const detail = await res.json().catch(() => null);
    const msg = detail?.error?.message || `HTTP ${res.status}`;
    throw new Error(`API_KEY_ERROR: ${msg}`);
  }
  if (!res.ok) {
    throw new Error(`HTTP_${res.status}`);
  }

  backoffUntil = 0;
  const data = await res.json();
  const text = typeof extractCandidateText === 'function'
    ? extractCandidateText(data)
    : data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') {
    throw new Error('EMPTY_RESPONSE');
  }
  return text;
}

// ---------------------------------------------------------------------------
// Grammar checking

const CHECK_SCHEMA = {
  type: 'OBJECT',
  properties: {
    corrections: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          original: { type: 'STRING' },
          replacement: { type: 'STRING' },
          explanation: { type: 'STRING' },
          type: {
            type: 'STRING',
            enum: ['grammar', 'spelling', 'punctuation', 'style'],
          },
        },
        required: ['original', 'replacement', 'explanation', 'type'],
      },
    },
  },
  required: ['corrections'],
};

function checkSystemPrompt(settings) {
  const lang =
    settings.language === 'auto'
      ? 'Detect the language of the text and check it in that language.'
      : `The text is in ${settings.language}.`;
  return [
    'You are a thorough proofreader embedded in a browser extension. Find EVERY error in the text.',
    'Error categories to report:',
    '- grammar: subject-verb agreement, wrong verb tense or form, pronoun case, wrong or missing articles/prepositions, word order, and RUN-ON SENTENCES or comma splices — two sentences joined without punctuation is always an error (fix by adding the missing period or comma, e.g. "inviting me I think" -> "inviting me. I think").',
    '- spelling: misspelled words and wrong homophones (their/there, you\'re/your, its/it\'s).',
    '- punctuation: missing, extra, or misplaced punctuation; wrong spacing around punctuation (e.g. a space before a period like "this ." -> "this."); missing capitalization at sentence starts.',
    '- style: phrasing that is clearly awkward, confusing, or unidiomatic — something a fluent writer would not write (e.g. "a good idea how to implement this" -> "a good idea; how should we implement this?"). Suggest a natural rewording.',
    'Do NOT flag: personal names, slang or informal tone that is written correctly, or pure taste preferences.',
    'Judge every SENTENCE as a whole, not just individual words: sentence boundaries, fragments, missing subjects or verbs, and word order all count.',
    'Always prefer the MINIMAL edit that makes the sentence grammatically correct — keep the author\'s original words, order, and tone; never rephrase beyond what correctness requires.',
    'For each error, "original" must be the EXACT substring copied verbatim from the text (the shortest span containing the error, extended with surrounding words only if needed to make it unique), and "replacement" the corrected version of that same span.',
    'Errors must not overlap: if problems are adjacent, merge them into one correction spanning both.',
    'Keep "explanation" under 12 words.',
    'If the text truly has no errors, return an empty corrections array.',
    lang,
  ].join('\n');
}

async function checkText(text) {
  const settings = await getSettings();
  const minLen = parseInt(settings.minTextLength, 10) || 15;
  if (!text || text.trim().length < minLen) {
    return { corrections: [] };
  }
  if (!settings.apiKey) throw new Error('NO_API_KEY');

  const key = cacheKey('check', settings.model, text);
  if (cache.has(key)) return cache.get(key);
  if (inFlight.has(key)) return inFlight.get(key);

  const promise = enqueue(async () => {
    const raw = await callGemini(settings, {
      contents: [{ parts: [{ text: `TEXT TO CHECK:\n${text}` }] }],
      systemInstruction: { parts: [{ text: checkSystemPrompt(settings) }] },
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: CHECK_SCHEMA,
      },
    });
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('BAD_JSON');
    }
    const corrections = (parsed.corrections || []).filter(
      (c) =>
        c &&
        typeof c.original === 'string' &&
        typeof c.replacement === 'string' &&
        c.original !== c.replacement &&
        text.includes(c.original)
    );
    const result = { corrections };
    cachePut(key, result);
    return result;
  }).finally(() => inFlight.delete(key));

  inFlight.set(key, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Refine (rewrite selection)

const REFINE_PROMPTS = {
  improve:
    'Rewrite the text to be clearer and better written while keeping the tone and meaning:',
  fix: 'Correct all spelling, punctuation, and grammar mistakes while preserving voice:',
  shorten:
    'Make this text significantly shorter and punchier without losing essential facts:',
  concise:
    'Make this text significantly shorter and punchier without losing essential facts:',
  formal:
    'Rewrite this in a professional, polished, and formal tone:',
  casual: 'Rewrite the text in a friendly, casual, conversational tone:',
};

function resolvePrompt(settings, action, presetId) {
  const presets = Array.isArray(settings?.customPresets) ? settings.customPresets : [];
  const targetId = presetId || action;

  if (targetId) {
    const found = presets.find(
      (p) =>
        p &&
        (p.id === targetId ||
          (typeof p.label === 'string' &&
            p.label.toLowerCase() === String(targetId).toLowerCase()))
    );
    if (found && typeof found.prompt === 'string' && found.prompt.trim()) {
      return found.prompt.trim();
    }
    if (REFINE_PROMPTS[targetId]) {
      return REFINE_PROMPTS[targetId];
    }
  }

  if (action && typeof action === 'string' && !REFINE_PROMPTS[action]) {
    return action.trim();
  }

  return REFINE_PROMPTS.improve;
}

const REFINE_SCHEMA = {
  type: 'OBJECT',
  properties: { rewritten: { type: 'STRING' } },
  required: ['rewritten'],
};

async function refineText(text, action, presetId) {
  const settings = await getSettings();
  if (!settings.apiKey) throw new Error('NO_API_KEY');

  const prompt = resolvePrompt(settings, action, presetId);
  const promptKey = presetId || action || 'improve';

  const key = cacheKey(`refine:${promptKey}`, settings.model, text);
  if (cache.has(key)) return cache.get(key);

  return enqueue(async () => {
    const systemInstruction =
      settings.systemInstruction ||
      (typeof GTStorage !== 'undefined' && GTStorage.DEFAULT_SYSTEM_INSTRUCTION
        ? GTStorage.DEFAULT_SYSTEM_INSTRUCTION
        : 'You are an expert writing assistant. Rewrite the provided text according to instructions. Output ONLY the final replacement text without notes, preambles, or conversational filler.');

    const genConfig =
      typeof buildGenerationConfig === 'function'
        ? buildGenerationConfig(
            settings.model,
            settings.temperature,
            settings.topP,
            settings.fastZeroShot
          )
        : {
            temperature: 0.4,
            responseMimeType: 'application/json',
            responseSchema: REFINE_SCHEMA,
          };

    const raw = await callGemini(settings, {
      contents: [
        {
          role: 'user',
          parts: [{ text: `${prompt}\n\n"${text}"` }],
        },
      ],
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
      generationConfig: genConfig,
    });

    const rewritten =
      typeof parseRewrittenText === 'function'
        ? parseRewrittenText(raw)
        : (() => {
            let parsed;
            try {
              parsed = JSON.parse(raw);
            } catch {
              throw new Error('BAD_JSON');
            }
            return parsed.rewritten;
          })();

    if (!rewritten || (typeof rewritten === 'string' && !rewritten.trim())) {
      throw new Error('EMPTY_RESPONSE');
    }
    const result = { rewritten: rewritten.trim() };
    cachePut(key, result);
    return result;
  });
}

// ---------------------------------------------------------------------------
// Message routing

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const handlers = {
      CHECK_TEXT: () => checkText(msg.text),
      REFINE_TEXT: () => refineText(msg.text, msg.action, msg.presetId),
      GET_SETTINGS: () => getSettings(),
      OPEN_OPTIONS: () => chrome.runtime.openOptionsPage().then(() => true),
    };
    const handler = handlers[msg?.type];
    if (!handler) return false;

    handler()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true; // async response
  });
}

// ---------------------------------------------------------------------------
// Keyboard shortcut commands

if (typeof chrome !== 'undefined' && chrome.commands?.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'trigger_rewrite') {
      try {
        const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        const tab = tabs[0] || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
        if (tab?.id) {
          chrome.tabs.sendMessage(tab.id, { type: 'COMMAND_TRIGGER_REWRITE' }).catch(() => {});
        }
      } catch (_) {}
    }
  });
}

// ---------------------------------------------------------------------------
// Context menu: refine the current selection from a right-click.

async function updateContextMenus(settings) {
  if (typeof chrome === 'undefined' || !chrome.contextMenus) return;
  const s = settings || (await getSettings());
  const presets =
    Array.isArray(s?.customPresets) && s.customPresets.length > 0
      ? s.customPresets
      : (typeof GTStorage !== 'undefined' && GTStorage.DEFAULT_PRESETS) || [
          { id: 'improve', label: 'Improve' },
          { id: 'fix', label: 'Fix & Polish' },
          { id: 'concise', label: 'Concise' },
          { id: 'formal', label: 'Formal' },
          { id: 'casual', label: 'Casual' },
        ];

  const rebuild = () => {
    chrome.contextMenus.create({
      id: 'gemtype-root',
      title: 'TypeSpark',
      contexts: ['selection'],
    });
    for (const preset of presets) {
      const id = preset.id || preset.action;
      const title = preset.label || preset.name || id;
      chrome.contextMenus.create({
        id: `gemtype-${id}`,
        parentId: 'gemtype-root',
        title,
        contexts: ['selection'],
      });
    }
  };

  return new Promise((resolve) => {
    let called = false;
    const done = () => {
      if (called) return;
      called = true;
      if (chrome.runtime?.lastError) {}
      rebuild();
      resolve();
    };

    try {
      const res = chrome.contextMenus.removeAll(done);
      if (res && typeof res.then === 'function') {
        res.then(done, done);
      }
    } catch (_) {
      done();
    }
  });
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener(() => {
    getSettings().then((s) => updateContextMenus(s)).catch(() => {});
  });
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    getSettings().then((s) => updateContextMenus(s)).catch(() => {});
  });
}

if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' && area !== 'sync') return;
    if (changes.settings || changes.apiKey) {
      cache.clear();
    }
    if (changes.settings) {
      getSettings().then((s) => updateContextMenus(s)).catch(() => {});
    }
  });
}

if (typeof chrome !== 'undefined' && chrome.contextMenus?.onClicked) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id || !info.menuItemId || typeof info.menuItemId !== 'string') return;
    if (!info.menuItemId.startsWith('gemtype-')) return;
    const action = info.menuItemId.replace('gemtype-', '');
    if (action === 'root') return;
    chrome.tabs.sendMessage(tab.id, { type: 'CONTEXT_REFINE', action, presetId: action }).catch(() => {});
  });
}

// ---------------------------------------------------------------------------
// Exports for unit testing

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getSettings,
    callGemini,
    checkText,
    refineText,
    resolvePrompt,
    REFINE_PROMPTS,
    updateContextMenus,
    cache,
  };
}
