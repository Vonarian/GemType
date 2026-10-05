<div align="center">

<img src="extension/icons/icon128.png" alt="TypeSpark" width="96" />

# TypeSpark — AI Writing & Tone Assistant

**A fast, private, open-source AI writing, grammar, and tone assistant for your browser — powered by your own Gemini API key.**

[![Manifest V3](https://img.shields.io/badge/manifest-v3-6366f1)](extension/manifest.json)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-D22128.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/Vonarian/TypeSpark/pulls)

### [➜ Download Latest Release (Chrome / Brave / Edge / Firefox)](https://github.com/Vonarian/TypeSpark/releases/latest)

*Forked from and built upon [GemType](https://github.com/riponcm/GemType) (Apache-2.0) with full generation parameter controls, custom rewrite preset pills, interactive preview tooltips, keyboard navigation, and configurable minimum text thresholds.*

<img src="assets/hero.svg" alt="TypeSpark demo: typing with mistakes, wavy underlines appear, one click fixes them" width="820" />

</div>

---

## Features

- **Live grammar and spelling checking** — underlines appear in any text field about a second after you stop typing: Gmail, LinkedIn, X, Reddit, GitHub, anywhere
- **One-click fixes** — click an underline and accept the correction; `Ctrl/Cmd+Z` always undoes
- **Sentence verification** — after every accepted fix, the surrounding sentence is automatically re-checked, so word-level fixes never leave broken sentences behind
- **Custom Rewrite Preset Pills (CRUD)** — select text for a floating toolbar with *Improve, Fix & Polish, Concise, Formal,* and *Casual* actions, or create, rename, reorder, and delete your own custom prompt pills in Settings (synced automatically with the right-click context menu)
- **Interactive Preview Tooltip** — preview AI rewrites in a floating card (`Enter` to accept, `Esc` to discard) before replacing text, or toggle direct replacement in Settings
- **Keyboard-First Navigation** — press `Alt+Shift+G` on selected text to trigger the floating rewrite bar, navigate pills with `ArrowLeft`/`ArrowRight`/`Tab`, activate with `Enter`, and dismiss cleanly with `Esc`
- **Generation Parameter Controls** — configure **Temperature** (`0.00–2.00`), **Top-P** (`0.00–1.00`), custom **System Instructions**, and **Fast Zero-Shot Mode** (adaptive `thinkingConfig` for Gemini 3.x and 2.5 models)
- **Minimum Text Length Threshold** — set a character threshold (`5–200` chars, default `15`) so short phrases or search queries never waste API calls
- **Bring your own key (100% Private)** — uses your free [Google AI Studio](https://aistudio.google.com/apikey) key; no account, no subscription, no middleman server, zero telemetry

## Comparison with Grammarly

| | TypeSpark | Grammarly |
|---|---|---|
| Price | Free — bring your own Gemini key ([free tier](https://aistudio.google.com/apikey), no card required) | Free plan is limited; Premium \$12–30 per month |
| Grammar and spelling fixes | Unlimited | Full corrections require Premium |
| Sentence re-check after each accepted fix | Automatic | Not available |
| Custom AI rewrite pills & prompts | Unlimited custom presets | Premium only (fixed presets) |
| Generation controls (Temp, Top-P, System Prompt) | Included | Not available |
| Minimum character threshold | Configurable (`5–200` chars) | Not available |
| Languages | Any language Gemini understands, auto-detected | English and a small set of variants |
| Trackers and analytics | None | Product analytics and telemetry |
| Where your text is processed | Google's Gemini API only, with your key — no middleman server | Grammarly's servers |
| Open source | Yes (Apache 2.0) | No |

## Screenshots

| | |
|---|---|
| ![Live checking with underlines and the issue-count badge](assets/screenshots/underlines.png) | ![Suggestion card with one-click Accept](assets/screenshots/card.png) |
| *Live checking — underlines and issue-count badge* | *Click an underline, accept the fix* |
| ![All suggestions in one panel](assets/screenshots/panel.png) | ![Rewrite toolbar on selected text](assets/screenshots/toolbar.png) |
| *Review all suggestions from the badge* | *Select text to rewrite with custom preset pills* |

## Install

### Firefox
Install from **Firefox Add-ons (AMO)** or download `typespark-firefox-v0.1.6.zip` from the [latest GitHub Release](https://github.com/Vonarian/TypeSpark/releases/latest).

### Chrome / Brave / Edge (Developer Mode)
1. Download `typespark-chrome-v0.1.6.zip` from the [latest GitHub Release](https://github.com/Vonarian/TypeSpark/releases/latest) (or clone this repository).
2. Open `chrome://extensions` (or `brave://extensions`) and enable **Developer mode**.
3. Drag and drop the `.zip` onto the page, or click **Load unpacked** and select the `extension/` folder.
4. Get a free API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (no credit card required).
5. Open TypeSpark **Settings** from the toolbar icon, paste your key, and click **Save & test key**.

## How it works

```
             page (any website)
┌──────────────────────────────────────────┐
│  content script                          │
│  ├─ detects textarea / contenteditable   │
│  ├─ draws underline overlay (shadow DOM, │
│  │   never touches the page's editor)    │
│  └─ applies fixes via execCommand        │
│      (native undo + framework-safe)      │
└──────────────┬───────────────────────────┘
               │ chrome.runtime messaging
┌──────────────▼───────────────────────────┐
│  background service worker               │
│  ├─ queue + cache + 429 backoff          │
│  ├─ adaptive thinkingConfig (3.x / 2.5)  │
│  └─ Gemini generateContent               │
│      (structured JSON output)            │
└──────────────┬───────────────────────────┘
               ▼
   generativelanguage.googleapis.com
        (your API key, your data)
```

## Privacy

- The text you are editing is sent **only** to `generativelanguage.googleapis.com` (Google's Gemini API) using your own key — see [PRIVACY.md](PRIVACY.md)
- Your API key lives strictly in `chrome.storage.local` on your device; it is never synced to `chrome.storage.sync` or transmitted anywhere else
- Password fields, payment fields (`cc-*`), and one-time-code fields are skipped at the code level
- No accounts, no telemetry, no third-party servers

## Project structure

```
extension/              the browser extension (MV3, no build step) — Chrome, Brave, Edge, Firefox
├── manifest.json           Chrome / Brave / Edge manifest
├── manifest.firefox.json   Firefox (AMO) manifest — background scripts + gecko id
└── src/
    ├── storage.js          Unified storage layer (sync preferences + local API key)
    ├── background-helper.js Adaptive Gemini payload builder & response parser
    ├── background.js       Gemini API calls, cache, rate limiting, dynamic context menus
    ├── content/
    │   ├── content.js      Field discovery, threshold guard, checking loop
    │   ├── overlay.js      Underlines, badge, suggestion card, preview tooltip
    │   ├── refine.js       Selection rewrite toolbar & keyboard navigation
    │   └── util.js         Text extraction, offset maps, undo-safe replacement
    ├── options.html/js     API key, generation parameters, preset CRUD, threshold slider
    └── popup.html/js       Global + per-site toggles
test/                   Unit & integration test suite (Node test runner + mock harness)
```

## Development & Testing

```bash
# Run the full unit and integration test suite (52 tests)
node --test test/*.js

# Run the interactive browser mock harness (no API key needed)
python3 -m http.server 8377
open http://localhost:8377/test/harness.html
```

## License & Attribution

[Apache License 2.0](LICENSE) — see [NOTICE](NOTICE).

TypeSpark is a fork of [GemType](https://github.com/riponcm/GemType) originally created by Ripon Chandra Malo ([Matily](https://matily.org)). In accordance with [TRADEMARK.md](TRADEMARK.md), this fork is independently branded as **TypeSpark** with its own name and icon.
