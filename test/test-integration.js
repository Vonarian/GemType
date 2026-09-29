const test = require('node:test');
const assert = require('node:assert');

// ---------------------------------------------------------------------------
// Mock Environment Setup for Integration Tests
// ---------------------------------------------------------------------------

function createMockChromeStorage() {
  const syncStore = {};
  const localStore = {};
  return {
    sync: {
      get: async (keys) => {
        if (typeof keys === 'string') return { [keys]: syncStore[keys] };
        if (Array.isArray(keys)) {
          const res = {};
          for (const k of keys) res[k] = syncStore[k];
          return res;
        }
        return { ...syncStore };
      },
      set: async (obj) => {
        Object.assign(syncStore, obj);
      },
      remove: async (keys) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        for (const k of arr) delete syncStore[k];
      },
      clear: async () => {
        for (const k of Object.keys(syncStore)) delete syncStore[k];
      },
    },
    local: {
      get: async (keys) => {
        if (typeof keys === 'string') return { [keys]: localStore[keys] };
        if (Array.isArray(keys)) {
          const res = {};
          for (const k of keys) res[k] = localStore[k];
          return res;
        }
        return { ...localStore };
      },
      set: async (obj) => {
        Object.assign(localStore, obj);
      },
      remove: async (keys) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        for (const k of arr) delete localStore[k];
      },
      clear: async () => {
        for (const k of Object.keys(localStore)) delete localStore[k];
      },
    },
  };
}

// DOM Element Mock
class MockElement {
  constructor(tag = 'div', className = '') {
    this.tagName = tag.toUpperCase();
    this.className = className;
    this.children = [];
    this.parentElement = null;
    this.listeners = {};
    this.style = {
      setProperty: (k, v) => {
        this.style[k] = v;
      },
    };
    this.dataset = {};
    this.value = '';
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.isConnected = true;
    this._textContent = '';
  }

  get textContent() {
    return this._textContent;
  }

