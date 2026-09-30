const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Verify HTML contents and structure
test('options.html: contains all required controls, scripts, and inputs', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '../extension/src/options.html'),
    'utf8'
  );

  // Storage script before options.js
  const storageIdx = html.indexOf('<script src="storage.js"></script>');
  const optionsIdx = html.indexOf('<script src="options.js"></script>');
  assert.ok(storageIdx !== -1, 'storage.js script tag missing');
  assert.ok(optionsIdx !== -1, 'options.js script tag missing');
  assert.ok(storageIdx < optionsIdx, 'storage.js must be loaded before options.js');

  // Sliders and readouts
  assert.ok(html.includes('id="temperature"'), 'temperature slider missing');
  assert.ok(html.includes('id="tempVal"'), 'tempVal badge missing');
  assert.ok(html.includes('data-temp="0.10"'), 'strict quick temp button missing');
  assert.ok(html.includes('data-temp="0.70"'), 'balanced quick temp button missing');
  assert.ok(html.includes('data-temp="1.20"'), 'creative quick temp button missing');
  assert.ok(html.includes('id="topP"'), 'topP slider missing');
  assert.ok(html.includes('id="topPVal"'), 'topPVal badge missing');
  assert.ok(html.includes('id="minTextLength"'), 'minTextLength slider missing');
  assert.ok(html.includes('id="minTextLengthVal"'), 'minTextLengthVal badge missing');
  assert.ok(html.includes('data-len="10"'), 'quick min-len 10 button missing');
  assert.ok(html.includes('data-len="15"'), 'quick min-len 15 button missing');
  assert.ok(html.includes('data-len="30"'), 'quick min-len 30 button missing');
  assert.ok(html.includes('data-len="50"'), 'quick min-len 50 button missing');

  // System instruction
  assert.ok(html.includes('id="systemInstruction"'), 'systemInstruction textarea missing');
  assert.ok(html.includes('id="resetSystemInstruction"'), 'resetSystemInstruction button missing');

  // Workflow checkboxes
  assert.ok(html.includes('id="fastZeroShot"'), 'fastZeroShot checkbox missing');
  assert.ok(html.includes('id="previewBeforeReplace"'), 'previewBeforeReplace checkbox missing');

  // Models
  assert.ok(html.includes('value="gemini-3.1-flash-lite"'), 'gemini-3.1-flash-lite option missing');
  assert.ok(html.includes('value="gemini-2.5-flash"'), 'gemini-2.5-flash option missing');
  assert.ok(html.includes('value="gemini-2.0-flash"'), 'gemini-2.0-flash option missing');
  assert.ok(html.includes('value="__custom__"'), 'custom model option missing');

  // Preset manager elements
  assert.ok(html.includes('id="presetsList"'), 'presetsList container missing');
  assert.ok(html.includes('id="newPresetLabel"'), 'newPresetLabel input missing');
  assert.ok(html.includes('id="newPresetPrompt"'), 'newPresetPrompt textarea missing');
  assert.ok(html.includes('id="addPresetBtn"'), 'addPresetBtn button missing');
  assert.ok(html.includes('id="resetPresets"'), 'resetPresets button missing');
});

// Mock DOM elements and tests for options.js
function createMockElement(id, tag = 'div', type = '') {
  let innerHtml = '';
  return {
    id,
    tagName: tag.toUpperCase(),
    type,
    value: '',
    checked: false,
    textContent: '',
    get innerHTML() {
      return innerHtml;
    },
    set innerHTML(val) {
      innerHtml = val;
      if (val === '') {
        this.children = [];
      }
    },
    style: {},
    dataset: {},
    children: [],
    listeners: {},
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener(event, fn) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(fn);
    },
    dispatchEvent(event) {
      const fns = this.listeners[event.type || event] || [];
      for (const fn of fns) fn(event);
    }
  };
}

