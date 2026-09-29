# GemType Extension Feature Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the GemType Manifest V3 extension with fine-grained generation parameter controls (Temperature, Top-P, System Instruction, Fast Zero-Shot), modernized Gemini models (`gemini-3.1-flash-lite` default), custom rewrite presets CRUD, interactive preview tooltip vs. direct replace, and keyboard shortcut rewrite triggers.

**Architecture:** Dual-tier storage (`chrome.storage.sync` for syncable preferences + `chrome.storage.local` for the secret API key) unified by a shared storage utility; direct Google AI Studio Gemini API calls from the background service worker with adaptive `thinkingConfig` and thought-part filtering; shadow-DOM-isolated floating toolbar and preview tooltip with full keyboard accessibility.

**Tech Stack:** JavaScript (ES2022 / Manifest V3, Web Extensions), HTML5, CSS3, Google Generative AI REST API (v1beta), Node.js (test runner).

## Global Constraints
- Zero telemetry, zero external tracking, zero intermediate backend servers.
- Direct client-to-API communication using `chrome.storage` and `fetch`.
- `apiKey` must only be stored in `chrome.storage.local` and never synced to `chrome.storage.sync`.
- All injected content UI must reside inside GemType's isolated shadow DOM root (`<gemtype-ext>`).
- Preserve native browser undo stack (`Ctrl+Z` / `Cmd+Z`) for text replacements.

---

### Task 1: Unified Storage Layer (`extension/src/storage.js`)

**Files:**
- Create: `extension/src/storage.js`
- Create: `test/test-storage.js`

**Interfaces:**
- Produces:
  - `GTStorage.DEFAULT_CONFIG`: object with default settings.
  - `GTStorage.getSettings()`: Promise resolving to `{ apiKey, model, temperature, topP, systemInstruction, previewBeforeReplace, fastZeroShot, customPresets, disabledSites, language, enabled }`.
  - `GTStorage.saveSettings(prefs, apiKey)`: Promise saving non-secret prefs to `sync` (fallback `local`) and `apiKey` to `local`.

- [ ] **Step 1: Write the automated test for storage layer**

Create `test/test-storage.js`:
```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/test-storage.js`  
Expected: FAIL with `Cannot find module '../extension/src/storage.js'`

- [ ] **Step 3: Implement `extension/src/storage.js`**

