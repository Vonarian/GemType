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

if (typeof globalThis !== 'undefined') {
  globalThis.GTStorage = GTStorage;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GTStorage };
}
