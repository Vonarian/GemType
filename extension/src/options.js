'use strict';

if (typeof browser !== 'undefined') globalThis.chrome = browser;

const KNOWN_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
];

const $ = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);

let currentPresets = [];
let editingPresetId = null;

function setStatus(text, ok) {
  const el = $('status');
  if (!el) return;
  el.textContent = text;
  el.className = ok ? 'ok' : 'err';
}

function renderPresets() {
  const container = $('presetsList');
  if (!container) return;
  container.innerHTML = '';

  if (currentPresets.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'hint';
    emptyMsg.style.padding = '8px 0';
    emptyMsg.textContent =
      'No presets defined. Click "Reset to defaults" to restore built-in presets.';
    container.appendChild(emptyMsg);
    return;
  }

  currentPresets.forEach((preset, index) => {
    const item = document.createElement('div');
    const isEditing = editingPresetId === preset.id;
    item.className = 'preset-item' + (isEditing ? ' editing' : '');
    item.dataset.id = preset.id;

    if (isEditing) {
      const editLabel = document.createElement('input');
      editLabel.type = 'text';
      editLabel.value = preset.label;
      editLabel.placeholder = 'Preset label';
      editLabel.className = 'edit-label';

      const editPrompt = document.createElement('textarea');
      editPrompt.rows = 2;
      editPrompt.value = preset.prompt;
      editPrompt.placeholder = 'Prompt instruction';
      editPrompt.className = 'edit-prompt';

      const actionRow = document.createElement('div');
      actionRow.style.display = 'flex';
      actionRow.style.gap = '6px';
      actionRow.style.justifyContent = 'flex-end';

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'btn-sm primary';
      saveBtn.textContent = 'Done';
      saveBtn.addEventListener('click', () => {
        const newLabel = editLabel.value.trim();
        const newPrompt = editPrompt.value.trim();
        if (!newLabel || !newPrompt) {
          setStatus('Preset label and prompt cannot be empty', false);
          return;
        }
        preset.label = newLabel;
        preset.prompt = newPrompt;
        editingPresetId = null;
        renderPresets();
      });

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn-sm ghost';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => {
        editingPresetId = null;
        renderPresets();
      });

      actionRow.appendChild(saveBtn);
      actionRow.appendChild(cancelBtn);

      item.appendChild(editLabel);
      item.appendChild(editPrompt);
      item.appendChild(actionRow);
    } else {
      // Reorder buttons
      const reorderDiv = document.createElement('div');
      reorderDiv.className = 'preset-reorder';

      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'btn-icon';
      upBtn.title = 'Move up';
      upBtn.textContent = '▲';
      upBtn.disabled = index === 0;
      upBtn.addEventListener('click', () => {
        if (index > 0) {
          const temp = currentPresets[index - 1];
          currentPresets[index - 1] = currentPresets[index];
          currentPresets[index] = temp;
          renderPresets();
        }
      });

      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = 'btn-icon';
      downBtn.title = 'Move down';
      downBtn.textContent = '▼';
      downBtn.disabled = index === currentPresets.length - 1;
      downBtn.addEventListener('click', () => {
        if (index < currentPresets.length - 1) {
          const temp = currentPresets[index + 1];
          currentPresets[index + 1] = currentPresets[index];
          currentPresets[index] = temp;
          renderPresets();
        }
      });

      reorderDiv.appendChild(upBtn);
      reorderDiv.appendChild(downBtn);

      // Preset Content
      const contentDiv = document.createElement('div');
      contentDiv.className = 'preset-content';

      const tag = document.createElement('div');
      tag.className = 'preset-label-tag';
      tag.textContent = preset.label;

      const promptText = document.createElement('div');
      promptText.className = 'preset-prompt-text';
      promptText.textContent = preset.prompt;
      promptText.title = preset.prompt;

      contentDiv.appendChild(tag);
      contentDiv.appendChild(promptText);

      // Actions
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'preset-actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn-sm';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => {
        editingPresetId = preset.id;
        renderPresets();
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn-sm danger';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', () => {
        if (currentPresets.length <= 1) {
          setStatus('At least one rewrite preset is required', false);
          return;
        }
        currentPresets.splice(index, 1);
        renderPresets();
      });

      actionsDiv.appendChild(editBtn);
      actionsDiv.appendChild(deleteBtn);

      item.appendChild(reorderDiv);
      item.appendChild(contentDiv);
      item.appendChild(actionsDiv);
    }

    container.appendChild(item);
  });
}

