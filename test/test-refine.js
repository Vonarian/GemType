const test = require('node:test');
const assert = require('node:assert');

// Mock DOM elements
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
      if (selector === 'button') {
        return children.find((c) => c.tagName === 'BUTTON') || null;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector.startsWith('button')) {
        return children.filter((c) => c.tagName === 'BUTTON');
      }
      return [];
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
      const fns = listeners[event.type || event] || [];
      for (const fn of fns) fn(event);
      // Event bubbling
      if (event.bubbles && el.parentElement && !event._stopped) {
        el.parentElement.dispatchEvent(event);
      }
    },
    focus() {
      if (globalThis.document) {
        globalThis.document.activeElement = el;
      }
    },
    click() {
      el.dispatchEvent({
        type: 'click',
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
        height: 30,
      };
    },
    contains(other) {
      return other === el || children.some((c) => c.contains?.(other));
    },
  };

  return el;
}

function setupRefineTestEnv() {
  const rootEl = createMockElement('div', 'shadow-root');
  let activeEl = null;
  const messageListeners = [];

  const mockDoc = {
    activeElement: null,
    body: createMockElement('body'),
    createElement: (tag) => createMockElement(tag),
    createTextNode: (txt) => ({ nodeType: 3, data: txt, textContent: txt }),
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  globalThis.document = mockDoc;
  globalThis.window = {
    innerWidth: 1024,
    innerHeight: 768,
    getSelection: () => ({ rangeCount: 0, isCollapsed: true }),
  };

  globalThis.chrome = {
    runtime: {
      onMessage: {
        addListener: (fn) => messageListeners.push(fn),
      },
      sendMessage: async (msg) => ({ ok: true, result: { rewritten: 'Rewritten text' } }),
    },
  };

  // Base GT namespace
  const toasts = [];
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
      settings: null,
      enabledHere: () => true,
    },
    ui: {
      ensureRoot: () => rootEl,
      el: (tag, className, parent) => {
        const node = createMockElement(tag, className);
        if (parent) parent.appendChild(node);
        return node;
      },
      toast: (msg) => {
        toasts.push(msg);
      },
    },
  };

  globalThis.GT = GT;

  return { rootEl, toasts, messageListeners, GT };
}

test('refine toolbar: dynamic presets rendering from GT.state.settings.customPresets', () => {
  const { rootEl, GT } = setupRefineTestEnv();

  // Load storage defaults
  const { GTStorage } = require('../extension/src/storage.js');
  globalThis.GTStorage = GTStorage;

  delete require.cache[require.resolve('../extension/src/content/refine.js')];
  require('../extension/src/content/refine.js');

  // 1. Fallback to GTStorage.DEFAULT_PRESETS when customPresets is unset
  GT.state.settings = {};
  const defaultPresets = GT.refine.getPresets();
  assert.strictEqual(defaultPresets.length, GTStorage.DEFAULT_PRESETS.length);
  assert.strictEqual(defaultPresets[0].id, 'formal');

  // 2. Custom presets from settings
  const customList = [
    { id: 'p1', label: 'Super Formal', prompt: 'Make it super formal' },
    { id: 'p2', label: 'Punchy', prompt: 'Make it punchy' },
    { id: 'p3', label: 'Bullet Points', prompt: 'Make it bullet points' },
  ];
  GT.state.settings = { customPresets: customList };

  const activePresets = GT.refine.getPresets();
  assert.deepStrictEqual(activePresets, customList);

  // Create an editable native textarea with selection
  const textarea = createMockElement('textarea');
  textarea.value = 'Please rewrite this selected paragraph for clarity.';
  textarea.setSelectionRange(7, 39); // "rewrite this selected paragraph"
  textarea.focus();

  // Show toolbar
  GT.refine.show();

  const bar = GT.refine.getBar();
  assert.ok(bar, 'Toolbar element should be created');
  const buttons = bar.querySelectorAll('button');
  assert.strictEqual(buttons.length, 3, 'Should render exactly 3 buttons for custom presets');

  assert.strictEqual(buttons[0].textContent, 'Super Formal');
  assert.strictEqual(buttons[0].dataset.action, 'p1');
  assert.strictEqual(buttons[0].dataset.presetId, 'p1');

  assert.strictEqual(buttons[1].textContent, 'Punchy');
  assert.strictEqual(buttons[1].dataset.action, 'p2');
  assert.strictEqual(buttons[1].dataset.presetId, 'p2');

  assert.strictEqual(buttons[2].textContent, 'Bullet Points');
  assert.strictEqual(buttons[2].dataset.action, 'p3');
  assert.strictEqual(buttons[2].dataset.presetId, 'p3');

  GT.refine.hide();
  assert.strictEqual(GT.refine.getBar(), null, 'Toolbar should be destroyed after hide()');
});