Create `extension/src/storage.js`:
```javascript
// GemType unified storage helper.
// Separates sensitive credentials (apiKey stored only in chrome.storage.local)
// from syncable preferences (chrome.storage.sync with automatic fallback to local).

'use strict';

const GTStorage = (() => {
  const DEFAULT_SYSTEM_INSTRUCTION =
    'You are an expert writing assistant. Rewrite the provided text according to instructions. Output ONLY the final replacement text without notes, preambles, or conversational filler.';

  const DEFAULT_PRESETS = [
    {
      id: 'formal',
      label: 'Formal',
      prompt: 'Rewrite this in a professional, polished, and formal tone:'
    },
    {
      id: 'concise',
      label: 'Concise',
      prompt: 'Make this text significantly shorter and punchier without losing essential facts:'
    },
    {
      id: 'fix',
      label: 'Fix & Polish',
      prompt: 'Correct all spelling, punctuation, and grammar mistakes while preserving voice:'
    },
    {
      id: 'improve',
      label: 'Improve',
      prompt: 'Rewrite the text to be clearer and better written while keeping the tone and meaning:'
    },
    {
      id: 'casual',
      label: 'Casual',
      prompt: 'Rewrite the text in a friendly, casual, conversational tone:'
    }
  ];

  const DEFAULT_CONFIG = {
    model: 'gemini-3.1-flash-lite',
    temperature: 0.3,
    topP: 0.95,
    systemInstruction: DEFAULT_SYSTEM_INSTRUCTION,
    previewBeforeReplace: true,
    fastZeroShot: true,
    customPresets: DEFAULT_PRESETS,
    disabledSites: [],
    language: 'auto',
    enabled: true
  };

  async function getSyncSettings() {
    try {
      if (chrome?.storage?.sync) {
        const data = await chrome.storage.sync.get('settings');
        if (data && data.settings) return data.settings;
      }
    } catch (_) {
      // Sync unavailable or disabled
    }
    return null;
  }

  async function getLocalSettings() {
    try {
      if (chrome?.storage?.local) {
        const data = await chrome.storage.local.get(['settings', 'apiKey']);
        const legacy = data.settings || {};
        const apiKey = data.apiKey || legacy.apiKey || '';
        return { legacy, apiKey };
      }
    } catch (_) {}
    return { legacy: {}, apiKey: '' };
  }

  async function getSettings() {
    const { legacy, apiKey } = await getLocalSettings();
    const syncSettings = await getSyncSettings();

    // Preference priority: sync -> legacy local -> defaults
    const merged = {
      ...DEFAULT_CONFIG,
      ...legacy,
      ...(syncSettings || {})
    };

    // Ensure array of presets
    if (!Array.isArray(merged.customPresets) || merged.customPresets.length === 0) {
      merged.customPresets = [...DEFAULT_PRESETS];
    }

    return {
      ...merged,
      apiKey
    };
  }

  async function saveSettings(prefs, apiKey = null) {
    const cleanPrefs = { ...prefs };
    delete cleanPrefs.apiKey; // Never put apiKey in sync

    let syncSucceeded = false;
    try {
      if (chrome?.storage?.sync) {
        await chrome.storage.sync.set({ settings: cleanPrefs });
        syncSucceeded = true;
      }
    } catch (_) {
      syncSucceeded = false;
    }

    // Always mirror to local settings for offline fallback and legacy compat
    const localUpdates = { settings: cleanPrefs };
    if (apiKey !== null && apiKey !== undefined) {
      localUpdates.apiKey = apiKey.trim();
    }

    if (chrome?.storage?.local) {
      await chrome.storage.local.set(localUpdates);
    }

    return { ...cleanPrefs, apiKey: apiKey !== null ? apiKey.trim() : undefined };
  }

  return {
    DEFAULT_CONFIG,
    DEFAULT_PRESETS,
    DEFAULT_SYSTEM_INSTRUCTION,
    getSettings,
    saveSettings
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GTStorage };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/test-storage.js`  
Expected: PASS (2 tests pass)

- [ ] **Step 5: Commit**

Run:
```bash
git add extension/src/storage.js test/test-storage.js
git commit -m "feat: add unified storage layer for sync and local separation"
```

---

### Task 2: Manifest Configuration (`manifest.json` & `manifest.firefox.json`)

**Files:**
- Modify: `extension/manifest.json`
- Modify: `extension/manifest.firefox.json`

**Interfaces:**
- Produces:
  - `commands.trigger_rewrite` shortcut registered (`Alt+Shift+G`).
  - `src/storage.js` declared in `content_scripts.js` and `background`.

- [ ] **Step 1: Update `extension/manifest.json`**

Update `extension/manifest.json` to include `src/storage.js` in `content_scripts` and add the `commands` definition:
```json
{
  "manifest_version": 3,
  "name": "GemType — AI Writing Assistant",
  "version": "0.1.6",
  "description": "Grammarly-style grammar checking and text refinement on any website, powered by the Gemini API (bring your own key).",
  "icons": {
    "16": "icons/icon16.png",
    "32": "icons/icon32.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "background": {
    "service_worker": "src/background.js"
  },
  "content_scripts": [
    {
      "matches": [
        "<all_urls>"
      ],
      "js": [
        "src/storage.js",
        "src/content/util.js",
        "src/content/overlay.js",
        "src/content/refine.js",
        "src/content/content.js"
      ],
      "run_at": "document_idle",
      "all_frames": true,
      "match_about_blank": true
    }
  ],
  "action": {
    "default_popup": "src/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png"
    }
  },
  "options_ui": {
    "page": "src/options.html",
    "open_in_tab": true
  },
  "permissions": [
    "storage",
    "contextMenus"
  ],
  "commands": {
    "trigger_rewrite": {
      "suggested_key": {
        "default": "Alt+Shift+G",
        "mac": "Alt+Shift+G"
      },
      "description": "Trigger inline rewriting on current selection"
    }
  },
  "host_permissions": [
    "https://generativelanguage.googleapis.com/*"
  ]
}
```