  set textContent(val) {
    this._textContent = String(val);
    if (val === '') {
      this.children.length = 0;
    }
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove() {
    this.isConnected = false;
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }

  querySelector(selector) {
    const nodes = this.querySelectorAll(selector);
    return nodes.length ? nodes[0] : null;
  }

  querySelectorAll(selector) {
    const results = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (
          (selector === 'button' || selector.startsWith('button')) &&
          child.tagName === 'BUTTON'
        ) {
          results.push(child);
        } else if (selector.startsWith('.') && child.className.includes(selector.slice(1))) {
          results.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return results;
  }

  addEventListener(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  removeEventListener(event, fn) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((f) => f !== fn);
  }

  dispatchEvent(event) {
    event.target = event.target || this;
    const fns = (this.listeners[event.type || event] || []).slice();
    for (const fn of fns) fn(event);
    if (event.bubbles && this.parentElement && !event._stopped) {
      this.parentElement.dispatchEvent(event);
    }
  }

  focus() {
    if (globalThis.document) {
      globalThis.document.activeElement = this;
    }
  }

  click() {
    this.dispatchEvent({
      type: 'click',
      bubbles: true,
      preventDefault: () => {},
      stopPropagation: () => {},
    });
  }

  setSelectionRange(start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }

  getBoundingClientRect() {
    return {
      left: 20,
      top: 40,
      right: 220,
      bottom: 80,
      width: 200,
      height: 40,
    };
  }

  contains(other) {
    if (other === this) return true;
    return this.children.some((c) => c.contains?.(other));
  }
}

globalThis.HTMLTextAreaElement = class HTMLTextAreaElement extends MockElement {};
globalThis.HTMLInputElement = class HTMLInputElement extends MockElement {};

function createMockTextarea(initialValue = '') {
  const ta = new globalThis.HTMLTextAreaElement('textarea');
  ta.value = initialValue;
  ta.selectionStart = 0;
  ta.selectionEnd = 0;
  return ta;
}

function setupMockEnvironment() {
  const storage = createMockChromeStorage();
  const listeners = {
    message: [],
    command: [],
  };

  const undoStack = [];
  const redoStack = [];

  const mockDoc = {
    activeElement: null,
    body: new MockElement('body'),
    documentElement: new MockElement('html'),
    createElement: (tag, className) => {
      if (tag.toLowerCase() === 'textarea') return new globalThis.HTMLTextAreaElement('textarea', className);
      if (tag.toLowerCase() === 'input') return new globalThis.HTMLInputElement('input', className);
      return new MockElement(tag, className);
    },
    createTextNode: (txt) => ({ nodeType: 3, data: txt, textContent: txt }),
    listeners: {},
    addEventListener(event, fn, useCapture) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push({ fn, useCapture });
    },
    removeEventListener(event, fn) {
      if (!this.listeners[event]) return;
      this.listeners[event] = this.listeners[event].filter((item) => item.fn !== fn);
    },
    dispatchEvent(event) {
      const list = (this.listeners[event.type || event] || []).slice();
      for (const item of list) item.fn(event);
    },
    execCommand(cmd, showUI, val) {
      const active = mockDoc.activeElement;
      if (cmd === 'insertText') {
        if (!active || typeof active.value !== 'string') return false;
        // Save state for undo
        undoStack.push({
          value: active.value,
          start: active.selectionStart,
          end: active.selectionEnd,
        });
        redoStack.length = 0; // clear redo on new input

        const start = active.selectionStart;
        const end = active.selectionEnd;
        active.value = active.value.slice(0, start) + val + active.value.slice(end);
        active.selectionStart = start + val.length;
        active.selectionEnd = start + val.length;
        active.dispatchEvent({ type: 'input', bubbles: true });
        return true;
      }
      if (cmd === 'undo') {
        if (!undoStack.length || !active) return false;
        const prev = undoStack.pop();
        redoStack.push({
          value: active.value,
          start: active.selectionStart,
          end: active.selectionEnd,
        });
        active.value = prev.value;
        active.selectionStart = prev.start;
        active.selectionEnd = prev.end;
        active.dispatchEvent({ type: 'input', bubbles: true });
        return true;
      }
      if (cmd === 'redo') {
        if (!redoStack.length || !active) return false;
        const next = redoStack.pop();
        undoStack.push({
          value: active.value,
          start: active.selectionStart,
          end: active.selectionEnd,
        });
        active.value = next.value;
        active.selectionStart = next.start;
        active.selectionEnd = next.end;
        active.dispatchEvent({ type: 'input', bubbles: true });
        return true;
      }
      return false;
    },
  };

  let mockSelection = {
    rangeCount: 0,
    isCollapsed: true,
    ranges: [],
    getRangeAt(i) {
      return this.ranges[i] || null;
    },
    removeAllRanges() {
      this.ranges = [];
      this.rangeCount = 0;
      this.isCollapsed = true;
    },
    addRange(r) {
      this.ranges.push(r);
      this.rangeCount = this.ranges.length;
      this.isCollapsed = false;
    },
  };

  globalThis.document = mockDoc;
  globalThis.window = {
    innerWidth: 1024,
    innerHeight: 768,
    getSelection: () => mockSelection,
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  globalThis.chrome = {
    storage,
    runtime: {
      onMessage: {
        addListener: (fn) => listeners.message.push(fn),
      },
      sendMessage: async (msg) => {
        // Will be routed or mocked per test
        return { ok: true };
      },
    },
    commands: {
      onCommand: {
        addListener: (fn) => listeners.command.push(fn),
      },
    },
    contextMenus: {
      removeAll: () => {},
      create: () => {},
      onClicked: { addListener: () => {} },
    },
    tabs: {
      query: async () => [{ id: 1, active: true }],
      sendMessage: async () => ({ ok: true }),
    },
  };

  // Fresh modules
  delete require.cache[require.resolve('../extension/src/storage.js')];
  const { GTStorage } = require('../extension/src/storage.js');
  globalThis.GTStorage = GTStorage;

  delete require.cache[require.resolve('../extension/src/background-helper.js')];
  const bgHelper = require('../extension/src/background-helper.js');

  delete require.cache[require.resolve('../extension/src/content/util.js')];
  const { GT: utilGT } = require('../extension/src/content/util.js');

  delete require.cache[require.resolve('../extension/src/content/overlay.js')];
  const { GT: overlayGT } = require('../extension/src/content/overlay.js');

  const toasts = [];
  const rootElement = new MockElement('div', 'gemtype-shadow-root');

  const GT = {
    ...utilGT,
    ...overlayGT,
    ui: {
      ...overlayGT.ui,
      ensureRoot: () => rootElement,
      toast: (msg) => toasts.push(msg),
    },
    card: overlayGT.card,
    preview: overlayGT.preview,
    state: {
      settings: null,
      enabledHere: () => true,
    },
    debounce: (fn) => {
      const f = (...args) => fn(...args);
      f.cancel = () => {};
      return f;
    },
    sendMessage: (msg) => globalThis.chrome.runtime.sendMessage(msg),
  };

  globalThis.GT = GT;

  delete require.cache[require.resolve('../extension/src/content/refine.js')];
  const { GT: refineGT } = require('../extension/src/content/refine.js');
  GT.refine = refineGT.refine;

  return {
    storage,
    mockDoc,
    mockSelection,
    undoStack,
    redoStack,
    toasts,
    rootElement,
    GT,
    GTStorage,
    bgHelper,
  };
}

// ---------------------------------------------------------------------------
// Acceptance Criterion 1:
// Changing temperature in Settings visibly affects `generationConfig.temperature`
// in outgoing network payloads.
// ---------------------------------------------------------------------------

test('AC 1: changing temperature in Settings visibly affects generationConfig.temperature in outgoing payloads', async () => {
  const { storage, GTStorage } = setupMockEnvironment();

  let capturedRequests = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options) => {
    capturedRequests.push({ url, options, body: JSON.parse(options.body) });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: '{"rewritten": "Temperature test output."}' }],
            },
          },
        ],
      }),
    };
  };

  try {
    delete require.cache[require.resolve('../extension/src/background.js')];
    const { refineText } = require('../extension/src/background.js');

    // 1. Initial temperature: 0.15 (Strict / Grammar)
    await GTStorage.saveSettings({ temperature: 0.15, topP: 0.9 }, 'test-api-key');
    await refineText('Input text for strict temperature test', 'improve');

    assert.strictEqual(capturedRequests.length, 1);
    assert.strictEqual(
      capturedRequests[0].body.generationConfig.temperature,
      0.15,
      'First request must carry temperature 0.15'
    );
    assert.strictEqual(capturedRequests[0].body.generationConfig.topP, 0.9);

    // 2. Change temperature in Settings to 0.70 (Balanced)
    await GTStorage.saveSettings({ temperature: 0.70, topP: 0.8 }, 'test-api-key');
    // Using different text to bypass background response cache
    await refineText('Input text for balanced temperature test', 'improve');

    assert.strictEqual(capturedRequests.length, 2);
    assert.strictEqual(
      capturedRequests[1].body.generationConfig.temperature,
      0.70,
      'Second request must visibly reflect changed temperature 0.70'
    );
    assert.strictEqual(capturedRequests[1].body.generationConfig.topP, 0.8);

    // 3. Change temperature in Settings to 1.45 (Creative)
    await GTStorage.saveSettings({ temperature: 1.45, topP: 0.95 }, 'test-api-key');
    await refineText('Input text for creative temperature test', 'improve');

    assert.strictEqual(capturedRequests.length, 3);
    assert.strictEqual(
      capturedRequests[2].body.generationConfig.temperature,
      1.45,
      'Third request must visibly reflect changed temperature 1.45'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Acceptance Criterion 2:
// Specifying `gemini-3.1-flash-lite` calls the endpoint without `404` or malformed request errors.
// ---------------------------------------------------------------------------

test('AC 2: specifying gemini-3.1-flash-lite calls endpoint without 404 or malformed request errors', async () => {
  const { GTStorage } = setupMockEnvironment();

  let capturedUrl = null;
  let capturedOptions = null;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;

    // Verify URL does not target an old or invalid model
    if (!url.includes('/models/gemini-3.1-flash-lite:generateContent')) {
      return { ok: false, status: 404, statusText: 'Not Found' };
    }

    const payload = JSON.parse(options.body);

    // Check payload structure validity according to Gemini 3.1 specs
    if (!payload.contents || !payload.generationConfig) {
      return { ok: false, status: 400, statusText: 'Malformed request' };
    }

    // Gemini 3 uses thinkingLevel: 'MINIMAL' when fastZeroShot is active
    if (payload.generationConfig.thinkingConfig?.thinkingBudget !== undefined) {
      return {
        ok: false,
        status: 400,
        statusText: 'thinkingBudget is invalid on gemini-3 models; use thinkingLevel',
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                { thought: true, text: 'Analyzing text tone and structure...' },
                { text: '{"rewritten": "Flawless output from gemini-3.1-flash-lite."}' },
              ],
            },
          },
        ],
      }),
    };
  };

  try {
    delete require.cache[require.resolve('../extension/src/background.js')];
    const { refineText } = require('../extension/src/background.js');

    await GTStorage.saveSettings(
      {
        model: 'gemini-3.1-flash-lite',
        fastZeroShot: true,
      },
      'AIzaSyValidGeminiKey'
    );

    const result = await refineText('Text to refine on 3.1 flash lite', 'formal');

    assert.strictEqual(
      capturedUrl,
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent',
      'Target URL must point to gemini-3.1-flash-lite endpoint'
    );
    assert.strictEqual(capturedOptions.headers['x-goog-api-key'], 'AIzaSyValidGeminiKey');

    const body = JSON.parse(capturedOptions.body);
    assert.deepStrictEqual(
      body.generationConfig.thinkingConfig,
      { thinkingLevel: 'MINIMAL' },
      'Gemini 3.1 must use thinkingLevel MINIMAL for zero-shot mode'
    );
    assert.strictEqual(body.generationConfig.responseMimeType, 'application/json');
    assert.strictEqual(result.rewritten, 'Flawless output from gemini-3.1-flash-lite.');

    // Also verify when fastZeroShot is disabled: thinkingConfig is safely omitted without error
    await GTStorage.saveSettings(
      {
        model: 'gemini-3.1-flash-lite',
        fastZeroShot: false,
      },
      'AIzaSyValidGeminiKey'
    );

    await refineText('Another piece of text with thinking allowed', 'formal');
    const body2 = JSON.parse(capturedOptions.body);
    assert.strictEqual(
      body2.generationConfig.thinkingConfig,
      undefined,
      'thinkingConfig should be omitted when fastZeroShot is false'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Acceptance Criterion 3:
// User can add, rename, and delete custom preset pills, and they immediately appear in the floating widget.
// ---------------------------------------------------------------------------

test('AC 3: user can add, rename, and delete custom presets and they immediately appear in floating widget', async () => {
  const { GT, GTStorage } = setupMockEnvironment();

  const textarea = createMockTextarea('Sample paragraph for testing custom preset pills.');
  textarea.setSelectionRange(0, 16);
  textarea.focus();

  // 1. Initial State: Default presets
  const initialSettings = await GTStorage.getSettings();
  GT.state.settings = initialSettings;

  GT.refine.show();
  let bar = GT.refine.getBar();
  assert.ok(bar, 'Toolbar should be open');
  let buttons = bar.querySelectorAll('button');
  assert.strictEqual(buttons.length, 5, 'Should initially have 5 default preset pills');
  GT.refine.hide();

  // 2. ADD a custom preset ("pirate")
  const customListAfterAdd = [
    ...initialSettings.customPresets,
    { id: 'pirate', label: '🏴‍☠️ Pirate', prompt: 'Rewrite like a pirate:' },
  ];
  await GTStorage.saveSettings({ customPresets: customListAfterAdd }, 'key');
  GT.state.settings = await GTStorage.getSettings();

  GT.refine.show();
  bar = GT.refine.getBar();
  buttons = bar.querySelectorAll('button');
  assert.strictEqual(buttons.length, 6, 'Should now render 6 preset pills');
  const pirateBtn = buttons.find((b) => b.dataset.action === 'pirate');
  assert.ok(pirateBtn, 'New pirate pill must exist in the toolbar');
  assert.strictEqual(pirateBtn.textContent, '🏴‍☠️ Pirate');
  GT.refine.hide();

  // 3. RENAME the custom preset ("pirate" -> "Ahoy Matey")
  const customListAfterRename = customListAfterAdd.map((p) =>
    p.id === 'pirate' ? { ...p, label: 'Ahoy Matey' } : p
  );
  await GTStorage.saveSettings({ customPresets: customListAfterRename }, 'key');
  GT.state.settings = await GTStorage.getSettings();

  GT.refine.show();
  bar = GT.refine.getBar();
  buttons = bar.querySelectorAll('button');
  const renamedBtn = buttons.find((b) => b.dataset.action === 'pirate');
  assert.ok(renamedBtn, 'Renamed preset button must exist');
  assert.strictEqual(renamedBtn.textContent, 'Ahoy Matey', 'Pill label must immediately update to "Ahoy Matey"');
  GT.refine.hide();

  // 4. DELETE the custom preset
  const customListAfterDelete = customListAfterRename.filter((p) => p.id !== 'pirate');
  await GTStorage.saveSettings({ customPresets: customListAfterDelete }, 'key');
  GT.state.settings = await GTStorage.getSettings();

  GT.refine.show();
  bar = GT.refine.getBar();
  buttons = bar.querySelectorAll('button');
  assert.strictEqual(buttons.length, 5, 'Button count should return to 5');
  assert.strictEqual(
    buttons.some((b) => b.dataset.action === 'pirate'),
    false,
    'Deleted preset pill must no longer appear in the widget'
  );
  GT.refine.hide();

  // 5. Verify clicking a custom preset triggers message with presetId
  const customListWithAction = [
    { id: 'bulletize', label: 'Bullets', prompt: 'Convert to bullets' },
  ];
  await GTStorage.saveSettings({ customPresets: customListWithAction }, 'key');
  GT.state.settings = await GTStorage.getSettings();

  let sentMessage = null;
  globalThis.chrome.runtime.sendMessage = async (msg) => {
    sentMessage = msg;
    return { ok: true, result: { rewritten: '• Bullet item 1' } };
  };

  GT.refine.show();
  bar = GT.refine.getBar();
  const bulletBtn = bar.querySelectorAll('button')[0];
  bulletBtn.click();
  await new Promise((r) => setTimeout(r, 10));

  assert.ok(sentMessage, 'Runtime message must be sent');
  assert.strictEqual(sentMessage.type, 'REFINE_TEXT');
  assert.strictEqual(sentMessage.action, 'bulletize');
  assert.strictEqual(sentMessage.presetId, 'bulletize');
});

// ---------------------------------------------------------------------------
// Acceptance Criterion 4:
// Pressing `Esc` dismisses the floating widget cleanly without clearing or corrupting the user's selected text.
// ---------------------------------------------------------------------------

test('AC 4: pressing Esc dismisses floating widget cleanly without clearing or corrupting selected text', () => {
  const { GT, mockDoc } = setupMockEnvironment();

  GT.state.settings = {
    customPresets: [{ id: 'formal', label: 'Formal', prompt: 'Make formal' }],
  };

  const originalContent = 'The quick brown fox jumps over the lazy sleeping dog.';
  const textarea = createMockTextarea(originalContent);
  // Select "brown fox jumps" (index 10 to 25)
  textarea.setSelectionRange(10, 25);
  textarea.focus();

  assert.strictEqual(mockDoc.activeElement, textarea);
  assert.strictEqual(textarea.selectionStart, 10);
  assert.strictEqual(textarea.selectionEnd, 25);

  // 1. Show the floating widget
  GT.refine.show();
  const bar = GT.refine.getBar();
  assert.ok(bar, 'Toolbar should be visible');

  const button = bar.querySelectorAll('button')[0];
  button.focus();
  assert.strictEqual(mockDoc.activeElement, button, 'Button in toolbar has focus');

  // 2. Press Escape on toolbar button
  button.dispatchEvent({
    type: 'keydown',
    key: 'Escape',
    bubbles: true,
    preventDefault: () => {},
    stopPropagation: () => {},
  });

  // 3. Verify widget is completely dismissed
  assert.strictEqual(GT.refine.getBar(), null, 'Floating widget toolbar must be dismissed on Esc');

  // 4. Verify text content was NOT cleared or corrupted
  assert.strictEqual(
    textarea.value,
    originalContent,
    'Textarea content must remain completely unchanged'
  );

  // 5. Verify selection range was preserved exactly
  assert.strictEqual(textarea.selectionStart, 10, 'selectionStart must remain 10');
  assert.strictEqual(textarea.selectionEnd, 25, 'selectionEnd must remain 25');

  // 6. Verify field focus was restored
  assert.strictEqual(
    mockDoc.activeElement,
    textarea,
    'Active focus must be returned to the textarea'
  );

  // 7. Verify Escape behavior in GT.preview tooltip as well
  GT.preview.open({
    title: 'Preview Tooltip',
    text: 'Alternative text',
    onDiscard: () => {},
  });
  assert.ok(GT.preview.isOpen(), 'Preview card should be open');

  mockDoc.dispatchEvent({
    type: 'keydown',
    key: 'Escape',
    preventDefault: () => {},
    stopPropagation: () => {},
  });

  assert.strictEqual(GT.preview.isOpen(), false, 'Preview tooltip must close on Escape');
  assert.strictEqual(
    textarea.value,
    originalContent,
    'Textarea content must still be uncorrupted after preview discard'
  );
});

// ---------------------------------------------------------------------------
// Acceptance Criterion 5:
// Text replacement maintains undo history (`Ctrl+Z` / `Cmd+Z`) inside standard textareas.
// ---------------------------------------------------------------------------

test('AC 5: text replacement maintains undo history (Ctrl+Z / Cmd+Z) inside standard textareas', () => {
  const { GT, mockDoc, undoStack } = setupMockEnvironment();

  const originalText = 'She dont like going to the grocery store on Sundays.';
  const textarea = createMockTextarea(originalText);
  // Select "dont" (index 4 to 8)
  textarea.setSelectionRange(4, 8);
  textarea.focus();

  // Perform replacement via GT.replaceRange
  const replacedOk = GT.replaceRange(textarea, 4, 8, "doesn't");
  assert.strictEqual(replacedOk, true, 'GT.replaceRange must succeed');

  // Verify text is updated
  assert.strictEqual(
    textarea.value,
    "She doesn't like going to the grocery store on Sundays.",
    'Textarea value must reflect the replaced text'
  );

  // Verify that an undo history record was recorded via execCommand('insertText')
  assert.strictEqual(undoStack.length, 1, 'An undo record must be pushed by insertText');
  assert.strictEqual(undoStack[0].value, originalText);
  assert.strictEqual(undoStack[0].start, 4);
  assert.strictEqual(undoStack[0].end, 8);

  // Simulate User pressing Ctrl+Z / Cmd+Z (document.execCommand('undo'))
  const undoResult = mockDoc.execCommand('undo');
  assert.strictEqual(undoResult, true, 'execCommand("undo") must succeed');

  // Verify text reverts back to the original draft with original selection!
  assert.strictEqual(
    textarea.value,
    originalText,
    'Undo (Ctrl+Z) must restore the original text before replacement'
  );
  assert.strictEqual(textarea.selectionStart, 4);
  assert.strictEqual(textarea.selectionEnd, 8);

  // Simulate User pressing Ctrl+Y / Cmd+Shift+Z (document.execCommand('redo'))
  const redoResult = mockDoc.execCommand('redo');
  assert.strictEqual(redoResult, true, 'execCommand("redo") must succeed');

  assert.strictEqual(
    textarea.value,
    "She doesn't like going to the grocery store on Sundays.",
    'Redo must re-apply the replacement cleanly'
  );
});

// ---------------------------------------------------------------------------
// Acceptance Criterion 6 (and Brief Requirement 4):
// Parsing handles both clean JSON and thought-polluted parts.
// ---------------------------------------------------------------------------

test('AC 6: parsing handles clean JSON, thought-polluted parts, markdown fences, and fallbacks', () => {
  const { bgHelper } = setupMockEnvironment();
  const { extractCandidateText, parseRewrittenText } = bgHelper;

  // 1. Thinking part followed by clean JSON
  const responseWithThoughts = {
    candidates: [
      {
        content: {
          parts: [
            { thought: true, text: 'Thinking about grammatical structure...' },
            { thought: true, text: 'Selecting formal vocabulary...' },
            { text: '{"rewritten": "We request your confirmation by Friday."}' },
          ],
        },
      },
    ],
  };
  const extractedText = extractCandidateText(responseWithThoughts);
  assert.strictEqual(extractedText, '{"rewritten": "We request your confirmation by Friday."}');
  const parsedText = parseRewrittenText(extractedText);
  assert.strictEqual(parsedText, 'We request your confirmation by Friday.');

  // 2. Markdown code fences containing JSON
  const fencedJson = '```json\n{\n  "rewritten": "Fenced output text."\n}\n```';
  assert.strictEqual(parseRewrittenText(fencedJson), 'Fenced output text.');

  // 3. Markdown code fence with plain text
  const fencedPlainText = '```\nPlain text in generic code block\n```';
  assert.strictEqual(parseRewrittenText(fencedPlainText), 'Plain text in generic code block');

  // 4. Conversational preamble and postamble wrapping JSON
  const wrappedJson = 'Sure! Here is the rewritten text:\n{"rewritten": "Polished text."}\nHope this helps!';
  assert.strictEqual(parseRewrittenText(wrappedJson), 'Polished text.');

  // 5. Escaped quotes and special characters
  const escapedQuotesJson = '{"rewritten": "He said, \\"Hello World!\\" and smiled."}';
  assert.strictEqual(parseRewrittenText(escapedQuotesJson), 'He said, "Hello World!" and smiled.');

  // 6. Direct plain text fallback (non-JSON)
  const directText = 'Just a pure string replacement without any JSON wrapping.';
  assert.strictEqual(parseRewrittenText(directText), 'Just a pure string replacement without any JSON wrapping.');

  // 7. Edge case: all parts marked as thought (fallback to last part)
  const allThoughts = {
    candidates: [
      {
        content: {
          parts: [
            { thought: true, text: 'Initial consideration' },
            { thought: true, text: 'Final conclusion text' },
          ],
        },
      },
    ],
  };
  assert.strictEqual(extractCandidateText(allThoughts), 'Final conclusion text');
});

// ---------------------------------------------------------------------------
// Acceptance Criterion 7:
// Full End-to-End Workflow: Settings -> Content Script Selection -> API Call ->
// Interactive Preview Tooltip -> Accept -> Undo
// ---------------------------------------------------------------------------

test('AC 7: full end-to-end flow from settings to selection, rewrite, preview, accept, and undo', async () => {
  const { GT, GTStorage, mockDoc } = setupMockEnvironment();

  // 1. User configures settings: custom preset and preview enabled
  await GTStorage.saveSettings(
    {
      temperature: 0.35,
      previewBeforeReplace: true,
      customPresets: [
        { id: 'punchy', label: '🥊 Punchy', prompt: 'Make this punchy and brief:' },
      ],
    },
    'AIzaSyTestKey'
  );

  GT.state.settings = await GTStorage.getSettings();

  // 2. Setup textarea with user content
  const initialText = 'The proposal that was submitted yesterday was rather lengthy and verbose.';
  const textarea = createMockTextarea(initialText);
  // Select "was rather lengthy and verbose" (index 42 to 72)
  const startIdx = 42;
  const endIdx = 72;
  textarea.setSelectionRange(startIdx, endIdx);
  textarea.focus();

  // 3. Mock Gemini API response
  let capturedNetworkPayload = null;
  globalThis.chrome.runtime.sendMessage = async (msg) => {
    if (msg.type === 'REFINE_TEXT') {
      capturedNetworkPayload = msg;
      return {
        ok: true,
        result: { rewritten: 'was too wordy' },
      };
    }
    return { ok: true };
  };

  // 4. User opens floating widget and clicks Punchy preset
  GT.refine.show();
  const bar = GT.refine.getBar();
  assert.ok(bar, 'Toolbar should open');

  const punchyBtn = bar.querySelectorAll('button')[0];
  assert.strictEqual(punchyBtn.textContent, '🥊 Punchy');
  punchyBtn.click();

  // Wait for async refine process
  await new Promise((r) => setTimeout(r, 20));

  // Verify message sent with correct presetId
  assert.strictEqual(capturedNetworkPayload.action, 'punchy');
  assert.strictEqual(capturedNetworkPayload.presetId, 'punchy');
  assert.strictEqual(capturedNetworkPayload.text, 'was rather lengthy and verbose');

  // 5. Interactive preview tooltip opens
  const previewCard = GT.preview.getCard();
  assert.ok(previewCard, 'Interactive preview card must be displayed');
  const title = previewCard.querySelector('.gt-preview-title');
  assert.strictEqual(title.textContent, 'Preview: 🥊 Punchy');
  const body = previewCard.querySelector('.gt-preview-body');
  assert.strictEqual(body.textContent, 'was too wordy');

  // Textarea should not be modified before accepting
  assert.strictEqual(textarea.value, initialText);

  // 6. User accepts rewrite by hitting Enter key
  mockDoc.dispatchEvent({
    type: 'keydown',
    key: 'Enter',
    preventDefault: () => {},
    stopPropagation: () => {},
  });

  // 7. Preview closes and text is replaced in textarea
  assert.strictEqual(GT.preview.isOpen(), false, 'Preview should close after Enter');
  assert.strictEqual(
    textarea.value,
    'The proposal that was submitted yesterday was too wordy.',
    'Textarea must be updated with rewritten text'
  );

  // 8. User triggers undo (Ctrl+Z)
  mockDoc.execCommand('undo');
  assert.strictEqual(
    textarea.value,
    initialText,
    'Original text must be restored after undo (Ctrl+Z)'
  );
  assert.strictEqual(textarea.selectionStart, startIdx);
  assert.strictEqual(textarea.selectionEnd, endIdx);
});
