const test = require('node:test');
const assert = require('node:assert');

const {
  extractCandidateText,
  buildGenerationConfig,
  parseRewrittenText,
} = require('../extension/src/background-helper.js');

test('extractCandidateText: extracts non-thought answer part when thinking is present', () => {
  const mockResponse = {
    candidates: [
      {
        content: {
          parts: [
            { thought: true, text: 'Let me think about how to make this formal...' },
            { text: '{"rewritten": "Dear Sir, I am writing to confirm..."}' },
          ],
        },
      },
    ],
  };
  const extracted = extractCandidateText(mockResponse);
  assert.strictEqual(extracted, '{"rewritten": "Dear Sir, I am writing to confirm..."}');
});

test('extractCandidateText: handles standard response without thoughts and edge cases', () => {
  const standardResponse = {
    candidates: [
      {
        content: {
          parts: [{ text: '{"rewritten": "Simple output"}' }],
        },
      },
    ],
  };
  assert.strictEqual(extractCandidateText(standardResponse), '{"rewritten": "Simple output"}');

  // Fallback to last part if all parts have thought
  const allThoughtResponse = {
    candidates: [
      {
        content: {
          parts: [
            { thought: true, text: 'Thought 1' },
            { thought: true, text: 'Thought 2' },
          ],
        },
      },
    ],
  };
  assert.strictEqual(extractCandidateText(allThoughtResponse), 'Thought 2');

  // Null/empty responses
  assert.strictEqual(extractCandidateText(null), undefined);
  assert.strictEqual(extractCandidateText({}), undefined);
  assert.strictEqual(extractCandidateText({ candidates: [] }), undefined);
});

test('buildGenerationConfig: configures correct parameters and adaptive thinking', () => {
  const config3 = buildGenerationConfig('gemini-3.1-flash-lite', 0.45, 0.9, true);
  assert.strictEqual(config3.temperature, 0.45);
  assert.strictEqual(config3.topP, 0.9);
  assert.strictEqual(config3.maxOutputTokens, 2048);
  assert.strictEqual(config3.responseMimeType, 'application/json');
  assert.deepStrictEqual(config3.responseSchema, {
    type: 'OBJECT',
    properties: { rewritten: { type: 'STRING' } },
    required: ['rewritten'],
  });
  assert.deepStrictEqual(config3.thinkingConfig, { thinkingLevel: 'MINIMAL' });

  const config25 = buildGenerationConfig('gemini-2.5-flash', 0.2, 0.95, true);
  assert.deepStrictEqual(config25.thinkingConfig, { thinkingBudget: 0 });

  const config20 = buildGenerationConfig('gemini-2.0-flash', 0.2, 0.95, true);
  assert.strictEqual(config20.thinkingConfig, undefined);

  // When fastZeroShot is false, thinkingConfig is omitted even on gemini-3
  const config3Disabled = buildGenerationConfig('gemini-3.1-flash-lite', 0.3, 0.95, false);
  assert.strictEqual(config3Disabled.thinkingConfig, undefined);

  // Custom model
  const configCustom = buildGenerationConfig('custom-model-id', 0.3, 0.95, true);
  assert.strictEqual(configCustom.thinkingConfig, undefined);
});

test('parseRewrittenText: handles valid JSON, code fences, quotes, and fallback strings', () => {
  // Valid JSON object
  assert.strictEqual(
    parseRewrittenText('{"rewritten": "Dear Sir, please find attached."}'),
    'Dear Sir, please find attached.'
  );

  // Markdown code fence with JSON
  assert.strictEqual(
    parseRewrittenText('```json\n{"rewritten": "Markdown fenced output."}\n```'),
    'Markdown fenced output.'
  );

  // Markdown fence with raw text
  assert.strictEqual(
    parseRewrittenText('```\nRaw text inside code fence\n```'),
    'Raw text inside code fence'
  );

  // Quoted string
  assert.strictEqual(
    parseRewrittenText('"Quoted string result"'),
    'Quoted string result'
  );

  // Malformed JSON with "rewritten" field
  assert.strictEqual(
    parseRewrittenText('Some prefix {"rewritten": "Extracted field"} some suffix'),
    'Extracted field'
  );

  // Plain string without JSON
  assert.strictEqual(
    parseRewrittenText('Plain text replacement'),
    'Plain text replacement'
  );

  // Empty or invalid input
  assert.strictEqual(parseRewrittenText(''), '');
  assert.strictEqual(parseRewrittenText(null), '');
  assert.strictEqual(parseRewrittenText(undefined), '');
});