- [ ] **Step 2: Update `extension/manifest.firefox.json`**

Update `extension/manifest.firefox.json` with the matching `commands` and content script file list:
```json
{
  "manifest_version": 3,
  "name": "GemType — AI Writing Assistant",
  "version": "0.1.6",
  "description": "Grammarly-style grammar checking and text refinement on any website, powered by the Gemini API (bring your own key).",
  "browser_specific_settings": {
    "gecko": {
      "id": "gemtype@matily.org",
      "strict_min_version": "115.0",
      "data_collection_permissions": {
        "required": ["websiteContent"]
      }
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "32": "icons/icon32.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "background": {
    "scripts": ["src/storage.js", "src/background.js"]
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": [
        "src/storage.js",
        "src/content/util.js",
        "src/content/overlay.js",
        "src/content/refine.js",
        "src/content/content.js"
      ],
      "run_at": "document_idle",
      "all_frames": true,
      "match_about_blank": true
    }
  ],
  "action": {
    "default_popup": "src/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png"
    }
  },
  "options_ui": {
    "page": "src/options.html",
    "open_in_tab": true
  },
  "permissions": ["storage", "contextMenus"],
  "commands": {
    "trigger_rewrite": {
      "suggested_key": {
        "default": "Alt+Shift+G",
        "mac": "Alt+Shift+G"
      },
      "description": "Trigger inline rewriting on current selection"
    }
  },
  "host_permissions": ["https://generativelanguage.googleapis.com/*"]
}
```

- [ ] **Step 3: Validate JSON syntax**

Run: `node -e "JSON.parse(require('fs').readFileSync('extension/manifest.json')); JSON.parse(require('fs').readFileSync('extension/manifest.firefox.json')); console.log('Manifests valid');"`  
Expected: `Manifests valid`

- [ ] **Step 4: Commit**

Run:
```bash
git add extension/manifest.json extension/manifest.firefox.json
git commit -m "feat: register trigger_rewrite shortcut and storage script in manifests"
```

---

### Task 3: Options Page & Parameter UI (`options.html` & `options.js`)

**Files:**
- Modify: `extension/src/options.html`
- Modify: `extension/src/options.js`

**Interfaces:**
- Consumes: `GTStorage.getSettings()`, `GTStorage.saveSettings()`.
- Produces: Complete interactive UI for temperature slider, topP slider, system instruction textarea, model dropdown (`gemini-3.1-flash-lite`, `gemini-2.5-flash`, `gemini-2.0-flash`, custom), preview toggle, and full preset CRUD (add, edit, delete, reorder, reset).

- [ ] **Step 1: Update `extension/src/options.html`**

Update `extension/src/options.html` to add:
- Scripts: `<script src="storage.js"></script>` before `options.js`.
- Temperature card with slider, live readout, preset buttons (`0.10`, `0.70`, `1.20`).
- Top-P slider with live readout.
- System instruction textarea with "Reset default" button.
- Fast zero-shot checkbox.
- Preview mode toggle ("Show preview before replacing").
- Updated model options (`gemini-3.1-flash-lite`, `gemini-2.5-flash`, `gemini-2.0-flash`, `__custom__`).
- Custom Preset Manager section with table/list, "Add Preset" form, and "Reset to Defaults".

- [ ] **Step 2: Update `extension/src/options.js`**

Implement in `extension/src/options.js`:
- Loading full settings via `GTStorage.getSettings()`.
- Two-way binding for Temperature and Top-P sliders with live value display.
- Preset pill table rendering with delete, edit, move up/down, add new pill, and reset.
- Save handler calling `GTStorage.saveSettings()`.
- Test API key handler sending test request with the selected model and parameters.

- [ ] **Step 3: Verify syntax and headless render**

Run: `node -e "const fs = require('fs'); fs.readFileSync('extension/src/options.html'); fs.readFileSync('extension/src/options.js'); console.log('Options page syntax OK');"`  
Expected: `Options page syntax OK`

- [ ] **Step 4: Commit**

Run:
```bash
git add extension/src/options.html extension/src/options.js
git commit -m "feat: add generation controls, model selector, and preset manager to options page"
```

