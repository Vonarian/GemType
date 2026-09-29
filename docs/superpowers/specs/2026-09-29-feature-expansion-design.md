# GemType Extension — Feature Expansion Design Specification

**Date:** 2026-09-29  
**Status:** Approved  
**Target:** GemType Manifest V3 Extension  

---

## 1. Overview & Objectives

GemType provides inline AI-powered grammar checking and text rewriting via direct Google AI Studio Gemini API calls. It adheres strictly to a zero-telemetry, client-only architecture: no backend servers, no intermediate tracking, and all keys stored securely on-device.

This specification details the architecture, schemas, and UI/UX flows for:
1. **Generation Parameter Controls:** Temperature slider (0.0 to 2.0), Top-P slider, editable global System Instruction, and fast zero-shot thinking config.
2. **Modernized Model Selection:** Default to `gemini-3.1-flash-lite`, with support for `gemini-2.5-flash`, `gemini-2.0-flash`, and arbitrary custom model IDs.
3. **Custom Rewrite Presets (Custom Pills):** Full CRUD in Settings; dynamic rendering of action pills in the content script toolbar.
4. **Interactive Preview vs. Immediate Replace:** Settings toggle; floating preview tooltip with `Enter` (Accept) and `Esc` (Discard) controls.
5. **Keyboard Shortcut Support:** `Alt+Shift+G` (or `Ctrl+Shift+E` / `MacCtrl+Shift+E`) command triggering keyboard-navigable rewrite pills.
6. **API Robustness:** Thought-part filtering, adaptive `thinkingConfig` handling across Gemini 2.0 / 2.5 / 3.x models, and reliable undo history (`Ctrl+Z`).

---

## 2. Storage & Configuration Architecture

### 2.1 Storage Separation (`chrome.storage.sync` + `chrome.storage.local`)
To balance cross-device profile synchronization with security and quota safety:
* **`chrome.storage.sync` (`gemtype_config`):** Stores user preferences and presets.
* **`chrome.storage.local` (`gemtype_secrets` / legacy `settings`):** Exclusively stores the `apiKey`.
* **Fallback & Migration:** When reading settings, GemType merges sync preferences with local secrets, seamlessly falling back to local storage if sync is disabled or quota fails, and auto-migrating any legacy settings from `chrome.storage.local`.

### 2.2 Configuration Schema
```javascript
const DEFAULT_CONFIG = {
  model: 'gemini-3.1-flash-lite',
  temperature: 0.3,
  topP: 0.95,
  systemInstruction: 'You are an expert writing assistant. Rewrite the provided text according to instructions. Output ONLY the final replacement text without notes, preambles, or conversational filler.',
  previewBeforeReplace: true,
  fastZeroShot: true, // Optimizes thinkingConfig for lowest latency
  customPresets: [
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
  ],
  disabledSites: [],
  language: 'auto',
  enabled: true
};
```

---

## 3. Options & Settings UI (`options.html` / `options.js`)

### 3.1 Parameter Controls
* **Temperature Slider:**
  * Range: `0.00` to `2.00`, step `0.05`, default `0.30`.
  * Live numerical readout (`<span id="tempVal">0.30</span>`).
  * Quick-preset buttons:
    * `0.10` — Strict / Grammar
    * `0.70` — Balanced
    * `1.20` — Creative
* **Top-P Slider:**
  * Range: `0.00` to `1.00`, step `0.05`, default `0.95`, with live numerical readout.
* **System Instruction:**
  * Multi-line textarea.
  * Includes a "Reset to Default" button.
* **Fast Zero-Shot Toggle:**
  * Checkbox: "Fast zero-shot mode (minimize reasoning tokens for lowest latency)".
* **Workflow Option:**
  * Checkbox: "Show preview before replacing text" (default: checked).

### 3.2 Model Selector
* Dropdown options:
  * `gemini-3.1-flash-lite` (Recommended Default)
  * `gemini-2.5-flash`
  * `gemini-2.0-flash`
  * `__custom__` ("Custom…")
* When `__custom__` is chosen, an input box for the custom model string appears.

### 3.3 Custom Preset Manager (CRUD)
* Presets list table/cards showing:
  * Drag/Reorder buttons (Move Up / Down)
  * Preset Label (rendered on the pill)
  * Prompt instructions
  * Edit & Delete action buttons
* "Add Custom Preset" section:
  * Modal or expandable row with inputs for `Label` and `Prompt Template`.
  * Unique ID generation (`preset_` + timestamp).
  * Validation: non-empty label, non-empty prompt.
* "Reset to Defaults" button to restore built-in presets.

---

## 4. Background Service Worker & API Engine (`background.js`)

