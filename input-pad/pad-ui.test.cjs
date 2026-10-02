const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
global.self = global;
const engine = require('../vendor/McBopomofoWeb/output/example/bundle.js');
const { InputPad } = require('./pad-core.js');
const PadSettings = require('./pad-settings.js');
const ReturnUI = require('./return-ui.js');

function fixture(settings = {}, options = {}) {
  const messages = [], timers = [];
  class Element {
    constructor() {
      this.children = []; this.listeners = {}; this.attributes = {}; this.style = {};
      this.value = ''; this.selectionStart = 0; this.selectionEnd = 0;
      this.classList = { toggle() {} };
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    set textContent(text) { this.children = [String(text)]; }
    get textContent() { return this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); }
    addEventListener(name, action) { (this.listeners[name] ??= []).push(action); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name]; }
    focus() { document.activeElement = this; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    fire(name, value = {}) { for (const action of this.listeners[name] || []) action({ preventDefault() {}, ...value }); }
  }
  const elements = Object.fromEntries(['editor', 'composition', 'choices', 'status', 'help', 'layout-name', 'script-name', 'mode', 'pin', 'copy', 'clear', 'settings', 'return-mode', 'return-target', 'return-hint', 'return-send', 'return-authorize'].map(id => [id, new Element()]));
  elements.pin.setAttribute('aria-pressed', 'false');
  const handlers = Object.fromEntries(['copy', 'deliver', 'pin', 'settings', 'saveSettings', 'beep', 'deliveryMode', 'requestAccessibility'].map(name => [name, { postMessage(value) { messages.push({ name, value }); } }]));
  if (options.beepAvailable === false) delete handlers.beep;
  if (options.deliverAvailable === false) delete handlers.deliver;
  const window = { initialPadSettings: settings, initialDeliveryState: { mode: options.returnMode || 'copy_return', targetName: '測試欄位', permissionGranted: true }, webkit: { messageHandlers: handlers } };
  const document = { activeElement: null, getElementById: id => elements[id], createElement: () => new Element(), createTextNode: text => String(text), body: new Element(), fonts: { load: async () => [] } };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/pad.js`, 'utf8'), { document, window, InputPad, PadSettings, ReturnUI, mcbopomofo: engine,
    clearTimeout() {}, setTimeout(action) { timers.push(action); return timers.length; } });
  const event = (key, code = key, extras = {}) => elements.editor.fire('keydown', { key, code, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...extras });
  const keys = text => { for (const key of text) event(key, key === ' ' ? 'Space' : /^[0-9]$/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`); };
  const caretCount = () => {
    const count = node => typeof node === 'string' ? 0 : (node.className === 'caret' ? 1 : 0) + node.children.reduce((sum, child) => sum + count(child), 0);
    return count(elements.composition);
  };
  const caretText = () => {
    const text = node => typeof node === 'string' ? node : node.className === 'caret' ? '|' : node.children.map(text).join('');
    return text(elements.composition);
  };
  return { elements, window, document, messages, event, keys, caretCount, caretText, timers };
}

test('candidate page indicator starts at one and never exceeds the final page', () => {
  const f = fixture(); f.keys('hxq '); f.event('ArrowDown');
  const page = () => f.elements.choices.children.find(child => child.className === 'page').textContent;
  assert.match(page(), /^1\/\d+$/u);
  f.event('End');
  const [current, total] = page().split('/').map(Number);
  assert.equal(current, total);
  const finalPage = page();
  f.elements.choices.children.find(child => child.attributes?.['aria-label'] === '下一頁候選字').fire('click');
  assert.equal(page(), finalPage);
  assert.notEqual(f.elements.status.textContent, '這個按鍵目前無法使用');
});

test('supplementary Han characters keep a visible composition caret', () => {
  const f = fixture({ user_phrases: '𠮷 ㄋㄧˇ' }); f.keys('nej');
  assert.equal(f.elements.composition.textContent, '𠮷');
  assert.equal(f.caretCount(), 1);
  f.event('Enter'); assert.equal(f.elements.editor.value, '𠮷');
});

test('composition caret stays between whole astral or IVS words and the following BMP word', () => {
  for (const phrase of ['𠮷', '禰' + String.fromCodePoint(0xe0100)]) {
    const f = fixture({ user_phrases: `${phrase} ㄋㄧˇ` }); f.keys('nej'); f.event('ArrowDown');
    f.elements.choices.children.find(child => child.textContent.includes(phrase)).fire('click');
    f.keys('hzj');
    assert.equal(f.caretText(), `${phrase}好|`);
    f.event('ArrowLeft'); assert.equal(f.caretText(), `${phrase}|好`);
  }
});

test('clicking a shifted digit candidate converts to Chinese numbers', () => {
  const f = fixture(); f.event('\\', 'Backslash', { ctrlKey: true });
  f.elements.choices.children.find(child => child.textContent.includes('數字輸入')).fire('click');
  f.keys('12');
  f.elements.choices.children.find(child => child.textContent === '⇧ 2壹拾貳').fire('click');
  assert.equal(f.elements.editor.value, '壹拾貳');
});

