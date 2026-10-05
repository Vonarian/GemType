# TypeSpark Privacy Policy

*Last updated: October 5, 2026*

TypeSpark is a browser extension that checks grammar and rewrites text using
Google's Gemini API. It is designed so that **we (the developers) never see,
receive, or store any of your data**. There is no TypeSpark server.

## What data is processed, and where it goes

- **Text you are actively editing.** When you type in a text field on a
  website (and TypeSpark is enabled for that site, and the text meets your
  configured minimum character threshold), the text of that field is
  sent to **Google's Gemini API** (`generativelanguage.googleapis.com`) to
  detect errors or produce a rewrite you requested. This is the extension's
  single purpose. The request is made directly from your browser to Google
  using **your own API key** — it never passes through any server of ours.
  Google's handling of this data is governed by the
  [Google API Terms](https://developers.google.com/terms) and the
  [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms).
- **Your Gemini API key.** Stored strictly on your device in
  `chrome.storage.local`. It is never synced to `chrome.storage.sync` and is
  sent only to `generativelanguage.googleapis.com` as authentication.
- **Your preferences** (model choice, temperature, top-p, system instruction,
  custom rewrite presets, minimum text length threshold, language, disabled
  sites, on/off state). Stored in browser storage (`chrome.storage.sync` with
  fallback to `chrome.storage.local`).

## What we do NOT do

- No analytics, telemetry, or usage tracking of any kind
- No accounts, no sign-up, no cookies
- No data sold, shared, or transmitted to anyone other than Google's Gemini
  API as described above
- No browsing-history collection; the extension reads only the text fields
  you actively edit, and only on sites where it is enabled
- **Password fields are never read** (`<input type="password">` is excluded
  by design), and fields marked as payment (`autocomplete="cc-*"`),
  one-time-code, or password-manager fields are skipped as well
- No remote code — all extension code ships in the package

## Your controls

- Disable TypeSpark globally or per-site from the toolbar popup
- Configure a minimum text length threshold so short inputs never trigger API calls
- Website owners can opt fields out with `data-gemtype="false"`
- Uninstalling the extension deletes all stored settings, including your API key
- Avoid using TypeSpark in fields containing passwords or other secrets; text
  in checked fields is processed by Google's cloud API

## Permissions explained

| Permission | Why |
|---|---|
| `storage` | Save your API key (`storage.local`) and preferences (`storage.sync`) |
| `contextMenus` | The right-click "TypeSpark" rewrite menu |
| `generativelanguage.googleapis.com` | The Gemini API endpoint — the only network destination |
| Content scripts on all sites | Grammar checking and inline rewriting must run inside the text fields of whatever site you write on; it stays inert until you focus a field |

## Contact

Questions or concerns: open an issue on the
[GitHub repository](https://github.com/Vonarian/TypeSpark/issues).
