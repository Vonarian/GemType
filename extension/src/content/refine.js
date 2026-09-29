// GemType refine toolbar: select text inside an editable field and a small
// dark toolbar appears with rewrite actions (Improve / Fix / Shorten / tone).
// The rewritten text replaces the selection via execCommand, so Ctrl+Z undoes.

'use strict';

if (typeof GT === 'undefined') {
  globalThis.GT = typeof globalThis.GT !== 'undefined' ? globalThis.GT : {};
}

GT.refine = (() => {
  const BUILTIN_PRESETS = [
    { id: 'improve', label: '✨ Improve' },
    { id: 'fix', label: 'Fix' },
    { id: 'shorten', label: 'Shorten' },
    { id: 'formal', label: 'Formal' },
    { id: 'casual', label: 'Casual' },
  ];

  let bar = null;
  let pending = null; // { field, start, end, text }
  let busy = false;

  function getPresets() {
    const custom = GT.state?.settings?.customPresets;
    if (Array.isArray(custom) && custom.length > 0) {
      return custom;
    }
    if (
      typeof GTStorage !== 'undefined' &&
      Array.isArray(GTStorage.DEFAULT_PRESETS) &&
      GTStorage.DEFAULT_PRESETS.length > 0
    ) {
      return GTStorage.DEFAULT_PRESETS;
    }
    return BUILTIN_PRESETS;
  }

  // Editors like LinkedIn's post composer live inside a shadow root. Two helpers
  // pierce it: document.activeElement returns the shadow host, and
  // document.getSelection() cannot see inside shadow DOM at all — so we walk to
  // the real focused element and read the selection from its own root.
  function deepActiveElement() {
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return a;
  }

  function activeSelection() {
    const a = deepActiveElement();
    const root = a && a.getRootNode ? a.getRootNode() : null;
    if (
      typeof ShadowRoot !== 'undefined' &&
      root instanceof ShadowRoot &&
      typeof root.getSelection === 'function'
    ) {
      const s = root.getSelection();
      if (s && s.rangeCount) return s;
    }
    return window.getSelection();
  }

  function hide() {
    if (bar) bar.remove();
    bar = null;
    pending = null;
    busy = false;
  }

  function restoreFocusToField() {
    const job = pending;
    hide();
    if (job?.field) {
      if (typeof job.field.focus === 'function') {
        job.field.focus();
      }
      if (
        GT.isNativeField(job.field) &&
        job.start != null &&
        job.end != null &&
        typeof job.field.setSelectionRange === 'function'
      ) {
        try {
          job.field.setSelectionRange(job.start, job.end);
        } catch (_) {}
      } else if (!GT.isNativeField(job.field) && job.start != null && job.end != null) {
        try {
          const sel =
            activeSelection() ||
            (typeof window !== 'undefined' && window.getSelection
              ? window.getSelection()
              : null);
          if (sel && typeof GT.extract === 'function' && typeof GT.textRangeToDomRange === 'function') {
            const { map } = GT.extract(job.field);
            const range = GT.textRangeToDomRange(map, job.start, job.end);
            if (range) {
              sel.removeAllRanges();
              sel.addRange(range);
            }
          }
        } catch (_) {}
      }
    }
  }

  // Capture the current selection if it is inside a managed editable field.
  function captureSelection() {
    const active = deepActiveElement();
    if (GT.isNativeField(active)) {
      const start = active.selectionStart;
      const end = active.selectionEnd;
      if (start == null || end == null || start === end) return null;
      return {
        field: active,
        start,
        end,
        text: active.value.slice(start, end),
      };
    }
    const sel = activeSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const field = GT.findEditable(sel.anchorNode);
    if (!field || GT.isNativeField(field)) return null;
    if (!field.contains(sel.anchorNode) || !field.contains(sel.focusNode)) return null;
    const { map } = GT.extract(field);
    const range = sel.getRangeAt(0);
    const start = GT.domPosToTextOffset(map, range.startContainer, range.startOffset);
    const end = GT.domPosToTextOffset(map, range.endContainer, range.endOffset);
    if (end <= start) return null;
    const { text } = GT.extract(field);
    return { field, start, end, text: text.slice(start, end) };
  }

  function makeRect(left, top, width, height) {
    if (typeof DOMRect !== 'undefined') {
      try {
        return new DOMRect(left, top, width, height);
      } catch (_) {}
    }
    return {
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
    };
  }

  function selectionAnchorRect() {
    const active = deepActiveElement() || pending?.field;
    if (active && GT.isNativeField(active)) {
      // Approximate: bottom of the field near its horizontal center is fine
      // for native fields; precise caret rects need the mirror (overkill here).
      const r = active.getBoundingClientRect ? active.getBoundingClientRect() : { left: 0, top: 0, width: 100, height: 24 };
      const left = r.left || 0;
      const top = r.top || 0;
      const width = r.width || 0;
      const height = r.height || 24;
      return makeRect(left + width / 4, top, 0, Math.min(height, 24));
    }
    const sel = activeSelection();
    if (sel && sel.rangeCount) {
      const rects = sel.getRangeAt(0).getClientRects ? sel.getRangeAt(0).getClientRects() : [];
      if (rects.length) return rects[rects.length - 1];
    }
    if (active && active.getBoundingClientRect) {
      const r = active.getBoundingClientRect();
      return makeRect(r.left || 0, r.top || 0, r.width || 0, Math.min(r.height || 24, 24));
    }
    return makeRect(0, 0, 0, 24);
  }

  function renderButtons() {
    if (!bar) return;
    bar.textContent = '';
    const presets = getPresets();
    for (const preset of presets) {
      let action, label;
      if (Array.isArray(preset)) {
        action = preset[0];
        label = preset[1] || preset[0];
      } else if (preset && typeof preset === 'object') {
        action = preset.id || preset.action;
        label = preset.label || preset.name || action;
      } else if (typeof preset === 'string') {
        action = preset;
        label = preset;
      }
      if (!action) continue;

      const btn = GT.ui.el('button', '', bar);
      btn.textContent = label;
      btn.dataset.action = action;
      btn.dataset.presetId = action;
      btn.action = action;
      btn.presetId = action;
      btn.addEventListener('click', () => run(action));
    }
  }

  function onToolbarKeyDown(e) {
    if (busy) return;
    const buttons = Array.from(bar.querySelectorAll('button:not([disabled])'));
    if (!buttons.length) return;

    let currentIdx = buttons.indexOf(e.target);
    if (currentIdx === -1) {
      const root = GT.ui.ensureRoot();
      const active = root?.activeElement || document.activeElement;
      currentIdx = buttons.indexOf(active);
    }

    if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      e.stopPropagation();
      const nextIdx = currentIdx >= 0 ? (currentIdx + 1) % buttons.length : 0;
      buttons[nextIdx].focus();
    } else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      e.stopPropagation();
      const prevIdx =
        currentIdx >= 0
          ? (currentIdx - 1 + buttons.length) % buttons.length
          : buttons.length - 1;
      buttons[prevIdx].focus();
    } else if (e.key === 'Enter' || e.key === ' ' || e.key === 'Space' || e.key === 'Spacebar') {
      e.preventDefault();
      e.stopPropagation();
      const targetBtn = currentIdx >= 0 ? buttons[currentIdx] : buttons[0];
      if (targetBtn) targetBtn.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      restoreFocusToField();
    }
  }

  function show(preCaptured = null) {
    const captured = preCaptured || captureSelection();
    if (!captured || captured.text.trim().length < (preCaptured ? 1 : 3)) {
      if (!busy) hide();
      return;
    }
    if (captured.text.length > 6000) return;
    pending = captured;

    const anchor = selectionAnchorRect();
    if (!anchor) return;

    const root = GT.ui.ensureRoot();
    if (!bar) {
      bar = GT.ui.el('div', 'gt-toolbar', root);
      // preventDefault on mousedown keeps the page selection alive.
      bar.addEventListener('mousedown', (e) => e.preventDefault());
      bar.addEventListener('keydown', onToolbarKeyDown);
    }
    renderButtons();

    const w = bar.getBoundingClientRect ? (bar.getBoundingClientRect().width || 320) : 320;
    const innerW = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1024;
    const innerH = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 768;
    bar.style.left = `${Math.min(Math.max(anchor.left, 8), innerW - w - 8)}px`;
    const top = anchor.bottom + 8;
    bar.style.top =
      top > innerH - 50 ? `${anchor.top - 44}px` : `${top}px`;
  }

  function triggerFromShortcut() {
    if (busy) return;
    const captured = captureSelection();
    if (!captured || !captured.text || captured.text.trim().length === 0) {
      GT.ui.toast('GemType: select text first to rewrite');
      return;
    }
    show(captured);
    if (bar) {
      const firstBtn = bar.querySelector('button');
      if (firstBtn && typeof firstBtn.focus === 'function') {
        firstBtn.focus();
      }
    }
  }

  async function run(action, captured = null) {
    const job = captured || pending;
    if (!job || busy) return;
    busy = true;
    if (bar) {
      bar.textContent = '';
      GT.ui.el('div', 'gt-tb-spin', bar);
      const label = GT.ui.el('button', '', bar);
      label.textContent = 'Rewriting…';
    } else {
      GT.ui.toast('GemType: rewriting…');
    }

    const res = await GT.sendMessage({
      type: 'REFINE_TEXT',
      text: job.text,
      action,
      presetId: action,
    });
    busy = false;

    if (!res.ok) {
      hide();
      if (res.error === 'NO_API_KEY') {
        GT.ui.toast('GemType: add your Gemini API key in the extension settings');
      } else if (res.error === 'RATE_LIMITED') {
        GT.ui.toast('GemType: rate limited — try again in a moment');
      } else if (/context invalidated|receiving end does not exist/i.test(res.error)) {
        GT.ui.toast('GemType was updated — refresh this page to reconnect');
      } else {
        GT.ui.toast('GemType: rewrite failed');
      }
      return;
    }

    // Verify the selected text is still where it was before replacing.
    const { text: nowText } = GT.extract(job.field);
    let { start, end } = job;
    if (nowText.slice(start, end) !== job.text) {
      const idx = nowText.indexOf(job.text);
      if (idx === -1) {
        hide();
        GT.ui.toast('GemType: text changed — rewrite not applied');
        return;
      }
      start = idx;
      end = idx + job.text.length;
    }

    const anchor = selectionAnchorRect();
    hide();

    const rewritten = res.result?.rewritten;
    if (rewritten == null) {
      GT.ui.toast('GemType: rewrite failed');
      return;
    }

    const usePreview =
      GT.state?.settings?.previewBeforeReplace !== false &&
      typeof GT.preview?.open === 'function';

    if (usePreview) {
      const presets = getPresets();
      const matched = presets.find((p) => {
        if (typeof p === 'string') return p === action;
        if (p && typeof p === 'object') return (p.id || p.action) === action;
        return false;
      });
      let label = action;
      if (matched) {
        if (typeof matched === 'string') label = matched;
        else if (matched.label) label = matched.label;
        else if (matched.name) label = matched.name;
      } else if (typeof action === 'string' && action.length > 0) {
        label = action.charAt(0).toUpperCase() + action.slice(1);
      }

      GT.preview.open({
        title: `Preview: ${label}`,
        text: rewritten,
        anchor,
        onAccept: () => {
          const { text: currentText } = GT.extract(job.field);
          let curStart = start;
          let curEnd = end;
          if (currentText.slice(curStart, curEnd) !== job.text) {
            const idx = currentText.indexOf(job.text);
            if (idx !== -1) {
              curStart = idx;
              curEnd = idx + job.text.length;
            }
          }
          if (GT.replaceRange(job.field, curStart, curEnd, rewritten)) {
            GT.ui.toast('Rewritten — press Ctrl/Cmd+Z to undo');
          } else {
            GT.ui.toast('GemType: could not apply the rewrite here');
          }
          if (GT.preview && typeof GT.preview.close === 'function') {
            GT.preview.close();
          }
        },
        onDiscard: () => {
          if (GT.preview && typeof GT.preview.close === 'function') {
            GT.preview.close();
          }
        },
      });
    } else {
      if (GT.replaceRange(job.field, start, end, rewritten)) {
        GT.ui.toast('Rewritten — press Ctrl/Cmd+Z to undo');
      } else {
        GT.ui.toast('GemType: could not apply the rewrite here');
      }
    }
  }

  function init() {
    const maybeShow = GT.debounce(() => {
      if (busy) return;
      if (!GT.state.enabledHere()) return hide();
      show();
    }, 250);
    document.addEventListener('selectionchange', maybeShow);
    // selectionchange is unreliable for selections inside shadow DOM across
    // Chromium versions; mouseup is a reliable backup after a drag-select.
    document.addEventListener('mouseup', maybeShow, true);
    document.addEventListener(
      'mousedown',
      (e) => {
        // Any click on the page (not our shadow UI) dismisses an idle toolbar.
        if (!busy && bar && e.target.tagName !== 'GEMTYPE-EXT') hide();
      },
      true
    );
    document.addEventListener('keydown', (e) => {
      if (!busy && bar && e.key === 'Escape') {
        restoreFocusToField();
      }
    });
  }

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'COMMAND_TRIGGER_REWRITE') {
        triggerFromShortcut();
      }
    });
  }

  // For the right-click context menu path from the background worker.
  function runOnCurrentSelection(action) {
    const captured = captureSelection();
    if (!captured) {
      GT.ui.toast('GemType: select text inside an editable field first');
      return;
    }
    run(action, captured);
  }

  // Rewrite the ENTIRE field content (badge-card refine chips).
  function runOnField(field, action) {
    const { text } = GT.extract(field);
    if (text.trim().length < 3) {
      GT.ui.toast('GemType: nothing to refine yet');
      return;
    }
    if (text.length > 6000) {
      GT.ui.toast('GemType: text too long to refine in one go — select a part instead');
      return;
    }
    run(action, { field, start: 0, end: text.length, text });
  }

  return {
    init,
    runOnCurrentSelection,
    runOnField,
    hide,
    show,
    triggerFromShortcut,
    captureSelection,
    getPresets,
    getBar: () => bar,
    getPending: () => pending,
    run,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GT };
}
