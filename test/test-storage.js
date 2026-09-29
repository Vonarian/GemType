const test = require('node:test');
const assert = require('node:assert');

// Mock chrome.storage
function createMockChrome() {
  const syncStore = {};
  const localStore = {};
  return {
    storage: {
      sync: {
        get: async (keys) => {
          if (typeof keys === 'string') return { [keys]: syncStore[keys] };
          return { ...syncStore };
        },
        set: async (obj) => { Object.assign(syncStore, obj); }
      },
      local: {
        get: async (keys) => {
          if (typeof keys === 'string') return { [keys]: localStore[keys] };
          return { ...localStore };
        },
        set: async (obj) => { Object.assign(localStore, obj); }
      }
    }
  };
}

globalThis.chrome = createMockChrome();
const { GTStorage } = require('../extension/src/storage.js');

test('GTStorage: returns default config when empty', async () => {
  globalThis.chrome = createMockChrome();
  const settings = await GTStorage.getSettings();
  assert.strictEqual(settings.model, 'gemini-3.1-flash-lite');
  assert.strictEqual(settings.temperature, 0.3);
  assert.strictEqual(settings.topP, 0.95);
  assert.strictEqual(settings.previewBeforeReplace, true);
  assert.strictEqual(settings.fastZeroShot, true);
  assert.ok(Array.isArray(settings.customPresets));
  assert.strictEqual(settings.customPresets.length >= 3, true);
});

test('GTStorage: saves apiKey to local and preferences to sync', async () => {
  const mock = createMockChrome();
  globalThis.chrome = mock;
  await GTStorage.saveSettings({ temperature: 0.7, model: 'gemini-2.5-flash' }, 'AIzaSyTestKey');

  const settings = await GTStorage.getSettings();
  assert.strictEqual(settings.apiKey, 'AIzaSyTestKey');
  assert.strictEqual(settings.temperature, 0.7);
  assert.strictEqual(settings.model, 'gemini-2.5-flash');

  const localRaw = await mock.storage.local.get(null);
  const syncRaw = await mock.storage.sync.get(null);
  assert.strictEqual(localRaw.apiKey, 'AIzaSyTestKey');
  assert.strictEqual(syncRaw.settings.temperature, 0.7);
  assert.strictEqual(syncRaw.settings.apiKey, undefined, 'API key must never be saved to sync storage');
});

test('GTStorage: legacy local settings migration and fallback', async () => {
  const mock = createMockChrome();
  globalThis.chrome = mock;
  // Simulate legacy storage format where apiKey was inside settings in local
  await mock.storage.local.set({
    settings: {
      apiKey: 'LegacyKey123',
      temperature: 0.5,
      model: 'gemini-1.5-flash'
    }
  });

  const settings = await GTStorage.getSettings();
  assert.strictEqual(settings.apiKey, 'LegacyKey123');
  assert.strictEqual(settings.temperature, 0.5);
  assert.strictEqual(settings.model, 'gemini-1.5-flash');
});

test('GTStorage: handles sync failure gracefully and falls back to local', async () => {
  const mock = createMockChrome();
  mock.storage.sync.set = async () => {
    throw new Error('Sync quota exceeded or sync disabled');
  };
  mock.storage.sync.get = async () => {
    throw new Error('Sync disabled');
  };
  globalThis.chrome = mock;

  await GTStorage.saveSettings({ temperature: 0.8 }, 'FallbackKey');
  const localRaw = await mock.storage.local.get(null);
  assert.strictEqual(localRaw.apiKey, 'FallbackKey');
  assert.strictEqual(localRaw.settings.temperature, 0.8);

  const settings = await GTStorage.getSettings();
  assert.strictEqual(settings.apiKey, 'FallbackKey');
  assert.strictEqual(settings.temperature, 0.8);
});