---

### Task 4: Background Service Worker API & Payload Engine (`background.js`)

**Files:**
- Modify: `extension/src/background.js`
- Create: `test/test-payload.js`

**Interfaces:**
- Consumes: `GTStorage` settings, `REFINE_TEXT` messages, `commands.onCommand`.
- Produces: Outgoing Gemini API payload with `systemInstruction`, `generationConfig` (temperature, topP, adaptive `thinkingConfig`), thought-part filtering, and `COMMAND_TRIGGER_REWRITE` tab messaging.

- [ ] **Step 1: Write test for payload generation and thought extraction**

Create `test/test-payload.js`:
```javascript
const test = require('node:test');
const assert = require('node:assert');

// Test extraction logic for Gemini responses with thoughts
function extractCandidateText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const answerPart = parts.find((p) => !p.thought && typeof p.text === 'string') 
                  ?? parts[parts.length - 1];
  return answerPart?.text;
}

test('extractCandidateText: extracts non-thought answer part when thinking is present', () => {
  const mockResponse = {
    candidates: [
      {
        content: {
          parts: [
            { thought: true, text: 'Let me think about how to make this formal...' },
            { text: '{"rewritten": "Dear Sir, I am writing to confirm..."}' }
          ]
        }
      }
    ]
  };
  const extracted = extractCandidateText(mockResponse);
  assert.strictEqual(extracted, '{"rewritten": "Dear Sir, I am writing to confirm..."}');
});

test('buildGenerationConfig: configures correct parameters and adaptive thinking', () => {
  const { buildGenerationConfig } = require('../extension/src/background-helper.js');

  const config3 = buildGenerationConfig('gemini-3.1-flash-lite', 0.45, 0.9, true);
  assert.strictEqual(config3.temperature, 0.45);
  assert.strictEqual(config3.topP, 0.9);
  assert.deepStrictEqual(config3.thinkingConfig, { thinkingLevel: 'MINIMAL' });

  const config25 = buildGenerationConfig('gemini-2.5-flash', 0.2, 0.95, true);
  assert.deepStrictEqual(config25.thinkingConfig, { thinkingBudget: 0 });

  const config20 = buildGenerationConfig('gemini-2.0-flash', 0.2, 0.95, true);
  assert.strictEqual(config20.thinkingConfig, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/test-payload.js`  
Expected: FAIL with `Cannot find module '../extension/src/background-helper.js'`

- [ ] **Step 3: Create `extension/src/background-helper.js` & update `extension/src/background.js`**

Create `extension/src/background-helper.js` containing reusable helpers (`buildGenerationConfig`, `extractCandidateText`, `parseRewrittenText`) and import it in `background.js` (and export for tests).