test('refine toolbar: keyboard navigation (ArrowRight, ArrowLeft, Tab, Enter, Escape)', async () => {
  const { GT } = setupRefineTestEnv();

  const customList = [
    { id: 'opt1', label: 'Action 1' },
    { id: 'opt2', label: 'Action 2' },
    { id: 'opt3', label: 'Action 3' },
  ];
  GT.state.settings = { customPresets: customList };

  delete require.cache[require.resolve('../extension/src/content/refine.js')];
  require('../extension/src/content/refine.js');

  const textarea = createMockElement('textarea');
  textarea.value = 'Sample text to refine with keyboard.';
  textarea.setSelectionRange(7, 21); // "text to refine"
  textarea.focus();

  GT.refine.show();
  const bar = GT.refine.getBar();
  const buttons = bar.querySelectorAll('button');
  assert.strictEqual(buttons.length, 3);

  // Focus button 0
  buttons[0].focus();
  assert.strictEqual(globalThis.document.activeElement, buttons[0]);

  const makeKeyEvent = (key, shiftKey = false) => ({
    type: 'keydown',
    key,
    shiftKey,
    bubbles: true,
    _stopped: false,
    preventDefault() {},
    stopPropagation() {
      this._stopped = true;
    },
  });

  // 1. ArrowRight moves to button 1
  buttons[0].dispatchEvent(makeKeyEvent('ArrowRight'));
  assert.strictEqual(globalThis.document.activeElement, buttons[1], 'ArrowRight should focus button 1');

  // 2. Tab moves to button 2
  buttons[1].dispatchEvent(makeKeyEvent('Tab'));
  assert.strictEqual(globalThis.document.activeElement, buttons[2], 'Tab should focus button 2');

  // 3. ArrowRight on button 2 wraps around to button 0
  buttons[2].dispatchEvent(makeKeyEvent('ArrowRight'));
  assert.strictEqual(globalThis.document.activeElement, buttons[0], 'ArrowRight on last button should wrap to button 0');

  // 4. ArrowLeft on button 0 wraps around to button 2
  buttons[0].dispatchEvent(makeKeyEvent('ArrowLeft'));
  assert.strictEqual(globalThis.document.activeElement, buttons[2], 'ArrowLeft on first button should wrap to button 2');

  // 5. Shift+Tab moves backwards from button 2 to button 1
  buttons[2].dispatchEvent(makeKeyEvent('Tab', true));
  assert.strictEqual(globalThis.document.activeElement, buttons[1], 'Shift+Tab should focus button 1');

  // 6. Enter activates button 1
  let messageSent = null;
  globalThis.chrome.runtime.sendMessage = async (msg) => {
    messageSent = msg;
    return { ok: true, result: { rewritten: 'rewritten sample' } };
  };

  buttons[1].dispatchEvent(makeKeyEvent('Enter'));
  // Allow async run() to execute
  await new Promise((r) => setTimeout(r, 10));

  assert.ok(messageSent, 'SendMessage should be called on Enter');
  assert.strictEqual(messageSent.type, 'REFINE_TEXT');
  assert.strictEqual(messageSent.action, 'opt2');
  assert.strictEqual(GT.refine.getBar(), null, 'Toolbar should close after successful rewrite');

  // 7. Escape closes toolbar and restores field focus + selection
  textarea.value = 'Testing escape key functionality here.';
  textarea.setSelectionRange(8, 18); // "escape key"
  textarea.focus();

  GT.refine.show();
  const newBar = GT.refine.getBar();
  const newButtons = newBar.querySelectorAll('button');
  newButtons[1].focus();
  assert.strictEqual(globalThis.document.activeElement, newButtons[1]);

  newButtons[1].dispatchEvent(makeKeyEvent('Escape'));
  assert.strictEqual(GT.refine.getBar(), null, 'Toolbar should hide on Escape');
  assert.strictEqual(globalThis.document.activeElement, textarea, 'Focus should be restored to textarea');
  assert.strictEqual(textarea.selectionStart, 8, 'selectionStart preserved');
  assert.strictEqual(textarea.selectionEnd, 18, 'selectionEnd preserved');

  // 8. Space key activates focused button
  textarea.value = 'Testing space key activation.';
  textarea.setSelectionRange(8, 17); // "space key"
  textarea.focus();

  GT.refine.show();
  const spaceBar = GT.refine.getBar();
  const spaceButtons = spaceBar.querySelectorAll('button');
  spaceButtons[0].focus();

  messageSent = null;
  spaceButtons[0].dispatchEvent(makeKeyEvent(' '));
  await new Promise((r) => setTimeout(r, 10));

  assert.ok(messageSent, 'SendMessage should be called on Space');
  assert.strictEqual(messageSent.action, 'opt1');
  assert.strictEqual(GT.refine.getBar(), null, 'Toolbar should close after rewrite on Space');
});