test('clicking a shifted letter candidate uses the same choice as the keyboard', () => {
  const f = fixture({ candidate_keys: 'asdfghjkl' }); f.event('\\', 'Backslash', { ctrlKey: true });
  f.elements.choices.children.find(child => child.textContent.includes('數字輸入')).fire('click');
  f.keys('12');
  f.elements.choices.children.find(child => child.textContent === '⇧ s壹拾貳').fire('click');
  assert.equal(f.elements.editor.value, '壹拾貳');
});

test('unfinished first tone Enter explains the required Space instead of a generic failure', () => {
  const f = fixture(); f.keys('hxq'); f.event('Enter');
  assert.equal(f.elements.editor.value, '');
  assert.equal(f.elements.composition.textContent, 'ㄏㄨㄟ');
  assert.match(f.elements.status.textContent, /一聲.*空白/u);
  f.event(' ', 'Space'); f.event('Enter'); assert.equal(f.elements.editor.value, '揮');
});

test('optional beep cannot overwrite the reading hint when a browser has no native beep host', () => {
  const f = fixture({ beep_on_error: true }, { beepAvailable: false }); f.keys('hxq'); f.event('Enter');
  assert.match(f.elements.status.textContent, /一聲.*空白/u);
});

test('an isolated tone marker asks for a complete reading rather than guessing first tone', () => {
  const f = fixture({ layout: 'Standard' }); f.keys('6'); f.event('Enter');
  assert.equal(f.elements.composition.textContent, 'ˊ');
  assert.match(f.elements.status.textContent, /補齊音節/u);
  assert.doesNotMatch(f.elements.status.textContent, /一聲/u);
});

test('system IME events are not passed to the embedded engine', () => {
  const f = fixture(); f.event('Process', 'KeyH', { isComposing: true, keyCode: 229 });
  assert.equal(f.elements.composition.textContent, '');
  assert.match(f.elements.status.textContent, /ABC/u);
});

test('English mode accepts native letters without generating Bopomofo', () => {
  const f = fixture(); f.elements.mode.fire('click'); f.keys('hxq');
  assert.equal(f.elements.mode.textContent, '英文'); assert.equal(f.elements.composition.textContent, '');
  f.elements.mode.fire('click'); f.keys('hxq '); f.event('Enter'); assert.equal(f.elements.editor.value, '揮');
});

test('copy, clear and undo preserve completed composition exactly once', () => {
  const f = fixture(); f.keys('nejhzj'); f.elements.copy.fire('click'); f.elements.copy.fire('click');
  assert.deepEqual(f.messages.filter(item => item.name === 'copy').map(item => item.value), ['你好', '你好']);
  f.elements.clear.fire('click'); assert.equal(f.elements.editor.value, '');
  f.event('z', 'KeyZ', { metaKey: true }); assert.equal(f.elements.editor.value, '你好');
});

test('copy preserves an unfinished reading literally and never guesses a tone', () => {
  const f = fixture(); f.keys('hxq'); f.elements.copy.fire('click');
  assert.equal(f.messages.find(item => item.name === 'copy').value, 'ㄏㄨㄟ');
});

test('both return actions commit preedit and deliver the current draft without a prior Copy', () => {
  for (const returnMode of ['copy_return', 'auto_paste']) {
    const f = fixture({}, { returnMode }); f.keys('nejhzj');
    assert.equal(f.elements.editor.value, '');
    f.elements['return-send'].fire('click');
    assert.deepEqual(f.messages, [{ name: 'deliver', value: '你好' }]);
    assert.equal(f.elements.editor.value, '你好');
    assert.equal(f.elements.composition.textContent, '');
    f.window.padHost.sendBack();
    assert.equal(f.messages.length, 1);
  }
});

test('empty or unavailable return bridge unlocks and explains why it cannot return', () => {
  const empty = fixture(); empty.elements['return-send'].fire('click');
  assert.deepEqual(empty.messages, []);
  assert.equal(empty.elements['return-send'].disabled, false);
  assert.match(empty.elements.status.textContent, /先輸入文字/u);
  const missing = fixture({}, { deliverAvailable: false }); missing.keys('nej');
  missing.elements['return-send'].fire('click');
  assert.equal(missing.elements['return-send'].disabled, false);
  assert.equal(missing.elements.editor.value, '你');
  assert.match(missing.elements.status.textContent, /Mac 小工具/u);
});

test('delivery failures remain visible rather than vanishing after a short status timer', () => {
  const f = fixture(); const before = f.timers.length;
  f.window.padHost.deliveryResult('已複製；無法確認原欄位，請改用「複製並返回」。');
  assert.equal(f.timers.length, before);
  assert.match(f.elements.status.textContent, /無法確認原欄位/u);
});

test('changing return mode restores typing focus without needing Copy', () => {
  const f = fixture(); f.document.activeElement = f.elements['return-mode'];
  f.elements['return-mode'].value = 'auto_paste'; f.elements['return-mode'].fire('change');
  assert.equal(f.document.activeElement, f.elements.editor);
  assert.deepEqual(f.messages, [{ name: 'deliveryMode', value: 'auto_paste' }]);
  f.keys('hxq '); f.elements['return-send'].fire('click');
  assert.equal(f.messages.at(-1).value, '揮');
});
