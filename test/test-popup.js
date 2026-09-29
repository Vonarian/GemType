const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('popup.html: contains storage.js before popup.js and all required elements', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '../extension/src/popup.html'),
    'utf8'
  );

  const storageIdx = html.indexOf('<script src="storage.js"></script>');
  const popupIdx = html.indexOf('<script src="popup.js"></script>');

  assert.ok(storageIdx !== -1, 'storage.js script tag missing in popup.html');
  assert.ok(popupIdx !== -1, 'popup.js script tag missing in popup.html');
  assert.ok(storageIdx < popupIdx, 'storage.js must be loaded before popup.js');

  assert.ok(html.includes('id="enabled"'), 'enabled checkbox missing');
  assert.ok(html.includes('id="site"'), 'site checkbox missing');
  assert.ok(html.includes('id="noKey"'), 'noKey warning missing');
  assert.ok(html.includes('id="setKey"'), 'setKey link missing');
  assert.ok(html.includes('id="options"'), 'options link missing');
  assert.ok(html.includes('id="host"'), 'host placeholder missing');
});

test('test/harness.html: includes storage.js before content scripts', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '../test/harness.html'),
    'utf8'
  );

  const storageIdx = html.indexOf('<script src="../extension/src/storage.js"></script>');
  const utilIdx = html.indexOf('<script src="../extension/src/content/util.js"></script>');

  assert.ok(storageIdx !== -1, 'storage.js script tag missing in harness.html');
  assert.ok(utilIdx !== -1, 'util.js script tag missing in harness.html');
  assert.ok(storageIdx < utilIdx, 'storage.js must be loaded before util.js in harness.html');
});

function createMockElement(id, type = 'checkbox') {
  const listeners = {};
  return {
    id,
    type,
    checked: false,
    disabled: false,
    textContent: '',
    style: { display: '' },
    addEventListener(event, fn) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
    async trigger(event, e = {}) {
      for (const fn of listeners[event] || []) {
        await fn(e);
      }
    },
  };
}

test('popup.js: load() uses GTStorage.getSettings() and sets UI state correctly', async () => {
  const elements = {
    enabled: createMockElement('enabled', 'checkbox'),
    site: createMockElement('site', 'checkbox'),
    noKey: createMockElement('noKey', 'div'),
    host: createMockElement('host', 'div'),
    options: createMockElement('options', 'a'),
    setKey: createMockElement('setKey', 'a'),
  };

  const originalDoc = globalThis.document;
  const originalChrome = globalThis.chrome;
  const originalGTStorage = globalThis.GTStorage;

  try {
    globalThis.document = {
      getElementById: (id) => elements[id] || null,
    };

    let savedPrefs = null;
    let savedKey = null;

    globalThis.GTStorage = {
      getSettings: async () => ({
        enabled: true,
        apiKey: 'test-api-key-12345',
        disabledSites: ['disabled.example.com'],
      }),
      saveSettings: async (prefs, apiKey) => {
        savedPrefs = prefs;
        savedKey = apiKey;
      },
    };

    globalThis.chrome = {
      tabs: {
        query: async () => [{ id: 42 }],
        sendMessage: async (tabId, msg) => {
          if (msg.type === 'GET_HOSTNAME') return { hostname: 'news.example.com' };
          return null;
        },
      },
      runtime: {
        openOptionsPage: async () => {},
      },
    };

    // Load popup.js
    delete require.cache[require.resolve('../extension/src/popup.js')];
    const popup = require('../extension/src/popup.js');

    await popup.load();

    // Verify UI state
    assert.strictEqual(elements.enabled.checked, true, 'enabled toggle should be true');
    assert.strictEqual(elements.noKey.style.display, 'none', 'noKey warning should be hidden when apiKey is present');
    assert.strictEqual(elements.host.textContent, 'news.example.com');
    assert.strictEqual(elements.site.checked, true, 'site should be enabled for news.example.com');

    // Test disabling site
    await elements.site.trigger('change', { target: { checked: false } });
    assert.ok(savedPrefs, 'saveSettings should have been called on site toggle');
    assert.ok(savedPrefs.disabledSites.includes('news.example.com'), 'news.example.com should be added to disabledSites');
    assert.strictEqual(savedKey, 'test-api-key-12345', 'apiKey must be preserved when saving');

    // Test disabling extension
    await elements.enabled.trigger('change', { target: { checked: false } });
    assert.strictEqual(savedPrefs.enabled, false, 'enabled should be set to false');
  } finally {
    globalThis.document = originalDoc;
    globalThis.chrome = originalChrome;
    globalThis.GTStorage = originalGTStorage;
  }
});

test('popup.js: shows noKey warning when GTStorage has no apiKey', async () => {
  const elements = {
    enabled: createMockElement('enabled', 'checkbox'),
    site: createMockElement('site', 'checkbox'),
    noKey: createMockElement('noKey', 'div'),
    host: createMockElement('host', 'div'),
    options: createMockElement('options', 'a'),
    setKey: createMockElement('setKey', 'a'),
  };

  const originalDoc = globalThis.document;
  const originalChrome = globalThis.chrome;
  const originalGTStorage = globalThis.GTStorage;

  try {
    globalThis.document = {
      getElementById: (id) => elements[id] || null,
    };

    globalThis.GTStorage = {
      getSettings: async () => ({
        enabled: true,
        apiKey: '',
        disabledSites: [],
      }),
      saveSettings: async () => {},
    };

    globalThis.chrome = {
      tabs: {
        query: async () => [],
      },
      runtime: {
        openOptionsPage: async () => {},
      },
    };

    delete require.cache[require.resolve('../extension/src/popup.js')];
    const popup = require('../extension/src/popup.js');

    await popup.load();

    assert.strictEqual(elements.noKey.style.display, 'block', 'noKey warning should be shown when apiKey is empty');
    assert.strictEqual(elements.host.textContent, 'unavailable on this page');
    assert.strictEqual(elements.site.disabled, true);
  } finally {
    globalThis.document = originalDoc;
    globalThis.chrome = originalChrome;
    globalThis.GTStorage = originalGTStorage;
  }
});
