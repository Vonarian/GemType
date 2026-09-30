# GemType Extension — Minimum Text Analysis Threshold Specification

**Date:** 2026-09-30  
**Status:** Approved  
**Target:** GemType Manifest V3 Extension  

---

## 1. Overview & Objective

GemType performs automated background grammar and style checking on editable fields (`textarea`, `input`, `contenteditable`). Previously, a static minimum length of 8 characters was hardcoded (`MIN_LEN = 8`). 

The goal of this feature is to make this minimum text threshold user-configurable via settings:
- Prevents checking short inputs (names, search queries, single words, codes).
- Reduces unnecessary Google Gemini API calls, saving rate limits and quota.
- Provides immediate visual feedback in the Settings UI with a slider, number input, and quick-preset buttons.

---

## 2. Configuration & Storage Schema

In [`storage.js`](file:///Users/vonar/src/GemType/extension/src/storage.js):
- Add `minTextLength: 15` (integer, range: 5 to 200) to `DEFAULT_CONFIG`.
- When loading settings: if `minTextLength` is missing or invalid, default to `15`.
- Synchronized via `chrome.storage.sync` with automatic `chrome.storage.local` fallback.

```javascript
const DEFAULT_CONFIG = {
  // ...existing configs...
  minTextLength: 15,
};
```

---

## 3. Settings UI (`options.html` / `options.js`)

In [`options.html`](file:///Users/vonar/src/GemType/extension/src/options.html) (inside the Generation & Behavior card or a dedicated card):
- **Slider & Number Input:**
  - `<input type="range" id="minTextLength" min="5" max="200" step="1" value="15">`
  - Live numerical badge: `<span id="minTextLengthVal">15</span> chars`
- **Quick Preset Buttons:**
  - `10` — Phrases / Short
  - `15` — Standard (Default)
  - `30` — Sentences only
  - `50` — Paragraphs only
- **Helpful Hint:**
  - *"Editable fields with fewer characters will not trigger automatic grammar checks, conserving Gemini API usage."*

In [`options.js`](file:///Users/vonar/src/GemType/extension/src/options.js):
- Load `minTextLength` in `load()`.
- Synchronize slider input events with `#minTextLengthVal`.
- Collect integer `parseInt($('#minTextLength').value, 10)` in `collect()`.

---

## 4. Content Script & Background Enforcement

### 4.1 Content Script (`content.js`)
- Replace the constant `MIN_LEN = 8` with a dynamic getter:
  ```javascript
  function getMinTextLength() {
    const n = parseInt(GT.state?.settings?.minTextLength, 10);
    return Number.isFinite(n) && n >= 1 ? n : 15;
  }
  ```
- In `check()`:
  ```javascript
  const minLen = getMinTextLength();
  if (trimmed.length < minLen || text.length > MAX_LEN) {
    this.corrections = [];
    this.overlay.setCorrections([]);
    this.overlay.setState('idle');
    this.lastCheckedText = text;
    return;
  }
  ```
- In `sentenceRecheck(aroundIndex)`:
  ```javascript
  if (sentence.trim().length < getMinTextLength()) return;
  ```

### 4.2 Background Service Worker (`background.js`)
- In `checkText(text)`:
  ```javascript
  const minLen = parseInt(settings.minTextLength, 10) || 15;
  if (!text || text.trim().length < minLen) {
    return { corrections: [] };
  }
  ```
- Ensures that even if a message is sent directly or from legacy components, the threshold is strictly respected before calling Gemini.

---

## 5. Verification & Testing

- Unit tests in `test/test-storage.js` verifying `minTextLength` default and persistence.
- Unit tests in `test/test-options.js` verifying the threshold slider, presets, and bindings.
- Integration test verifying that text shorter than `minTextLength` does NOT trigger Gemini API calls, while text $\ge$ `minTextLength` proceeds normally.