function setupMockDOM() {
  const quickLenButtons = ['10', '15', '30', '50'].map((len) => {
    const btn = createMockElement('', 'button');
    btn.dataset.len = len;
    btn.className = 'btn-sm quick-len';
    return btn;
  });

  const elements = {
    apiKey: createMockElement('apiKey', 'input', 'password'),
    toggleKey: createMockElement('toggleKey', 'button'),
    model: createMockElement('model', 'select'),
    customModel: createMockElement('customModel', 'input', 'text'),
    language: createMockElement('language', 'select'),
    temperature: createMockElement('temperature', 'input', 'range'),
    tempVal: createMockElement('tempVal', 'span'),
    topP: createMockElement('topP', 'input', 'range'),
    topPVal: createMockElement('topPVal', 'span'),
    minTextLength: createMockElement('minTextLength', 'input', 'range'),
    minTextLengthVal: createMockElement('minTextLengthVal', 'span'),
    systemInstruction: createMockElement('systemInstruction', 'textarea'),
    resetSystemInstruction: createMockElement('resetSystemInstruction', 'button'),
    fastZeroShot: createMockElement('fastZeroShot', 'input', 'checkbox'),
    previewBeforeReplace: createMockElement('previewBeforeReplace', 'input', 'checkbox'),
    presetsList: createMockElement('presetsList', 'div'),
    newPresetLabel: createMockElement('newPresetLabel', 'input', 'text'),
    newPresetPrompt: createMockElement('newPresetPrompt', 'textarea'),
    addPresetBtn: createMockElement('addPresetBtn', 'button'),
    resetPresets: createMockElement('resetPresets', 'button'),
    disabledSites: createMockElement('disabledSites', 'textarea'),
    save: createMockElement('save', 'button'),
    test: createMockElement('test', 'button'),
    status: createMockElement('status', 'span'),
    ver: createMockElement('ver', 'span')
  };

  globalThis.document = {
    readyState: 'complete',
    getElementById: (id) => elements[id] || null,
    createElement: (tag) => createMockElement('', tag),
    querySelectorAll: (sel = '') => {
      if (sel.includes('.quick-len') || sel.includes('data-len')) {
        return quickLenButtons;
      }
      return [];
    },
    addEventListener: () => {}
  };

  elements._quickLenButtons = quickLenButtons;

  return elements;
}

// Mock chrome.storage
function createMockChrome() {
  const syncStore = {};
  const localStore = {};
  return {
    storage: {
      sync: {
        get: async (keys) => (typeof keys === 'string' ? { [keys]: syncStore[keys] } : { ...syncStore }),
        set: async (obj) => { Object.assign(syncStore, obj); }
      },
      local: {
        get: async (keys) => (typeof keys === 'string' ? { [keys]: localStore[keys] } : { ...localStore }),
        set: async (obj) => { Object.assign(localStore, obj); }
      }
    },
    runtime: {
      getManifest: () => ({ version: '0.2.0' }),
      sendMessage: async () => ({ ok: true, result: { corrections: [] } })
    }
  };
}

test('options.js: load, collect, and save with GTStorage', async () => {
  const mockElements = setupMockDOM();
  const mockChrome = createMockChrome();
  globalThis.chrome = mockChrome;

  const { GTStorage } = require('../extension/src/storage.js');
  const options = require('../extension/src/options.js');

  // Seed storage with custom parameters
  await GTStorage.saveSettings(
    {
      model: 'gemini-2.5-flash',
      language: 'Spanish',
      temperature: 0.7,
      topP: 0.8,
      systemInstruction: 'Custom system instruction',
      fastZeroShot: false,
      previewBeforeReplace: false,
      disabledSites: ['github.com', 'google.com']
    },
    'AIzaTestKey123'
  );

  await options.load();

  assert.strictEqual(mockElements.apiKey.value, 'AIzaTestKey123');
  assert.strictEqual(mockElements.model.value, 'gemini-2.5-flash');
  assert.strictEqual(mockElements.customModel.style.display, 'none');
  assert.strictEqual(mockElements.language.value, 'Spanish');
  assert.strictEqual(mockElements.temperature.value, 0.7);
  assert.strictEqual(mockElements.tempVal.textContent, '0.70');
  assert.strictEqual(mockElements.topP.value, 0.8);
  assert.strictEqual(mockElements.topPVal.textContent, '0.80');
  assert.strictEqual(mockElements.systemInstruction.value, 'Custom system instruction');
  assert.strictEqual(mockElements.fastZeroShot.checked, false);
  assert.strictEqual(mockElements.previewBeforeReplace.checked, false);
  assert.strictEqual(mockElements.disabledSites.value, 'github.com\ngoogle.com');

  // Verify collect() returns accurate state
  mockElements.temperature.value = '1.25';
  mockElements.topP.value = '0.50';
  mockElements.fastZeroShot.checked = true;

  const collected = options.collect();
  assert.strictEqual(collected.apiKey, 'AIzaTestKey123');
  assert.strictEqual(collected.temperature, 1.25);
  assert.strictEqual(collected.topP, 0.5);
  assert.strictEqual(collected.fastZeroShot, true);

  // Save through options.save()
  await options.save();
  const updatedSettings = await GTStorage.getSettings();
  assert.strictEqual(updatedSettings.temperature, 1.25);
  assert.strictEqual(updatedSettings.topP, 0.5);
  assert.strictEqual(updatedSettings.fastZeroShot, true);
});

test('options.js: custom model selection handling', async () => {
  const mockElements = setupMockDOM();
  const mockChrome = createMockChrome();
  globalThis.chrome = mockChrome;

  const { GTStorage } = require('../extension/src/storage.js');
  const options = require('../extension/src/options.js');

  await GTStorage.saveSettings({ model: 'gemini-exp-custom' }, 'AIzaKey');
  await options.load();

  assert.strictEqual(mockElements.model.value, '__custom__');
  assert.strictEqual(mockElements.customModel.style.display, 'block');
  assert.strictEqual(mockElements.customModel.value, 'gemini-exp-custom');

  const collected = options.collect();
  assert.strictEqual(collected.model, 'gemini-exp-custom');
});