test('refine toolbar: contenteditable field focus and selection preservation on Escape', () => {
  const { GT } = setupRefineTestEnv();

  delete require.cache[require.resolve('../extension/src/content/refine.js')];
  require('../extension/src/content/refine.js');

  const ceField = createMockElement('div');
  ceField.isContentEditable = true;
  ceField.value = 'Contenteditable text sample';

  let selectedRange = { start: 5, end: 12 };
  GT.isNativeField = (el) => false;
  GT.findEditable = () => ceField;
  GT.extract = (el) => ({ text: 'Contenteditable text sample', map: [{ start: 0, end: 27, node: {} }] });
  GT.domPosToTextOffset = (map, node, offset) => offset;
  GT.textRangeToDomRange = (map, start, end) => ({ start, end });

  globalThis.window.getSelection = () => ({
    rangeCount: 1,
    isCollapsed: false,
    anchorNode: ceField,
    focusNode: ceField,
    getRangeAt: () => ({
      startContainer: {},
      startOffset: 5,
      endContainer: {},
      endOffset: 12,
      getClientRects: () => [{ left: 10, top: 20, width: 50, height: 15, bottom: 35 }],
    }),
    removeAllRanges: () => {},
    addRange: (r) => { selectedRange = r; },
  });

  GT.refine.show();
  const bar = GT.refine.getBar();
  assert.ok(bar, 'Toolbar should show for contenteditable selection');

  const buttons = bar.querySelectorAll('button');
  buttons[0].focus();

  const makeKeyEvent = (key) => ({
    type: 'keydown',
    key,
    bubbles: true,
    preventDefault() {},
    stopPropagation() {},
  });

  buttons[0].dispatchEvent(makeKeyEvent('Escape'));
  assert.strictEqual(GT.refine.getBar(), null, 'Toolbar hides on Escape');
  assert.strictEqual(globalThis.document.activeElement, ceField, 'Focus restored to contenteditable');
  assert.deepStrictEqual(selectedRange, { start: 5, end: 12 }, 'Selection range preserved');
});

test('refine toolbar: triggerFromShortcut and COMMAND_TRIGGER_REWRITE', () => {
  const { toasts, messageListeners, GT } = setupRefineTestEnv();

  delete require.cache[require.resolve('../extension/src/content/refine.js')];
  require('../extension/src/content/refine.js');

  const textarea = createMockElement('textarea');
  textarea.value = 'Some test text for shortcut trigger.';

  // A. No selection -> toast warning
  textarea.setSelectionRange(5, 5); // collapsed
  textarea.focus();

  GT.refine.triggerFromShortcut();
  assert.strictEqual(GT.refine.getBar(), null, 'Toolbar should not show without selection');
  assert.ok(
    toasts.includes('TypeSpark: select text first to rewrite'),
    'Should display warning toast when no selection'
  );

  // B. With selection -> show toolbar and focus first pill button
  textarea.setSelectionRange(5, 14); // "test text"
  textarea.focus();

  GT.refine.triggerFromShortcut();
  const bar = GT.refine.getBar();
  assert.ok(bar, 'Toolbar should appear when text is selected');

  const buttons = bar.querySelectorAll('button');
  assert.strictEqual(globalThis.document.activeElement, buttons[0], 'First pill button should be focused');

  GT.refine.hide();

  // C. Dispatched via COMMAND_TRIGGER_REWRITE message listener
  assert.ok(messageListeners.length > 0, 'Should register message listener for COMMAND_TRIGGER_REWRITE');

  textarea.setSelectionRange(0, 9); // "Some test"
  textarea.focus();

  for (const listener of messageListeners) {
    listener({ type: 'COMMAND_TRIGGER_REWRITE' });
  }

  const barAfterMsg = GT.refine.getBar();
  assert.ok(barAfterMsg, 'Toolbar should show after COMMAND_TRIGGER_REWRITE message');
  const buttonsAfterMsg = barAfterMsg.querySelectorAll('button');
  assert.strictEqual(globalThis.document.activeElement, buttonsAfterMsg[0], 'First pill button focused via message');

  GT.refine.hide();
});
