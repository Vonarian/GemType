const test = require('node:test');
const assert = require('node:assert');

// Helper to match selectors: classes (.gt-preview-card), tags (button), ids (#id)
function matchesSelector(node, sel) {
  if (!node || !node.tagName) return false;
  const parts = sel.split(/(?=[.#])/);
  for (const part of parts) {
    if (part.startsWith('.')) {
      const cls = part.slice(1);
      const classes = (node.className || '').split(/\s+/);
      if (!classes.includes(cls)) return false;
    } else if (part.startsWith('#')) {
      if (node.id !== part.slice(1)) return false;
    } else if (part.length > 0) {
      if (node.tagName.toLowerCase() !== part.toLowerCase()) return false;
    }
  }
  return true;
}

function findNode(root, sel) {
  for (const child of root.children || []) {
    if (matchesSelector(child, sel)) return child;
    const found = findNode(child, sel);
    if (found) return found;
  }
  return null;
}

function findAllNodes(root, sel, acc = []) {
  for (const child of root.children || []) {
    if (matchesSelector(child, sel)) acc.push(child);
    findAllNodes(child, sel, acc);
  }
  return acc;
}

function createMockElement(tag = 'div', className = '') {
  let innerText = '';
  const listeners = {};
  const children = [];

  const el = {
    tagName: tag.toUpperCase(),
    className,
    style: {
      setProperty: (k, v) => { el.style[k] = v; },
    },
    dataset: {},
    children,
    value: '',
    selectionStart: 0,
    selectionEnd: 0,
    isConnected: true,
    get textContent() {
      return innerText;
    },
    set textContent(val) {
      innerText = String(val);
      if (val === '') {
        children.length = 0;
      }
    },
    appendChild(child) {
      child.parentElement = el;
      child.isConnected = true;
      children.push(child);
      return child;
    },
    remove() {
      el.isConnected = false;
      if (el.parentElement) {
        const idx = el.parentElement.children.indexOf(el);
        if (idx !== -1) el.parentElement.children.splice(idx, 1);
      }
    },
    querySelector(selector) {
      return findNode(el, selector);
    },
    querySelectorAll(selector) {
      return findAllNodes(el, selector);
    },
    addEventListener(event, fn) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    },
    removeEventListener(event, fn) {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter((f) => f !== fn);
    },
    dispatchEvent(event) {
      event.target = event.target || el;
      const fns = (listeners[event.type || event] || []).slice();
      for (const fn of fns) fn(event);
      if (event.bubbles && el.parentElement && !event._stopped) {
        el.parentElement.dispatchEvent(event);
      }
    },
    focus() {
      if (globalThis.document) {
        globalThis.document.activeElement = el;
      }
    },
    attachShadow(opts) {
      const shadowRoot = createMockElement('div', 'shadow-root');
      el.shadowRoot = shadowRoot;
      return shadowRoot;
    },
    click() {
      el.dispatchEvent({
        type: 'click',
        target: el,
        bubbles: true,
        preventDefault: () => {},
        stopPropagation: () => {},
      });
    },
    setSelectionRange(start, end) {
      el.selectionStart = start;
      el.selectionEnd = end;
    },
    getBoundingClientRect() {
      return {
        left: 20,
        top: 40,
        right: 120,
        bottom: 70,
        width: 100,
        height: 180,
      };
    },
    contains(other) {
      return other === el || children.some((c) => c.contains?.(other));
    },
  };

  return el;
}

function setupPreviewTestEnv() {
  const rootEl = createMockElement('div', 'shadow-root');
  const docListeners = {};
  const toasts = [];

  const mockDoc = {
    activeElement: null,
    body: createMockElement('body'),
    createElement: (tag) => createMockElement(tag),
    createTextNode: (txt) => ({ nodeType: 3, data: txt, textContent: txt }),
    addEventListener: (event, fn, useCapture) => {
      if (!docListeners[event]) docListeners[event] = [];
      docListeners[event].push({ fn, useCapture });
    },
    removeEventListener: (event, fn, useCapture) => {
      if (!docListeners[event]) return;
      docListeners[event] = docListeners[event].filter((item) => item.fn !== fn);
    },
    dispatchEvent: (event) => {
      const items = (docListeners[event.type || event] || []).slice();
      for (const item of items) {
        item.fn(event);
      }
    },
  };

  globalThis.document = mockDoc;
  globalThis.window = {
    innerWidth: 1024,
    innerHeight: 768,
    getSelection: () => ({ rangeCount: 0, isCollapsed: true }),
  };

  globalThis.chrome = {
    runtime: {
      onMessage: { addListener: () => {} },
      sendMessage: async (msg) => ({ ok: true, result: { rewritten: 'Rewritten mock text.' } }),
    },
  };

  const GT = {
    isNativeField: (el) => el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT'),
    findEditable: (el) => (GT.isNativeField(el) ? el : null),
    extract: (field) => ({ text: field.value || '', map: null }),
    replaceRange: (field, start, end, rep) => {
      const v = field.value;
      field.value = v.slice(0, start) + rep + v.slice(end);
      field.setSelectionRange(start + rep.length, start + rep.length);
      return true;
    },
    sendMessage: async (msg) => globalThis.chrome.runtime.sendMessage(msg),
    debounce: (fn) => {
      const wrapped = (...args) => fn(...args);
      wrapped.cancel = () => {};
      return wrapped;
    },
    state: {
      settings: { previewBeforeReplace: true },
      enabledHere: () => true,
    },
    ui: {
      ensureRoot: () => rootEl,
      el: (tag, className, parent) => {
        const node = createMockElement(tag, className);
        if (parent) parent.appendChild(node);
        return node;
      },
      toast: (msg) => toasts.push(msg),
    },
  };

  globalThis.GT = GT;

  // Load overlay.js and refine.js
  delete require.cache[require.resolve('../extension/src/content/overlay.js')];
  require('../extension/src/content/overlay.js');

  const origToast = GT.ui.toast;
  GT.ui.toast = (msg) => {
    toasts.push(msg);
    origToast(msg);
  };

  delete require.cache[require.resolve('../extension/src/content/refine.js')];
  require('../extension/src/content/refine.js');

  return { rootEl, mockDoc, toasts, GT };
}

test('GT.preview: renders .gt-preview-card with title, body, and action buttons', () => {
  const { rootEl, GT } = setupPreviewTestEnv();

  let accepted = false;
  let discarded = false;

  GT.preview.open({
    title: 'Preview: Formal',
    text: 'Polished replacement sentence.',
    anchor: { left: 40, top: 60, right: 140, bottom: 90 },
    onAccept: () => { accepted = true; },
    onDiscard: () => { discarded = true; },
  });

  const card = GT.preview.getCard();
  assert.ok(card, 'Preview card element should be open');
  assert.strictEqual(card.className, 'gt-preview-card');
  assert.ok(card.isConnected, 'Card must be attached to the DOM');

  const titleEl = card.querySelector('.gt-preview-title');
  assert.ok(titleEl, 'Title element should be present');
  assert.strictEqual(titleEl.textContent, 'Preview: Formal');

  const closeBtn = card.querySelector('.gt-close');
  assert.ok(closeBtn, 'Close button should be present in header');
  assert.strictEqual(closeBtn.textContent, '✕');

  const bodyEl = card.querySelector('.gt-preview-body');
  assert.ok(bodyEl, 'Body element should be present');
  assert.strictEqual(bodyEl.textContent, 'Polished replacement sentence.');

  const acceptBtn = card.querySelector('.gt-preview-accept');
  assert.ok(acceptBtn, 'Accept button should be present');
  assert.strictEqual(acceptBtn.textContent, 'Accept ↵');

  const discardBtn = card.querySelector('.gt-preview-discard');
  assert.ok(discardBtn, 'Discard button should be present');
  assert.strictEqual(discardBtn.textContent, 'Discard Esc');

  GT.preview.close();
  assert.strictEqual(GT.preview.getCard(), null, 'Card should be null after close');
  assert.strictEqual(card.isConnected, false, 'Card should be removed from DOM after close');
});

test('GT.preview: Accept button click triggers onAccept and closes card', () => {
  const { GT } = setupPreviewTestEnv();

  let accepted = false;
  let discarded = false;

  GT.preview.open({
    title: 'Preview: Concise',
    text: 'Concise replacement.',
    onAccept: () => { accepted = true; },
    onDiscard: () => { discarded = true; },
  });

  const card = GT.preview.getCard();
  const acceptBtn = card.querySelector('.gt-preview-accept');
  acceptBtn.click();

  assert.strictEqual(accepted, true, 'onAccept callback must be called on Accept click');
  assert.strictEqual(discarded, false, 'onDiscard callback must NOT be called on Accept click');
  assert.strictEqual(GT.preview.getCard(), null, 'Preview card should be closed after accept');
});

test('GT.preview: Discard button click triggers onDiscard and closes card', () => {
  const { GT } = setupPreviewTestEnv();

  let accepted = false;
  let discarded = false;

  GT.preview.open({
    title: 'Preview: Casual',
    text: 'Casual rewrite.',
    onAccept: () => { accepted = true; },
    onDiscard: () => { discarded = true; },
  });

  const card = GT.preview.getCard();
  const discardBtn = card.querySelector('.gt-preview-discard');
  discardBtn.click();

  assert.strictEqual(discarded, true, 'onDiscard callback must be called on Discard click');
  assert.strictEqual(accepted, false, 'onAccept callback must NOT be called on Discard click');
  assert.strictEqual(GT.preview.getCard(), null, 'Preview card should be closed after discard');
});

test('GT.preview: Close (✕) button click triggers onDiscard and closes card', () => {
  const { GT } = setupPreviewTestEnv();

  let accepted = false;
  let discarded = false;

  GT.preview.open({
    title: 'Preview: Fix',
    text: 'Fixed spelling.',
    onAccept: () => { accepted = true; },
    onDiscard: () => { discarded = true; },
  });

  const card = GT.preview.getCard();
  const closeBtn = card.querySelector('.gt-close');
  closeBtn.click();

  assert.strictEqual(discarded, true, 'onDiscard callback must be called on Close (✕) click');
  assert.strictEqual(accepted, false, 'onAccept callback must NOT be called on Close click');
  assert.strictEqual(GT.preview.getCard(), null, 'Preview card should be closed after close click');
});

test('GT.preview: Enter key triggers onAccept, Escape key triggers onDiscard', () => {
  const { mockDoc, GT } = setupPreviewTestEnv();

  // 1. Enter key -> Accept
  let accepted = false;
  let discarded = false;

  GT.preview.open({
    title: 'Preview: Formal',
    text: 'Formal text.',
    onAccept: () => { accepted = true; },
    onDiscard: () => { discarded = true; },
  });

  mockDoc.dispatchEvent({
    type: 'keydown',
    key: 'Enter',
    preventDefault: () => {},
    stopPropagation: () => {},
  });

  assert.strictEqual(accepted, true, 'Enter key must trigger onAccept');
  assert.strictEqual(discarded, false, 'Enter key must NOT trigger onDiscard');
  assert.strictEqual(GT.preview.getCard(), null, 'Card must be closed after Enter');

  // 2. Escape key -> Discard
  accepted = false;
  discarded = false;

  GT.preview.open({
    title: 'Preview: Formal',
    text: 'Formal text.',
    onAccept: () => { accepted = true; },
    onDiscard: () => { discarded = true; },
  });

  mockDoc.dispatchEvent({
    type: 'keydown',
    key: 'Escape',
    preventDefault: () => {},
    stopPropagation: () => {},
  });

  assert.strictEqual(discarded, true, 'Escape key must trigger onDiscard');
  assert.strictEqual(accepted, false, 'Escape key must NOT trigger onAccept');
  assert.strictEqual(GT.preview.getCard(), null, 'Card must be closed after Escape');
});

test('GT.preview: outside click triggers onDiscard, inside click does not', () => {
  const { mockDoc, GT } = setupPreviewTestEnv();

  let discarded = false;

  GT.preview.open({
    title: 'Preview: Formal',
    text: 'Formal text.',
    onAccept: () => {},
    onDiscard: () => { discarded = true; },
  });

  const card = GT.preview.getCard();

  // Click INSIDE preview card
  mockDoc.dispatchEvent({
    type: 'mousedown',
    target: card,
    composedPath: () => [card, { tagName: 'GEMTYPE-EXT' }],
  });
  assert.strictEqual(discarded, false, 'Inside click must not discard preview');
  assert.ok(GT.preview.getCard(), 'Card should remain open after inside click');

  // Click OUTSIDE card but on another shadow element (e.g. badge or host)
  const otherShadowEl = createMockElement('div', 'gt-badge');
  mockDoc.dispatchEvent({
    type: 'mousedown',
    target: otherShadowEl,
    composedPath: () => [otherShadowEl, { tagName: 'GEMTYPE-EXT' }],
  });
  assert.strictEqual(discarded, true, 'Click outside card on other element must discard preview');
  assert.strictEqual(GT.preview.getCard(), null, 'Card must be closed after outside click');

  // Re-open and click OUTSIDE <gemtype-ext> on page content
  discarded = false;
  GT.preview.open({
    title: 'Preview: Formal',
    text: 'Formal text.',
    onAccept: () => {},
    onDiscard: () => { discarded = true; },
  });
  const outsideDiv = createMockElement('div', 'page-content');
  mockDoc.dispatchEvent({
    type: 'mousedown',
    target: outsideDiv,
    composedPath: () => [outsideDiv, mockDoc.body],
  });
  assert.strictEqual(discarded, true, 'Outside click must discard preview');
  assert.strictEqual(GT.preview.getCard(), null, 'Card must be closed after outside click');
});

test('GT.preview: positioning handles viewport bounds and clamping', () => {
  const { GT } = setupPreviewTestEnv();

  // A. Normal positioning
  GT.preview.open({
    title: 'Test Position',
    text: 'Sample',
    anchor: { left: 100, top: 50, right: 200, bottom: 80 },
  });
  let card = GT.preview.getCard();
  assert.strictEqual(card.style.left, '100px');
  assert.strictEqual(card.style.top, '86px'); // bottom (80) + 6

  // B. Right viewport edge clamping: innerWidth is 1024, W is 320, margin is 8 -> max left 696
  GT.preview.open({
    title: 'Test Clamped Right',
    text: 'Sample',
    anchor: { left: 950, top: 50, right: 1010, bottom: 80 },
  });
  card = GT.preview.getCard();
  assert.strictEqual(card.style.left, '696px');

  // C. Bottom viewport flip: innerHeight is 768, anchor bottom 700, card height 180 -> flips above
  GT.preview.open({
    title: 'Test Flip Up',
    text: 'Sample',
    anchor: { left: 100, top: 680, right: 200, bottom: 710 },
  });
  card = GT.preview.getCard();
  // topAnchor (680) - h (180) - 6 = 494
  assert.strictEqual(card.style.top, '494px');

  GT.preview.close();
});

test('refine run: previewBeforeReplace === true opens preview and replaces on Accept', async () => {
  const { toasts, GT } = setupPreviewTestEnv();

  GT.state.settings = {
    previewBeforeReplace: true,
    customPresets: [{ id: 'formal', label: 'Formal', prompt: 'Make formal' }],
  };

  const textarea = createMockElement('textarea');
  textarea.value = 'She dont like going their.';
  textarea.setSelectionRange(0, 26);
  textarea.focus();

  // Mock Gemini rewrite
  globalThis.chrome.runtime.sendMessage = async () => ({
    ok: true,
    result: { rewritten: 'She does not like going there.' },
  });

  const job = { field: textarea, start: 0, end: 26, text: 'She dont like going their.' };
  await GT.refine.run('formal', job);

  // 1. Preview card must be opened
  const card = GT.preview.getCard();
  assert.ok(card, 'Preview card should be open when previewBeforeReplace is true');
  const title = card.querySelector('.gt-preview-title');
  assert.strictEqual(title.textContent, 'Preview: Formal');
  const body = card.querySelector('.gt-preview-body');
  assert.strictEqual(body.textContent, 'She does not like going there.');

  // Text in textarea should NOT be modified yet!
  assert.strictEqual(textarea.value, 'She dont like going their.');

  // 2. Click Accept
  const acceptBtn = card.querySelector('.gt-preview-accept');
  acceptBtn.click();

  // Now textarea must be updated
  assert.strictEqual(textarea.value, 'She does not like going there.');
  assert.ok(
    toasts.includes('Rewritten — press Ctrl/Cmd+Z to undo'),
    'Undo toast must be displayed after accept'
  );
  assert.strictEqual(GT.preview.getCard(), null, 'Preview card should be closed');
});

test('refine run: previewBeforeReplace === true leaves text untouched on Discard', async () => {
  const { toasts, GT } = setupPreviewTestEnv();

  GT.state.settings = {
    previewBeforeReplace: true,
    customPresets: [{ id: 'concise', label: 'Concise', prompt: 'Make concise' }],
  };

  const textarea = createMockElement('textarea');
  textarea.value = 'This is a rather long and verbose sentence.';
  textarea.setSelectionRange(0, textarea.value.length);
  textarea.focus();

  globalThis.chrome.runtime.sendMessage = async () => ({
    ok: true,
    result: { rewritten: 'This is concise.' },
  });

  const job = { field: textarea, start: 0, end: textarea.value.length, text: textarea.value };
  await GT.refine.run('concise', job);

  const card = GT.preview.getCard();
  assert.ok(card, 'Preview card should be open');

  // Click Discard
  const discardBtn = card.querySelector('.gt-preview-discard');
  discardBtn.click();

  // Textarea should be completely unchanged
  assert.strictEqual(textarea.value, 'This is a rather long and verbose sentence.');
  assert.strictEqual(GT.preview.getCard(), null, 'Preview card should be closed');
  assert.strictEqual(
    toasts.includes('Rewritten — press Ctrl/Cmd+Z to undo'),
    false,
    'No replacement undo toast should be shown on discard'
  );
});

test('refine run: previewBeforeReplace === false directly replaces without preview', async () => {
  const { toasts, GT } = setupPreviewTestEnv();

  GT.state.settings = {
    previewBeforeReplace: false,
    customPresets: [{ id: 'fix', label: 'Fix & Polish', prompt: 'Fix errors' }],
  };

  const textarea = createMockElement('textarea');
  textarea.value = 'Their are problems here.';
  textarea.setSelectionRange(0, textarea.value.length);
  textarea.focus();

  globalThis.chrome.runtime.sendMessage = async () => ({
    ok: true,
    result: { rewritten: 'There are problems here.' },
  });

  const job = { field: textarea, start: 0, end: textarea.value.length, text: textarea.value };
  await GT.refine.run('fix', job);

  // Preview card must NOT open
  assert.strictEqual(GT.preview.getCard(), null, 'Preview card should not open when previewBeforeReplace is false');

  // Replacement must be applied immediately
  assert.strictEqual(textarea.value, 'There are problems here.');
  assert.ok(
    toasts.includes('Rewritten — press Ctrl/Cmd+Z to undo'),
    'Undo toast must be displayed after direct replace'
  );
});

test('refine run: preview onAccept guards against text changed while preview is open (idx === -1)', async () => {
  const { toasts, GT } = setupPreviewTestEnv();

  GT.state.settings = {
    previewBeforeReplace: true,
    customPresets: [{ id: 'formal', label: 'Formal', prompt: 'Make formal' }],
  };

  const textarea = createMockElement('textarea');
  textarea.value = 'Initial text to rewrite.';
  textarea.setSelectionRange(0, 24);
  textarea.focus();

  globalThis.chrome.runtime.sendMessage = async () => ({
    ok: true,
    result: { rewritten: 'Initial text to rewrite, formally.' },
  });

  const job = { field: textarea, start: 0, end: 24, text: 'Initial text to rewrite.' };
  await GT.refine.run('formal', job);

  const card = GT.preview.getCard();
  assert.ok(card, 'Preview card should be open');

  // While preview is open, field content is modified completely so original text is no longer found
  textarea.value = 'Completely different content typed by user.';

  // Click Accept
  const acceptBtn = card.querySelector('.gt-preview-accept');
  acceptBtn.click();

  // Preview must close, toast shown, and textarea untouched
  assert.strictEqual(GT.preview.getCard(), null, 'Preview card must be closed');
  assert.strictEqual(textarea.value, 'Completely different content typed by user.');
  assert.ok(
    toasts.includes('GemType: text changed — rewrite not applied'),
    'Toast "GemType: text changed — rewrite not applied" must be shown'
  );
  assert.strictEqual(
    toasts.includes('Rewritten — press Ctrl/Cmd+Z to undo'),
    false,
    'Undo toast must NOT be shown when text changed prevented rewrite'
  );
});