### 4.1 Unified Gemini Request Builder
```javascript
function buildGenerationConfig(model, temperature, topP, fastZeroShot) {
  const config = {
    temperature: parseFloat(temperature ?? 0.3),
    topP: parseFloat(topP ?? 0.95),
    maxOutputTokens: 2048,
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT',
      properties: {
        rewritten: { type: 'STRING' }
      },
      required: ['rewritten']
    }
  };

  if (fastZeroShot) {
    if (model.startsWith('gemini-3')) {
      config.thinkingConfig = { thinkingLevel: 'MINIMAL' };
    } else if (model.startsWith('gemini-2.5')) {
      config.thinkingConfig = { thinkingBudget: 0 };
    }
  }

  return config;
}
```

### 4.2 Payload Construction
* Header: `'x-goog-api-key': settings.apiKey`
* Body:
  ```json
  {
    "contents": [
      {
        "role": "user",
        "parts": [{ "text": "<presetPrompt>\n\n\"<selectedText>\"" }]
      }
    ],
    "systemInstruction": {
      "parts": [{ "text": "<systemInstruction>" }]
    },
    "generationConfig": { ... }
  }
  ```

### 4.3 Safe Response Extraction (Fix for Thought-Part Pollution)
To prevent `BAD_JSON` crashes when Gemini reasoning models emit thinking chunks:
```javascript
const parts = data?.candidates?.[0]?.content?.parts || [];
const answerPart = parts.find((p) => !p.thought && typeof p.text === 'string') 
                ?? parts[parts.length - 1];
const rawText = answerPart?.text;
```
Parsing fallback:
1. `JSON.parse(rawText).rewritten`
2. If JSON parsing fails or field missing, strip enclosing quotes and markdown code fences to recover plain rewritten text directly.

### 4.4 Keyboard Command Listener
Listen to `chrome.commands.onCommand`:
* On `"trigger_rewrite"`, dispatch `{ type: 'COMMAND_TRIGGER_REWRITE' }` to the active tab's top/focused frame.

---

## 5. Content Script & UX Interactions (`refine.js`, `overlay.js`, `content.js`)

### 5.1 Dynamic Floating Action Toolbar
* Floating toolbar dynamically reads `settings.customPresets` from storage.
* Buttons display the preset `label`.
* **Keyboard Navigation:**
  * Left / Right arrows or Tab / Shift+Tab move focus between buttons.
  * `Enter` executes the focused preset.
  * `Esc` dismisses the toolbar without touching selection.

### 5.2 Shortcut Handler (`Alt+Shift+G`)
* When `COMMAND_TRIGGER_REWRITE` is received:
  * Capture active selection (handling shadow DOM roots such as LinkedIn).
  * If valid selection exists: anchor and show the floating toolbar immediately, focusing the first pill.
  * If no text is selected: display toast `"GemType: select text first to rewrite"`.

### 5.3 Preview vs. Direct Replace
* **Direct Replace (`previewBeforeReplace: false`):**
  * Immediately replaces text using `GT.replaceRange()`.
  * Shows toast: `"Rewritten — press Ctrl/Cmd+Z to undo"`.
* **Preview Mode (`previewBeforeReplace: true`):**
  * Opens a Floating Preview Tooltip inside GemType's shadow DOM root:
    * Header: `"Preview: <Preset Label>"`
    * Body: Scrollable box showing rewritten text.
    * Footer:
      * **Accept Button** (labeled `Accept ↵` or `Enter`)
      * **Discard Button** (labeled `Discard Esc`)
    * Hotkey capture inside preview:
      * Pressing `Enter` accepts and applies rewrite via `GT.replaceRange()`.
      * Pressing `Escape` discards and closes preview.
      * Mousedown outside the preview card dismisses it.

### 5.4 Undo Preservation
* Standard `<textarea>` / `<input>`: use `setSelectionRange()` + `document.execCommand('insertText')`, preserving the browser undo stack (`Ctrl+Z` / `Cmd+Z`).
* `contenteditable`: use `textRangeToDomRange()` + `document.execCommand('insertText')` with direct DOM surgery fallback.

---

## 6. Manifest Updates (`manifest.json` & `manifest.firefox.json`)

```json
"commands": {
  "trigger_rewrite": {
    "suggested_key": {
      "default": "Alt+Shift+G",
      "mac": "Alt+Shift+G"
    },
    "description": "Trigger inline rewriting on current selection"
  }
}
```
Permissions: `"storage"`, `"contextMenus"`.  
Host permissions: `"https://generativelanguage.googleapis.com/*"`.

---

## 7. Testing & Verification Plan

1. **Automated Unit & Harness Verification:**
   * Extend `test/harness.html` with tests for:
     * Custom preset pill rendering.
     * Keyboard navigation (`ArrowRight`, `Enter`, `Escape`).
     * Preview tooltip accept/discard lifecycle.
     * `Alt+Shift+G` event dispatch.
2. **Settings Persistence:**
   * Verify temperature, topP, customPresets persist across `chrome.storage.sync` and load in options.
3. **Payload Verification:**
   * Verify generated payload includes `temperature`, `topP`, `systemInstruction`, and `thinkingConfig`.
4. **Undo Stack:**
   * Verify `Ctrl+Z` restores original text after replacement in textarea and contenteditable.
