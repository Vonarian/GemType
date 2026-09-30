const test = require('node:test');
const assert = require('node:assert');

// ---------------------------------------------------------------------------
// Mock Environment Setup for Threshold Tests
// ---------------------------------------------------------------------------

function setupMockEnv() {
  const sentMessages = [];
  const listeners = {
    storageChanged: [],
    runtimeMessage: [],
  };

  const mockStorage = {
    local: {
      get: async () => ({ settings: {} }),
      set: async () => {},
    },
    sync: {
      get: async () => ({ settings: {} }),
      set: async () => {},
    },
    onChanged: {
      addListener: (fn) => listeners.storageChanged.push(fn),
    },
  };

  globalThis.chrome = {
    storage: mockStorage,
    runtime: {
      onMessage: {
        addListener: (fn) => listeners.runtimeMessage.push(fn),
      },
      sendMessage: async (msg) => {
        sentMessages.push(msg);
        return { ok: true, result: { corrections: [] } };
      },
    },
  };

  class MockField {
    constructor(val = '') {
      this.value = val;
      this.isConnected = true;
      this.listeners = {};
    }
    addEventListener(evt, fn) {
      if (!this.listeners[evt]) this.listeners[evt] = [];
      this.listeners[evt].push(fn);
    }
    removeEventListener(evt, fn) {
      if (!this.listeners[evt]) return;
      this.listeners[evt] = this.listeners[evt].filter((f) => f !== fn);
    }
    dispatchEvent(evt) {
      const list = (this.listeners[evt.type || evt] || []).slice();
      for (const fn of list) fn(evt);
    }
  }

  class MockOverlay {
    constructor(field, controller) {
      this.field = field;
      this.controller = controller;
      this.corrections = [];
      this.state = 'idle';
      this.stateKind = null;
    }
    setCorrections(corrs) {
      this.corrections = corrs;
    }
    setState(state, kind = null) {
      this.state = state;
      this.stateKind = kind;
    }
    destroy() {}
  }

  const GT = {
    FieldOverlay: MockOverlay,
    extract: (field) => ({ text: field.value }),
    debounce: (fn) => {
      const d = (...args) => fn(...args);
      d.cancel = () => {};
      return d;
    },
    sendMessage: async (msg) => {
      sentMessages.push(msg);
      return { ok: true, result: { corrections: [] } };
    },
    locateCorrections: (text, list) => list,
    sentenceRangeAt: (text, idx) => {
      // Simple sentence splitter for testing
      const start = Math.max(0, text.lastIndexOf('.', Math.max(0, idx - 1)) + 1);
      let end = text.indexOf('.', idx);
      if (end === -1) end = text.length;
      else end += 1;
      return { start, end };
    },
    refine: {
      init: () => {},
      hide: () => {},
    },
    ui: {
      toast: () => {},
    },
  };

  globalThis.GT = GT;
  globalThis.document = {
    activeElement: null,
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  return {
    sentMessages,
    MockField,
    MockOverlay,
    GT,
  };
}

// ===========================================================================
// Test Group 1: getMinTextLength helper logic
// ===========================================================================

test('content.js: getMinTextLength returns correct threshold for various settings', () => {
  setupMockEnv();
  delete require.cache[require.resolve('../extension/src/content/content.js')];
  const content = require('../extension/src/content/content.js');
  const getMinTextLength = content.getMinTextLength || GT.getMinTextLength;

  assert.strictEqual(typeof getMinTextLength, 'function', 'getMinTextLength should be a function');

  // Case 1: settings is null/undefined -> default 15
  GT.state.settings = null;
  assert.strictEqual(getMinTextLength(), 15, 'null settings should default to 15');

  GT.state.settings = {};
  assert.strictEqual(getMinTextLength(), 15, 'missing minTextLength should default to 15');

  // Case 2: valid custom number
  GT.state.settings = { minTextLength: 25 };
  assert.strictEqual(getMinTextLength(), 25, 'custom minTextLength 25 should return 25');

  // Case 3: numeric string
  GT.state.settings = { minTextLength: '30' };
  assert.strictEqual(getMinTextLength(), 30, 'string "30" should parse to 30');

  // Case 4: invalid / non-positive numbers fallback to 15
  GT.state.settings = { minTextLength: 0 };
  assert.strictEqual(getMinTextLength(), 15, 'minTextLength 0 should fallback to 15');

  GT.state.settings = { minTextLength: -10 };
  assert.strictEqual(getMinTextLength(), 15, 'negative minTextLength should fallback to 15');

  GT.state.settings = { minTextLength: 'invalid' };
  assert.strictEqual(getMinTextLength(), 15, 'invalid string should fallback to 15');

  GT.state.settings = { minTextLength: NaN };
  assert.strictEqual(getMinTextLength(), 15, 'NaN should fallback to 15');

  // Case 5: boundary valid values
  GT.state.settings = { minTextLength: 1 };
  assert.strictEqual(getMinTextLength(), 1, 'minTextLength 1 should return 1');

  GT.state.settings = { minTextLength: 5 };
  assert.strictEqual(getMinTextLength(), 5, 'minTextLength 5 should return 5');
});

// ===========================================================================
// Test Group 2: background.js checkText defense-in-depth threshold guard
// ===========================================================================

test('background.js: checkText returns empty corrections when text length < minTextLength without calling Gemini', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;

  globalThis.fetch = async () => {
    fetchCalled = true;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ corrections: [] }) }] } }],
      }),
    };
  };

  try {
    delete require.cache[require.resolve('../extension/src/background.js')];
    const bg = require('../extension/src/background.js');

    // Mock GTStorage with default threshold (15) and valid apiKey
    globalThis.GTStorage = {
      getSettings: async () => ({
        apiKey: 'test-api-key',
        model: 'gemini-3.1-flash-lite',
        minTextLength: 15,
      }),
    };

    // Subtest 2.1: null, empty, whitespace text
    fetchCalled = false;
    let res = await bg.checkText('');
    assert.deepStrictEqual(res, { corrections: [] });
    assert.strictEqual(fetchCalled, false, 'fetch should not be called for empty string');

    fetchCalled = false;
    res = await bg.checkText('   ');
    assert.deepStrictEqual(res, { corrections: [] });
    assert.strictEqual(fetchCalled, false, 'fetch should not be called for whitespace string');

    // Subtest 2.2: text shorter than 15 chars (e.g. 10 chars)
    fetchCalled = false;
    res = await bg.checkText('short text'); // 10 chars
    assert.deepStrictEqual(res, { corrections: [] });
    assert.strictEqual(fetchCalled, false, 'fetch should not be called for 10-char text when threshold is 15');

    // Subtest 2.3: text shorter than 15 chars even without API key should not throw NO_API_KEY
    globalThis.GTStorage = {
      getSettings: async () => ({
        apiKey: '',
        model: 'gemini-3.1-flash-lite',
        minTextLength: 15,
      }),
    };
    fetchCalled = false;
    res = await bg.checkText('short text');
    assert.deepStrictEqual(res, { corrections: [] });
    assert.strictEqual(fetchCalled, false, 'fetch should not be called when under threshold even if apiKey is missing');

    // Subtest 2.4: custom threshold 25
    globalThis.GTStorage = {
      getSettings: async () => ({
        apiKey: 'test-api-key',
        model: 'gemini-3.1-flash-lite',
        minTextLength: 25,
      }),
    };
    fetchCalled = false;
    res = await bg.checkText('This is 20 chars long'); // 21 chars trimmed < 25
    assert.deepStrictEqual(res, { corrections: [] });
    assert.strictEqual(fetchCalled, false, 'fetch should not be called for 21-char text when threshold is 25');

    // Subtest 2.5: text meeting custom threshold 25 DOES call Gemini
    fetchCalled = false;
    res = await bg.checkText('This text is 28 chars long!!');
    assert.strictEqual(fetchCalled, true, 'fetch SHOULD be called for 28-char text when threshold is 25');

    // Subtest 2.6: text meeting default threshold 15 DOES call Gemini
    globalThis.GTStorage = {
      getSettings: async () => ({
        apiKey: 'test-api-key',
        model: 'gemini-3.1-flash-lite',
        minTextLength: 15,
      }),
    };
    fetchCalled = false;
    res = await bg.checkText('Exact fifteen!!'); // 15 chars
    assert.strictEqual(fetchCalled, true, 'fetch SHOULD be called for 15-char text when threshold is 15');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ===========================================================================
// Test Group 3: FieldController.check() and sentenceRecheck() in content script
// ===========================================================================

test('content.js: FieldController.check() respects minTextLength setting', async () => {
  const { sentMessages, MockField, GT } = setupMockEnv();

  delete require.cache[require.resolve('../extension/src/content/content.js')];
  const content = require('../extension/src/content/content.js');
  const FieldController = content.FieldController || GT.FieldController;

  assert.strictEqual(typeof FieldController, 'function', 'FieldController should be available');

  // Subtest 3.1: Default minTextLength (15) — input shorter than 15 does not send CHECK_TEXT
  GT.state.settings = { enabled: true, minTextLength: 15 };
  sentMessages.length = 0;

  const shortField = new MockField('');
  const ctrl1 = new FieldController(shortField);
  shortField.value = 'Short text'; // 10 chars < 15
  await ctrl1.check();

  assert.strictEqual(sentMessages.length, 0, 'CHECK_TEXT should not be sent for text < 15 chars');
  assert.strictEqual(ctrl1.overlay.state, 'idle', 'Overlay state should be idle');
  assert.deepStrictEqual(ctrl1.corrections, [], 'Corrections should be empty');

  // Subtest 3.2: Default minTextLength (15) — input >= 15 chars triggers CHECK_TEXT
  sentMessages.length = 0;
  const longField = new MockField('');
  const ctrl2 = new FieldController(longField);
  longField.value = 'This is 16 chars'; // 16 chars >= 15
  await ctrl2.check();

  assert.strictEqual(sentMessages.length, 1, 'CHECK_TEXT should be sent for text >= 15 chars');
  assert.strictEqual(sentMessages[0].type, 'CHECK_TEXT');
  assert.strictEqual(sentMessages[0].text, 'This is 16 chars');

  // Subtest 3.3: Pre-existing content in field when constructed
  sentMessages.length = 0;
  const preShort = new MockField('Under fifteen'); // 13 chars
  new FieldController(preShort);
  assert.strictEqual(sentMessages.length, 0, 'Initial check on pre-existing short content should not trigger CHECK_TEXT');

  sentMessages.length = 0;
  const preLong = new MockField('Over fifteen characters!'); // 24 chars
  new FieldController(preLong);
  assert.strictEqual(sentMessages.length, 1, 'Initial check on pre-existing long content should trigger CHECK_TEXT');

  // Subtest 3.4: Custom minTextLength (25)
  GT.state.settings = { enabled: true, minTextLength: 25 };
  sentMessages.length = 0;

  // 18 chars: passed old 8 or default 15 threshold, but below 25
  const mediumField = new MockField('');
  const ctrl3 = new FieldController(mediumField);
  mediumField.value = 'This is 18 chars..';
  await ctrl3.check();

  assert.strictEqual(sentMessages.length, 0, 'CHECK_TEXT should not be sent for 18 chars when threshold is 25');

  // 27 chars: meets 25 threshold
  sentMessages.length = 0;
  const veryLongField = new MockField('');
  const ctrl4 = new FieldController(veryLongField);
  veryLongField.value = 'This text is 27 chars long!';
  await ctrl4.check();

  assert.strictEqual(sentMessages.length, 1, 'CHECK_TEXT should be sent for 27 chars when threshold is 25');
  assert.strictEqual(sentMessages[0].text, 'This text is 27 chars long!');
});

test('content.js: FieldController.sentenceRecheck() respects minTextLength setting', async () => {
  const { sentMessages, MockField, GT } = setupMockEnv();

  delete require.cache[require.resolve('../extension/src/content/content.js')];
  const content = require('../extension/src/content/content.js');
  const FieldController = content.FieldController || GT.FieldController;

  GT.state.settings = { enabled: true, minTextLength: 20 };
  sentMessages.length = 0;

  // Text contains two sentences: first sentence is short (11 chars), second sentence is long (35 chars)
  const field = new MockField('Too short. This second sentence is long enough to check.');
  const ctrl = new FieldController(field);
  sentMessages.length = 0; // Clear check() on init

  // Recheck around index 3 (inside "Too short.")
  await ctrl.sentenceRecheck(3);
  assert.strictEqual(sentMessages.length, 0, 'sentenceRecheck should not send CHECK_TEXT for sentence < minTextLength (20)');

  // Recheck around index 20 (inside "This second sentence is long enough to check.")
  await ctrl.sentenceRecheck(20);
  assert.strictEqual(sentMessages.length, 1, 'sentenceRecheck should send CHECK_TEXT for sentence >= minTextLength (20)');
  assert.strictEqual(sentMessages[0].type, 'CHECK_TEXT');
  assert.ok(sentMessages[0].text.includes('This second sentence is long enough'));
});