test('resolvePrompt: resolves preset by id, label, built-in action, or custom prompt', () => {
  const { resolvePrompt, REFINE_PROMPTS } = require('../extension/src/background.js');

  const settings = {
    customPresets: [
      { id: 'custom_1', label: 'Pirate Talk', prompt: 'Rewrite this like a pirate:' },
      { id: 'formal', label: 'Formal', prompt: 'Custom formal prompt:' },
    ],
  };

  // Resolve by custom preset ID
  assert.strictEqual(resolvePrompt(settings, null, 'custom_1'), 'Rewrite this like a pirate:');
  // Resolve by preset label
  assert.strictEqual(resolvePrompt(settings, 'pirate talk', null), 'Rewrite this like a pirate:');
  // Overridden built-in preset in customPresets
  assert.strictEqual(resolvePrompt(settings, 'formal', null), 'Custom formal prompt:');
  // Built-in fallback
  assert.strictEqual(resolvePrompt({}, 'shorten', null), REFINE_PROMPTS.shorten);
  // Freeform action prompt string
  assert.strictEqual(resolvePrompt({}, 'Translate to French:', null), 'Translate to French:');
  // Unknown empty fallback
  assert.strictEqual(resolvePrompt({}, null, null), REFINE_PROMPTS.improve);
});

test('refineText: builds complete payload with system instruction and generation config', async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;

  let capturedUrl = null;
  let capturedOptions = null;

  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                { thought: true, text: 'Thinking...' },
                { text: '{"rewritten": "Polished text result."}' },
              ],
            },
          },
        ],
      }),
    };
  };

  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({
          settings: {
            apiKey: 'test-api-key-123',
            model: 'gemini-3.1-flash-lite',
            temperature: 0.5,
            topP: 0.85,
            fastZeroShot: true,
            systemInstruction: 'Custom system instruction.',
            customPresets: [
              { id: 'punchy', label: 'Punchy', prompt: 'Make this punchy:' },
            ],
          },
        }),
      },
      sync: {
        get: async () => ({}),
      },
    },
    runtime: {
      onMessage: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
    },
    contextMenus: {
      removeAll: () => {},
      create: () => {},
      onClicked: { addListener: () => {} },
    },
    commands: {
      onCommand: { addListener: () => {} },
    },
  };

  try {
    delete require.cache[require.resolve('../extension/src/background.js')];
    const { refineText } = require('../extension/src/background.js');
    const result = await refineText('Original input text', null, 'punchy');

    assert.strictEqual(result.rewritten, 'Polished text result.');
    assert.strictEqual(
      capturedUrl,
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent'
    );
    assert.strictEqual(capturedOptions.headers['x-goog-api-key'], 'test-api-key-123');

    const body = JSON.parse(capturedOptions.body);
    assert.strictEqual(body.contents[0].role, 'user');
    assert.strictEqual(body.contents[0].parts[0].text, 'Make this punchy:\n\n"Original input text"');
    assert.strictEqual(body.systemInstruction.parts[0].text, 'Custom system instruction.');
    assert.strictEqual(body.generationConfig.temperature, 0.5);
    assert.strictEqual(body.generationConfig.topP, 0.85);
    assert.deepStrictEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'MINIMAL' });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test('commands.onCommand: dispatches COMMAND_TRIGGER_REWRITE to active tab', async () => {
  let commandListener = null;
  let sentMessage = null;
  let sentTabId = null;

  globalThis.chrome = {
    storage: { local: { get: async () => ({}) }, sync: { get: async () => ({}) } },
    runtime: { onMessage: { addListener: () => {} }, onInstalled: { addListener: () => {} } },
    contextMenus: { removeAll: () => {}, create: () => {}, onClicked: { addListener: () => {} } },
    commands: {
      onCommand: {
        addListener: (fn) => {
          commandListener = fn;
        },
      },
    },
    tabs: {
      query: async () => [{ id: 42, active: true }],
      sendMessage: async (tabId, msg) => {
        sentTabId = tabId;
        sentMessage = msg;
      },
    },
  };

  delete require.cache[require.resolve('../extension/src/background.js')];
  require('../extension/src/background.js');

  assert.ok(typeof commandListener === 'function', 'Command listener should be registered');
  await commandListener('trigger_rewrite');

  assert.strictEqual(sentTabId, 42);
  assert.deepStrictEqual(sentMessage, { type: 'COMMAND_TRIGGER_REWRITE' });
});
