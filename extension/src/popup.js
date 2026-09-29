'use strict';

if (typeof browser !== 'undefined') globalThis.chrome = browser;

const $ = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);

let settings = null;
let hostname = null;

async function load() {
  if (typeof GTStorage !== 'undefined' && GTStorage.getSettings) {
    settings = await GTStorage.getSettings();
  } else {
    const stored = await chrome.storage.local.get(['settings', 'apiKey']);
    settings = {
      enabled: true,
      apiKey: stored.apiKey || (stored.settings && stored.settings.apiKey) || '',
      disabledSites: [],
      ...(stored.settings || {}),
    };
  }

  // Ask the content script (top frame) for the hostname instead of reading
  // tab.url — this avoids needing the "activeTab" permission entirely.
  const [tab] = (await chrome.tabs?.query?.({ active: true, currentWindow: true })) || [];
  hostname = null;
  if (tab?.id != null && chrome.tabs?.sendMessage) {
    try {
      const res = await chrome.tabs.sendMessage(
        tab.id,
        { type: 'GET_HOSTNAME' },
        { frameId: 0 }
      );
      hostname = res?.hostname || null;
    } catch {
      hostname = null; // no content script here (chrome://, web store, PDF…)
    }
  }

  if ($('enabled')) $('enabled').checked = settings.enabled !== false;
  if ($('noKey')) $('noKey').style.display = settings.apiKey ? 'none' : 'block';

  if (hostname) {
    if ($('host')) $('host').textContent = hostname;
    if ($('site')) $('site').checked = !(settings.disabledSites || []).includes(hostname);
  } else {
    if ($('host')) $('host').textContent = 'unavailable on this page';
    if ($('site')) $('site').disabled = true;
  }
}

async function persist() {
  if (typeof GTStorage !== 'undefined' && GTStorage.saveSettings) {
    await GTStorage.saveSettings(settings, settings.apiKey);
  } else {
    await chrome.storage.local.set({ settings });
  }
}

if ($('enabled')) {
  $('enabled').addEventListener('change', async (e) => {
    if (!settings) settings = {};
    settings.enabled = e.target.checked;
    await persist();
  });
}

if ($('site')) {
  $('site').addEventListener('change', async (e) => {
    if (!hostname || !settings) return;
    const list = new Set(settings.disabledSites || []);
    if (e.target.checked) list.delete(hostname);
    else list.add(hostname);
    settings.disabledSites = [...list];
    await persist();
  });
}

if ($('options')) {
  $('options').addEventListener('click', () => chrome.runtime?.openOptionsPage?.());
}
if ($('setKey')) {
  $('setKey').addEventListener('click', () => chrome.runtime?.openOptionsPage?.());
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && $('enabled')) {
  load();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    load,
    persist,
    getSettings: () => settings,
    setSettings: (s) => { settings = s; },
    getHostname: () => hostname,
    setHostname: (h) => { hostname = h; },
  };
}
