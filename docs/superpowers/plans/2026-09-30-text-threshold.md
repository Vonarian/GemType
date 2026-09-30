# Minimum Text Analysis Threshold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-configurable minimum text threshold (`minTextLength`, default `15` chars) so GemType does not automatically analyze short inputs, conserving Gemini API usage and reducing noise.

**Architecture:** Add `minTextLength` to `DEFAULT_CONFIG` in `storage.js`; add a slider with live readout and quick presets in `options.html` / `options.js`; enforce dynamically in `content.js` and as a defense-in-depth guard in `background.js`; verify with automated tests.

**Tech Stack:** JavaScript (ES2022 / WebExtensions Manifest V3), HTML5, CSS3, Node.js (test runner).

## Global Constraints
- Zero telemetry, zero external tracking, zero intermediate backend servers.
- Direct client-to-API communication using `chrome.storage` and `fetch`.
- All injected content UI must reside inside GemType's isolated shadow DOM root (`<gemtype-ext>`).
- Preserve native browser undo stack (`Ctrl+Z` / `Cmd+Z`) for text replacements.

---

### Task 1: Storage Schema & Defaults (`storage.js` & `test/test-storage.js`)

**Files:**
- Modify: `extension/src/storage.js`
- Modify: `test/test-storage.js`

**Interfaces:**
- Produces: `GTStorage.DEFAULT_CONFIG.minTextLength = 15`.
- Consumes: `GTStorage.getSettings()`, `GTStorage.saveSettings()`.

- [ ] **Step 1: Write test for `minTextLength` in `test/test-storage.js`**

Add test asserting `minTextLength` defaults to `15` and can be saved and retrieved.

- [ ] **Step 2: Run test to verify failure**

Run: `node --test test/test-storage.js`

- [ ] **Step 3: Update `extension/src/storage.js`**

Add `minTextLength: 15` to `DEFAULT_CONFIG`. In `getSettings()`, ensure `minTextLength` is parsed as a valid positive integer (default `15`).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/test-storage.js`

- [ ] **Step 5: Commit**

Run:
```bash
git add extension/src/storage.js test/test-storage.js
git commit -m "feat: add minTextLength to storage defaults and schema"
```

---

### Task 2: Options Page UI Controls (`options.html` & `options.js`)

**Files:**
- Modify: `extension/src/options.html`
- Modify: `extension/src/options.js`
- Modify: `test/test-options.js`

**Interfaces:**
- Produces: Interactive slider `#minTextLength`, readout `#minTextLengthVal`, quick preset buttons (`10`, `15`, `30`, `50`), and persistence via `GTStorage`.

- [ ] **Step 1: Write tests in `test/test-options.js`**

Add tests verifying `#minTextLength` element existence, readout synchronization, and preset button activation.

- [ ] **Step 2: Update `extension/src/options.html`**

Add slider, readout badge, preset buttons, and description under Generation & Behavior.

- [ ] **Step 3: Update `extension/src/options.js`**

Wire `minTextLength` in `load()`, `collect()`, slider `input` event listener, and preset buttons.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/test-options.js`

- [ ] **Step 5: Commit**

Run:
```bash
git add extension/src/options.html extension/src/options.js test/test-options.js
git commit -m "feat: add minimum text length controls to options page"
```

---

### Task 3: Content Script & Background Guard (`content.js` & `background.js`)

**Files:**
- Modify: `extension/src/content/content.js`
- Modify: `extension/src/background.js`
- Create: `test/test-threshold.js`

**Interfaces:**
- Produces: Dynamic threshold filtering in `content.js` and server worker level guard in `background.js`.

- [ ] **Step 1: Create `test/test-threshold.js`**

Write test verifying that inputs shorter than `minTextLength` do not trigger check/API requests, and inputs $\ge$ `minTextLength` proceed.

- [ ] **Step 2: Run test to verify failure**

Run: `node --test test/test-threshold.js`

- [ ] **Step 3: Update `extension/src/content/content.js` and `extension/src/background.js`**

In `content.js`: replace `MIN_LEN = 8` with dynamic getter `getMinTextLength()`.
In `background.js`: in `checkText(text)`, guard against `text.trim().length < (parseInt(settings.minTextLength, 10) || 15)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/test-threshold.js`

- [ ] **Step 5: Commit**

Run:
```bash
git add extension/src/content/content.js extension/src/background.js test/test-threshold.js
git commit -m "feat: enforce minTextLength in content script checking loop and background worker"
```

---

### Task 4: Regression Testing & Packaging

**Files:**
- Run: `node --test test/*.js`
- Rebuild: `.zip` packages in `dist/`

- [ ] **Step 1: Run all test suites**

Run: `node --test test/*.js`

- [ ] **Step 2: Rebuild distribution packages**

Rebuild `dist/gemtype-chrome-v0.1.6.zip` and `dist/gemtype-firefox-v0.1.6.zip`.

- [ ] **Step 3: Commit**

Run:
```bash
git commit --allow-empty -m "chore: verify tests and refresh extension distribution packages"
```