async function load() {
  const s = await GTStorage.getSettings();
  if ($('apiKey')) $('apiKey').value = s.apiKey || '';

  const model = s.model || 'gemini-3.1-flash-lite';
  if ($('model')) {
    if (KNOWN_MODELS.includes(model)) {
      $('model').value = model;
      if ($('customModel')) {
        $('customModel').style.display = 'none';
        $('customModel').value = '';
      }
    } else {
      $('model').value = '__custom__';
      if ($('customModel')) {
        $('customModel').style.display = 'block';
        $('customModel').value = model;
      }
    }
  }

  if ($('language')) $('language').value = s.language || 'auto';

  // Temperature
  const temp =
    typeof s.temperature === 'number' && Number.isFinite(s.temperature)
      ? s.temperature
      : 0.3;
  if ($('temperature')) $('temperature').value = temp;
  if ($('tempVal')) $('tempVal').textContent = temp.toFixed(2);

  // Top-P
  const topP =
    typeof s.topP === 'number' && Number.isFinite(s.topP)
      ? s.topP
      : 0.95;
  if ($('topP')) $('topP').value = topP;
  if ($('topPVal')) $('topPVal').textContent = topP.toFixed(2);

  // Min text length
  const minTextLength = s.minTextLength || 15;
  if ($('minTextLength')) $('minTextLength').value = minTextLength;
  if ($('minTextLengthVal')) $('minTextLengthVal').textContent = minTextLength;

  // System instruction
  if ($('systemInstruction')) {
    $('systemInstruction').value =
      s.systemInstruction || GTStorage.DEFAULT_SYSTEM_INSTRUCTION;
  }

  // Workflow toggles
  if ($('fastZeroShot')) $('fastZeroShot').checked = s.fastZeroShot !== false;
  if ($('previewBeforeReplace')) {
    $('previewBeforeReplace').checked = s.previewBeforeReplace !== false;
  }

  // Presets
  currentPresets =
    Array.isArray(s.customPresets) && s.customPresets.length > 0
      ? JSON.parse(JSON.stringify(s.customPresets))
      : JSON.parse(JSON.stringify(GTStorage.DEFAULT_PRESETS));
  renderPresets();

  // Disabled sites
  if ($('disabledSites')) {
    $('disabledSites').value = (s.disabledSites || []).join('\n');
  }
}

function collect() {
  const modelSelect = $('model');
  const model =
    modelSelect && modelSelect.value === '__custom__'
      ? $('customModel')?.value.trim() || 'gemini-3.1-flash-lite'
      : modelSelect?.value || 'gemini-3.1-flash-lite';

  const tempVal = $('temperature') ? parseFloat($('temperature').value) : 0.3;
  const topPVal = $('topP') ? parseFloat($('topP').value) : 0.95;
  const minTextLength = $('minTextLength')
    ? parseInt($('minTextLength').value, 10) || 15
    : 15;

  return {
    apiKey: $('apiKey') ? $('apiKey').value.trim() : '',
    model,
    language: $('language') ? $('language').value : 'auto',
    temperature: Number.isFinite(tempVal) ? tempVal : 0.3,
    topP: Number.isFinite(topPVal) ? topPVal : 0.95,
    minTextLength,
    systemInstruction:
      $('systemInstruction')?.value.trim() ||
      GTStorage.DEFAULT_SYSTEM_INSTRUCTION,
    fastZeroShot: $('fastZeroShot') ? $('fastZeroShot').checked : true,
    previewBeforeReplace: $('previewBeforeReplace')
      ? $('previewBeforeReplace').checked
      : true,
    customPresets:
      currentPresets.length > 0
        ? currentPresets
        : JSON.parse(JSON.stringify(GTStorage.DEFAULT_PRESETS)),
    disabledSites: $('disabledSites')
      ? $('disabledSites')
          .value.split('\n')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      : [],
    enabled: true,
  };
}

async function save() {
  const all = collect();
  const apiKey = all.apiKey;
  delete all.apiKey;
  const saved = await GTStorage.saveSettings(all, apiKey);
  return { ...saved, apiKey };
}