test('options.js: preset management (presets list rendering & actions)', async () => {
  const mockElements = setupMockDOM();
  const mockChrome = createMockChrome();
  globalThis.chrome = mockChrome;

  const { GTStorage } = require('../extension/src/storage.js');
  const options = require('../extension/src/options.js');

  await options.load();
  const presets = options.getPresets();
  assert.ok(presets.length >= 3);

  // Test reordering
  const initialFirst = presets[0].id;
  const initialSecond = presets[1].id;

  // Swap first and second
  options.setPresets([presets[1], presets[0], ...presets.slice(2)]);
  assert.strictEqual(options.getPresets()[0].id, initialSecond);
  assert.strictEqual(options.getPresets()[1].id, initialFirst);

  // Test renderPresets doesn't crash and creates DOM items
  options.renderPresets();
  assert.strictEqual(mockElements.presetsList.children.length, presets.length);

  // Test edit mode rendering
  options.setEditingPresetId(initialSecond);
  options.renderPresets();
  assert.strictEqual(mockElements.presetsList.children.length, presets.length);
  // Verify the edited item has class 'editing'
  const editingChild = mockElements.presetsList.children.find(c => c.dataset?.id === initialSecond);
  assert.ok(editingChild.className.includes('editing'));

  // Reset presets
  options.setEditingPresetId(null);
  options.setPresets(JSON.parse(JSON.stringify(GTStorage.DEFAULT_PRESETS)));
  options.renderPresets();
  assert.strictEqual(options.getPresets().length, GTStorage.DEFAULT_PRESETS.length);
});

test('options.js: system instruction reset', async () => {
  const mockElements = setupMockDOM();
  const mockChrome = createMockChrome();
  globalThis.chrome = mockChrome;

  const { GTStorage } = require('../extension/src/storage.js');
  const options = require('../extension/src/options.js');

  await GTStorage.saveSettings({ systemInstruction: 'Custom instruction' });
  await options.load();
  assert.strictEqual(mockElements.systemInstruction.value, 'Custom instruction');

  // Reset to default
  mockElements.systemInstruction.value = GTStorage.DEFAULT_SYSTEM_INSTRUCTION;
  assert.strictEqual(
    mockElements.systemInstruction.value,
    GTStorage.DEFAULT_SYSTEM_INSTRUCTION
  );
});

test('options.js: minTextLength slider, live badge updates, preset buttons, and persistence', async () => {
  const mockElements = setupMockDOM();
  const mockChrome = createMockChrome();
  globalThis.chrome = mockChrome;

  const { GTStorage } = require('../extension/src/storage.js');
  const options = require('../extension/src/options.js');

  // Wire event handlers on the mock DOM
  if (options.initDOMEvents) {
    options.initDOMEvents();
  }

  // Verify default load falls back to 15
  await GTStorage.saveSettings({});
  await options.load();
  assert.strictEqual(Number(mockElements.minTextLength.value), 15);
  assert.strictEqual(Number(mockElements.minTextLengthVal.textContent), 15);

  // Test loading with custom minTextLength
  await GTStorage.saveSettings({ minTextLength: 30 });
  await options.load();
  assert.strictEqual(Number(mockElements.minTextLength.value), 30);
  assert.strictEqual(Number(mockElements.minTextLengthVal.textContent), 30);

  // Test slider input event updates badge
  mockElements.minTextLength.value = '45';
  mockElements.minTextLength.dispatchEvent({ type: 'input', target: mockElements.minTextLength });
  assert.strictEqual(Number(mockElements.minTextLengthVal.textContent), 45);

  // Test collect() reads the updated slider value
  const collected = options.collect();
  assert.strictEqual(collected.minTextLength, 45);

  // Test preset buttons update slider and badge
  const presetBtn10 = mockElements._quickLenButtons.find(b => b.dataset.len === '10');
  assert.ok(presetBtn10, 'Preset 10 button should exist');
  presetBtn10.dispatchEvent({ type: 'click', target: presetBtn10 });

  assert.strictEqual(Number(mockElements.minTextLength.value), 10);
  assert.strictEqual(Number(mockElements.minTextLengthVal.textContent), 10);

  // Test preset button 50
  const presetBtn50 = mockElements._quickLenButtons.find(b => b.dataset.len === '50');
  assert.ok(presetBtn50, 'Preset 50 button should exist');
  presetBtn50.dispatchEvent({ type: 'click', target: presetBtn50 });

  assert.strictEqual(Number(mockElements.minTextLength.value), 50);
  assert.strictEqual(Number(mockElements.minTextLengthVal.textContent), 50);

  // Test save persists minTextLength
  await options.save();
  const updatedSettings = await GTStorage.getSettings();
  assert.strictEqual(updatedSettings.minTextLength, 50);
});