Update `extension/src/background.js`:
- Import/load `storage.js` and `background-helper.js`.
- Update `callGemini` to use `extractCandidateText(data)`.
- Update `refineText(text, action, presetId)` to resolve prompt from `settings.customPresets` or legacy actions.
- Pass `settings.systemInstruction`, `settings.temperature`, `settings.topP`, `settings.fastZeroShot` into payload.
- Add `chrome.commands.onCommand.addListener` for `trigger_rewrite` sending `COMMAND_TRIGGER_REWRITE` to active tab.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/test-payload.js`  
Expected: PASS (2 tests pass)

- [ ] **Step 5: Commit**

Run:
```bash
git add extension/src/background.js extension/src/background-helper.js test/test-payload.js
git commit -m "feat: implement adaptive Gemini API payload engine with thought filtering"
```

---

### Task 5: Floating Action Toolbar & Keyboard Navigation (`refine.js`)

**Files:**
- Modify: `extension/src/content/refine.js`
- Modify: `extension/src/content/overlay.js`

**Interfaces:**
- Consumes: `GT.state.settings.customPresets`, `COMMAND_TRIGGER_REWRITE`.
- Produces: Dynamic action pills in floating toolbar, keyboard navigation (ArrowLeft/ArrowRight, Tab, Enter, Esc), shortcut opening.

- [ ] **Step 1: Update floating toolbar in `extension/src/content/refine.js`**

Implement:
- Reading presets from `GT.state.settings.customPresets` instead of static `ACTIONS`.
- Dynamic button rendering for each preset.
- Keyboard navigation inside toolbar:
  - ArrowRight / ArrowLeft / Tab moves focus between pill buttons.
  - Enter clicks active button.
  - Escape calls `hide()` and restores focus to the underlying editable field without clearing selection.
- Listen for `COMMAND_TRIGGER_REWRITE`:
  - Capture selection via `captureSelection()`.
  - If captured: call `show()` and focus first pill.
  - If not captured: call `GT.ui.toast('GemType: select text first to rewrite')`.

- [ ] **Step 2: Update styles in `extension/src/content/overlay.js`**

Add CSS rules in `GT.ui.STYLE`:
- Pill focus styles: `.gt-toolbar button:focus { outline: 2px solid #10a37f; outline-offset: 1px; background: #3a3f45; color: #fff; }`.

- [ ] **Step 3: Commit**

Run:
```bash
git add extension/src/content/refine.js extension/src/content/overlay.js
git commit -m "feat: add dynamic preset pills and keyboard navigation to refine toolbar"
```

---

### Task 6: Interactive Preview Tooltip & Undo Replacement (`refine.js`, `overlay.js`, `content.js`)

**Files:**
- Modify: `extension/src/content/overlay.js`
- Modify: `extension/src/content/refine.js`
- Modify: `test/harness.html`

**Interfaces:**
- Consumes: `settings.previewBeforeReplace`, Gemini rewritten text.
- Produces: Floating preview card with Accept (`Enter`) and Discard (`Esc`) buttons, direct replace fallback, undo-preserving replacement.

- [ ] **Step 1: Add Preview Tooltip Component in `extension/src/content/overlay.js`**

Implement `GT.preview`:
- `open({ title, text, anchor, onAccept, onDiscard })`:
  - Renders `.gt-preview-card` in shadow DOM.
  - Shows title (e.g. `Preview: Formal`).
  - Shows scrollable text box containing the rewritten text.
  - Shows buttons: `Accept (Enter)` and `Discard (Esc)`.
  - Keyboard listener: `Enter` triggers `onAccept()`, `Escape` triggers `onDiscard()`.
  - Outside click triggers `onDiscard()`.
- `close()`: cleanly removes the preview card and cleans up listeners.

- [ ] **Step 2: Connect Preview in `extension/src/content/refine.js`**

In `run(preset, captured)`:
- When Gemini returns `{ rewritten }`:
  - Check `GT.state.settings.previewBeforeReplace`.
  - If `false`: immediately call `GT.replaceRange(job.field, start, end, rewritten)` and show undo toast.
  - If `true`: call `GT.preview.open(...)`:
    - On Accept: call `GT.replaceRange(...)`, show undo toast, close preview.
    - On Discard: close preview, leave text untouched.

- [ ] **Step 3: Update `test/harness.html`**

Update `test/harness.html` to support testing custom presets, preview toggle, and rewrite actions with mock Gemini responses.

- [ ] **Step 4: Commit**

Run:
```bash
git add extension/src/content/overlay.js extension/src/content/refine.js test/harness.html
git commit -m "feat: implement floating preview tooltip with Enter and Esc controls"
```

---

### Task 7: Verification & Acceptance Testing

**Files:**
- Modify/Run: `test/test-storage.js`
- Modify/Run: `test/test-payload.js`
- Create: `test/test-integration.js`

**Interfaces:**
- Verifies all acceptance criteria from the spec.

- [ ] **Step 1: Write integration tests in `test/test-integration.js`**

Create `test/test-integration.js` to verify:
1. Changing temperature visibly affects `generationConfig.temperature`.
2. Model parameter handles `gemini-3.1-flash-lite` without malformed config.
3. Custom presets can be added, updated, and deleted.
4. Parsing handles both clean JSON and thought-polluted parts.

- [ ] **Step 2: Run all test suites**

Run: `node --test test/*.js`  
Expected: All tests pass with exit code 0.

- [ ] **Step 3: Commit**

Run:
```bash
git add test/test-integration.js
git commit -m "test: add integration test suite verifying acceptance criteria"
```
