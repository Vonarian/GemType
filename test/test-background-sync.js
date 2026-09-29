const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('background.js: updateContextMenus builds context menu from customPresets', async () => {
  const originalChrome = globalThis.chrome;
  const originalGTStorage = globalThis.GTStorage;

  try {
    const createdMenus = [];
    let removeAllCalled = false;

    globalThis.chrome = {
      runtime: {
        lastError: null,
      },
      contextMenus: {
        removeAll: (cb) => {
          removeAllCalled = true;
          createdMenus.length = 0;
          if (typeof cb === 'function') cb();
        },
        create: (item) => {
          createdMenus.push(item);
        },
      },
    };

    delete require.cache[require.resolve('../extension/src/background.js')];
    const bg = require('../extension/src/background.js');

    const customSettings = {
      customPresets: [
        { id: 'pirate', label: 'Pirate Talk', prompt: 'Talk like a pirate' },
        { id: 'haiku', label: 'Haiku', prompt: 'Write as a haiku' },
        { id: 'concise', label: 'Shorten Punchy', prompt: 'Make it concise' },
      ],
    };

    await bg.updateContextMenus(customSettings);

    assert.ok(removeAllCalled, 'removeAll must be called before creating items');
    assert.strictEqual(createdMenus[0].id, 'gemtype-root');
    assert.strictEqual(createdMenus[0].title, 'GemType');

    const itemIds = createdMenus.slice(1).map((m) => m.id);
    const itemTitles = createdMenus.slice(1).map((m) => m.title);

    assert.deepStrictEqual(itemIds, ['gemtype-pirate', 'gemtype-haiku', 'gemtype-concise']);
    assert.deepStrictEqual(itemTitles, ['Pirate Talk', 'Haiku', 'Shorten Punchy']);
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.GTStorage = originalGTStorage;
  }
});

test('background.js: storage.onChanged clears cache and triggers updateContextMenus', async () => {
  const originalChrome = globalThis.chrome;

  try {
    let storageChangedListener = null;
    const createdMenus = [];

    globalThis.chrome = {
      runtime: {
        lastError: null,
        onInstalled: { addListener: () => {} },
        onStartup: { addListener: () => {} },
      },
      storage: {
        local: {
          get: async () => ({
            settings: {
              customPresets: [
                { id: 'updated-preset', label: 'Updated', prompt: 'Updated prompt' },
              ],
            },
          }),
        },
        onChanged: {
          addListener: (fn) => {
            storageChangedListener = fn;
          },
        },
      },
      contextMenus: {
        removeAll: (cb) => {
          createdMenus.length = 0;
          if (typeof cb === 'function') cb();
        },
        create: (item) => {
          createdMenus.push(item);
        },
      },
    };

    delete require.cache[require.resolve('../extension/src/background.js')];
    const bg = require('../extension/src/background.js');

    assert.ok(storageChangedListener, 'chrome.storage.onChanged listener must be registered');

    // Populate the cache
    bg.cache.set('refine:mock:sample', { rewritten: 'Cached result' });
    assert.strictEqual(bg.cache.size, 1);

    // Fire storage.onChanged with sync area
    storageChangedListener(
      { settings: { newValue: { customPresets: [{ id: 'updated-preset', label: 'Updated' }] } } },
      'sync'
    );

    // Wait a tick for async getSettings and updateContextMenus
    await new Promise((r) => setTimeout(r, 10));

    // Cache must be cleared
    assert.strictEqual(bg.cache.size, 0, 'Cache must be cleared on settings change');

    // Context menus must have updated
    const updatedIds = createdMenus.slice(1).map((m) => m.id);
    assert.ok(updatedIds.includes('gemtype-updated-preset'), 'Context menus must be updated with new presets');
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test('content.js: storage.onChanged handles both local and sync areas', () => {
  const contentJs = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/content.js'),
    'utf8'
  );

  // Verify the cross-device condition is present
  const hasLocalAndSync = contentJs.includes(
    "(area !== 'local' && area !== 'sync') || !changes.settings"
  );
  assert.ok(
    hasLocalAndSync,
    "content.js must check: (area !== 'local' && area !== 'sync') || !changes.settings"
  );
});