function initDOMEvents() {
  if (typeof document === 'undefined') return;

  const toggleKey = $('toggleKey');
  if (toggleKey) {
    toggleKey.addEventListener('click', () => {
      const input = $('apiKey');
      if (!input) return;
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      toggleKey.textContent = showing ? 'Show' : 'Hide';
    });
  }

  const model = $('model');
  if (model) {
    model.addEventListener('change', () => {
      if ($('customModel')) {
        $('customModel').style.display =
          model.value === '__custom__' ? 'block' : 'none';
      }
    });
  }

  const tempSlider = $('temperature');
  if (tempSlider) {
    tempSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      if ($('tempVal')) {
        $('tempVal').textContent = (Number.isFinite(val) ? val : 0.3).toFixed(2);
      }
    });
  }

  const topPSlider = $('topP');
  if (topPSlider) {
    topPSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      if ($('topPVal')) {
        $('topPVal').textContent = (Number.isFinite(val) ? val : 0.95).toFixed(2);
      }
    });
  }

  const minLenSlider = $('minTextLength');
  if (minLenSlider) {
    minLenSlider.addEventListener('input', (e) => {
      const target = e?.target || minLenSlider;
      const val = parseInt(target.value, 10);
      if ($('minTextLengthVal')) {
        $('minTextLengthVal').textContent = Number.isFinite(val) ? val : 15;
      }
    });
  }

  document.querySelectorAll('.quick-temp').forEach((btn) => {
    btn.addEventListener('click', () => {
      const val = parseFloat(btn.dataset.temp);
      if (Number.isFinite(val)) {
        if ($('temperature')) $('temperature').value = val;
        if ($('tempVal')) $('tempVal').textContent = val.toFixed(2);
      }
    });
  });

  document.querySelectorAll('.quick-len, [data-len]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const val = parseInt(btn.dataset.len, 10);
      if (Number.isFinite(val)) {
        if ($('minTextLength')) $('minTextLength').value = val;
        if ($('minTextLengthVal')) $('minTextLengthVal').textContent = val;
      }
    });
  });

  const resetSys = $('resetSystemInstruction');
  if (resetSys) {
    resetSys.addEventListener('click', () => {
      if ($('systemInstruction')) {
        $('systemInstruction').value = GTStorage.DEFAULT_SYSTEM_INSTRUCTION;
      }
    });
  }

  const resetPresets = $('resetPresets');
  if (resetPresets) {
    resetPresets.addEventListener('click', () => {
      currentPresets = JSON.parse(JSON.stringify(GTStorage.DEFAULT_PRESETS));
      editingPresetId = null;
      renderPresets();
      setStatus('Presets reset to defaults', true);
    });
  }

  const addPresetBtn = $('addPresetBtn');
  if (addPresetBtn) {
    addPresetBtn.addEventListener('click', () => {
      const labelInput = $('newPresetLabel');
      const promptInput = $('newPresetPrompt');
      const label = labelInput ? labelInput.value.trim() : '';
      const prompt = promptInput ? promptInput.value.trim() : '';

      if (!label || !prompt) {
        setStatus('Please enter both label and prompt instruction', false);
        return;
      }

      const id =
        'preset_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      currentPresets.push({ id, label, prompt });
      if (labelInput) labelInput.value = '';
      if (promptInput) promptInput.value = '';
      renderPresets();
      setStatus('Preset added', true);
    });
  }

  const saveBtn = $('save');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      try {
        await save();
        setStatus('Saved ✓', true);
        setTimeout(() => setStatus('', true), 2500);
      } catch (err) {
        setStatus(`Failed to save: ${err.message || err}`, false);
      }
    });
  }

  const testBtn = $('test');
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      try {
        const settings = await save();
        if (!settings.apiKey) {
          setStatus('Enter an API key first', false);
          return;
        }
        setStatus('Testing…', true);
        const res = await chrome.runtime.sendMessage({
          type: 'CHECK_TEXT',
          text: 'She dont like going their on the weekends because it are far.',
        });
        if (res?.ok) {
          const count = res.result?.corrections?.length ?? 0;
          setStatus(
            `Key works ✓ (${count} test correction${count === 1 ? '' : 's'} returned)`,
            true
          );
        } else {
          setStatus(`Failed: ${res?.error || 'no response'}`, false);
        }
      } catch (err) {
        setStatus(`Error: ${err.message || err}`, false);
      }
    });
  }

  try {
    const v = chrome.runtime.getManifest().version;
    if ($('ver')) $('ver').textContent = 'v' + v;
  } catch (_) {}

  load();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDOMEvents);
  } else {
    initDOMEvents();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    KNOWN_MODELS,
    collect,
    save,
    load,
    renderPresets,
    getPresets: () => currentPresets,
    setPresets: (p) => {
      currentPresets = p;
    },
    setEditingPresetId: (id) => {
      editingPresetId = id;
    },
    initDOMEvents,
  };
}
