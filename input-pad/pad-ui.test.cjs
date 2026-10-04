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
      const classes = new Set(); this.classList = { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }, contains(name) { return classes.has(name); } };
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
    fire(name, value = {}) { const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...value }; for (const action of this.listeners[name] || []) action(event); return event; }
  }
  const elements = Object.fromEntries(['editor', 'composition', 'choices', 'status', 'help', 'layout-name', 'script-name', 'mode', 'pin', 'copy', 'clear', 'settings', 'return-mode', 'return-target', 'return-hint', 'return-send', 'return-authorize', 'restore-sent'].map(id => [id, new Element()]));
  elements.pin.setAttribute('aria-pressed', 'false');
  const handlers = Object.fromEntries(['copy', 'deliver', 'pin', 'settings', 'saveSettings', 'beep', 'deliveryMode', 'deliveryStatus', 'padLayout', 'requestAccessibility'].map(name => [name, { postMessage(value) { messages.push({ name, value }); } }]));
  if (options.beepAvailable === false) delete handlers.beep;
  if (options.deliverAvailable === false) delete handlers.deliver;
  const window = Object.assign(new Element(), { crypto: require('node:crypto'), initialPadSettings: settings, initialDeliveryState: { mode: options.returnMode || 'copy_return', targetName: '測試欄位', permissionGranted: true, hasCaret: true }, webkit: { messageHandlers: handlers } });
  const document = Object.assign(new Element(), { activeElement: null, getElementById: id => elements[id], createElement: () => new Element(), createTextNode: text => String(text), body: new Element(), fonts: { load: async () => [] } });
  vm.runInNewContext(fs.readFileSync(`${__dirname}/pad.js`, 'utf8'), { document, window, InputPad, PadSettings, ReturnUI, mcbopomofo: engine,
    clearTimeout(id) { if (id) id.cancelled = true; }, setTimeout(action, delay) { const timer = { action, delay }; timers.push(timer); return timer; } });
  const event = (key, code = key, extras = {}) => elements.editor.fire('keydown', { key, code, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...extras });
  const release = (key = 'Enter', code = key, extras = {}) => document.fire('keyup', { key, code, ...extras });
  const keys = text => { for (const key of text) event(key, key === ' ' ? 'Space' : /^[0-9]$/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`); };
  const caretCount = () => {
    const count = node => typeof node === 'string' ? 0 : (node.className === 'caret' ? 1 : 0) + node.children.reduce((sum, child) => sum + count(child), 0);
    return count(elements.composition);
  };
  const caretText = () => {
    const text = node => typeof node === 'string' ? node : node.className === 'caret' ? '|' : node.children.map(text).join('');
    return text(elements.composition);
  };
  return { elements, window, document, messages, event, release, keys, caretCount, caretText, timers };
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
    assert.equal(f.messages.length, 1); assert.equal(f.messages[0].name, 'deliver'); assert.equal(f.messages[0].value.text, '你好'); assert.match(f.messages[0].value.operationID, /^[0-9a-f-]{36}$/u);
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
  assert.equal(f.messages.at(-1).value.text, '揮');
});

const deliveries = f => f.messages.filter(item => item.name === 'deliver');
const directFixture = (settings = {}, options = {}) => fixture(settings, { returnMode: 'enter_paste', ...options });
const ack = (f, status = 'pasted', extras = {}) => f.window.padHost.deliveryResult({ operationID: deliveries(f).at(-1).value.operationID, status, message: '測試結果', ...extras });

test('direct Enter waits for release, prevents repeats, clears on verified paste and can restore', () => {
  const f = directFixture(); f.keys('nejhzj');
  assert.equal(f.event('Enter').defaultPrevented, true);
  assert.equal(f.elements.editor.value, '你好'); assert.equal(deliveries(f).length, 0);
  assert.equal(f.event('Enter', 'Enter', { repeat: true }).defaultPrevented, true);
  assert.equal(deliveries(f).length, 0);
  f.release(); f.release(); assert.equal(deliveries(f).length, 1);
  assert.equal(deliveries(f)[0].value.text, '你好');
  f.event('Enter'); f.elements['return-send'].fire('click'); assert.equal(deliveries(f).length, 1);
  f.document.activeElement = null; ack(f);
  assert.equal(f.elements.editor.value, ''); assert.equal(f.document.activeElement, null, 'ack must not take keyboard focus');
  assert.equal(f.elements['restore-sent'].hidden, false);
  f.elements['restore-sent'].fire('click'); assert.equal(f.elements.editor.value, '你好');
  assert.equal(deliveries(f).length, 1, 'restore must not paste again');
});

test('unfinished reading and an isolated tone never get forced into a delivery', () => {
  for (const [settings, keys, expected] of [[{}, 'hxq', 'ㄏㄨㄟ'], [{ layout: 'Standard' }, '6', 'ˊ']]) {
    const f = directFixture(settings); f.keys(keys); f.event('Enter'); f.release();
    assert.equal(deliveries(f).length, 0); assert.equal(f.elements.editor.value, '');
    assert.equal(f.elements.composition.textContent, expected);
    f.elements['return-send'].fire('click'); assert.equal(deliveries(f).length, 0);
    assert.equal(f.elements.composition.textContent, expected);
  }
});

test('Enter in candidate selection does not paste; the next Enter does in both input modes', () => {
  for (const trad_mode of [false, true]) {
    const f = directFixture({ trad_mode }); f.keys('nej');
    if (!trad_mode) f.event('ArrowDown');
    assert.ok(f.elements.choices.children.length);
    f.event('Enter'); f.release(); assert.equal(deliveries(f).length, 0);
    f.event('Enter'); f.release(); assert.equal(deliveries(f).length, 1);
    assert.equal(deliveries(f)[0].value.text, '你');
  }
});

test('feature and numeric selection Enter retain their original actions without delivering', () => {
  const f = directFixture(); f.event('\\', 'Backslash', { ctrlKey: true });
  f.event('Enter'); f.release(); assert.equal(deliveries(f).length, 0);
  const numeric = directFixture(); numeric.event('\\', 'Backslash', { ctrlKey: true });
  numeric.elements.choices.children.find(child => child.textContent.includes('數字輸入')).fire('click');
  numeric.keys('12'); numeric.event('Enter'); numeric.release();
  assert.equal(deliveries(numeric).length, 0);
});

test('shorter selection replacement and supplementary Han are legal direct commits', () => {
  const f = directFixture({ user_phrases: '𠮷 ㄋㄧˇ' });
  f.elements.editor.value = '😀原有長文字尾'; f.elements.editor.fire('input');
  f.elements.editor.setSelectionRange(2, 7); f.keys('nej'); f.event('Enter'); f.release();
  assert.equal(deliveries(f)[0].value.text, '😀𠮷尾');
});

test('empty direct Enter is inert; native English drafts can be delivered', () => {
  const empty = directFixture(); assert.equal(empty.event('Enter').defaultPrevented, true); empty.release();
  assert.equal(deliveries(empty).length, 0);
  const f = directFixture(); f.elements.mode.fire('click');
  f.elements.editor.value = 'ABC 😀'; f.elements.editor.fire('input');
  f.event('Enter'); f.release(); assert.equal(deliveries(f)[0].value.text, 'ABC 😀');
});

test('blur, visibility, mismatched key release, another key and arm timeout cancel delivery', () => {
  const cancellations = [f => f.window.fire('blur'), f => f.elements.editor.fire('blur'),
    f => { f.document.hidden = true; f.document.fire('visibilitychange'); },
    f => f.release('Enter', 'NumpadEnter'), f => f.event('h'),
    f => f.timers.find(timer => timer.delay === 5000).action(),
    f => f.document.fire('pointerdown')];
  for (const cancel of cancellations) {
    const f = directFixture(); f.keys('nej'); f.event('Enter'); cancel(f); f.release();
    assert.equal(deliveries(f).length, 0); assert.equal(f.elements.editor.value, '你');
    assert.equal(f.elements['return-mode'].disabled, false);
  }
});

test('draft changes between Enter down and up cancel the armed paste', () => {
  const f = directFixture(); f.keys('nej'); f.event('Enter');
  f.elements.editor.value += '!'; f.elements.editor.fire('input'); f.release();
  assert.equal(deliveries(f).length, 0); assert.equal(f.elements.editor.value, '你!');
});

test('typing or undo during an in-flight paste prevents clearing the newer draft', () => {
  for (const edit of [f => f.keys('hxq'), f => f.event('z', 'KeyZ', { metaKey: true }),
    f => { f.elements.editor.value += '新'; f.elements.editor.fire('input'); }]) {
    const f = directFixture(); f.keys('nej'); f.event('Enter'); f.release(); edit(f);
    const draft = f.elements.editor.value, composition = f.elements.composition.textContent;
    ack(f); assert.equal(f.elements.editor.value, draft); assert.equal(f.elements.composition.textContent, composition);
    assert.match(f.elements.status.textContent, /新輸入.*保留/u);
  }
});

test('failed or unconfirmed paste retains the draft; unrelated and duplicate receipts are ignored', () => {
  for (const status of ['caretUnavailable', 'permissionRequired', 'pasteUnconfirmed', 'rejected']) {
    const f = directFixture(); f.keys('nej'); f.event('Enter'); f.release();
    ack(f, 'pasted', { operationID: 'different-operation' }); assert.equal(f.elements.editor.value, '你');
    assert.equal(f.elements['return-mode'].disabled, true);
    ack(f, status); assert.equal(f.elements.editor.value, '你');
    f.window.padHost.loadDelivery({ mode: 'enter_paste', targetName: '測試欄位', permissionGranted: true, busy: false });
    assert.equal(f.elements['return-mode'].disabled, false);
    ack(f); assert.equal(f.elements.editor.value, '你', 'duplicate ack cannot clear preserved text');
  }
});

test('idle host state does not unlock early; lastResult recovers an omitted receipt', () => {
  const f = directFixture(); f.keys('nej'); f.event('Enter'); f.release();
  f.window.padHost.loadDelivery({ mode: 'enter_paste', targetName: '測試欄位', permissionGranted: true, busy: false });
  assert.equal(f.elements['return-mode'].disabled, true);
  const operationID = deliveries(f)[0].value.operationID;
  f.window.padHost.loadDelivery({ mode: 'enter_paste', targetName: '測試欄位', permissionGranted: true,
    busy: false, lastResult: { operationID, status: 'pasted', message: 'done' } });
  assert.equal(f.elements.editor.value, ''); assert.equal(f.elements['return-mode'].disabled, false);
});

test('watchdog queries the original operation without resending or unlocking', () => {
  const f = directFixture(); f.keys('nej'); f.event('Enter'); f.release();
  f.timers.find(timer => timer.delay === 8000).action();
  assert.equal(deliveries(f).length, 1); assert.equal(f.elements['return-mode'].disabled, true);
  assert.equal(f.messages.at(-1).name, 'deliveryStatus');
  assert.equal(f.messages.at(-1).value, deliveries(f)[0].value.operationID);
  assert.equal(f.elements.editor.value, '你');
});

test('compact mode retains existing multiline text and switches back after clearing', () => {
  const f = directFixture(); assert.equal(f.document.body.classList.contains('compact'), true);
  f.elements.editor.value = '第一行\n第二行'; f.elements.editor.setSelectionRange(3, 6); f.elements.editor.fire('input');
  assert.equal(f.document.body.classList.contains('compact'), false);
  f.elements['return-mode'].value = 'auto_paste'; f.elements['return-mode'].fire('change');
  f.elements['return-mode'].value = 'enter_paste'; f.elements['return-mode'].fire('change');
  assert.equal(f.elements.editor.value, '第一行\n第二行'); assert.equal(f.elements.editor.selectionStart, 3);
  f.elements.clear.fire('click'); assert.equal(f.document.body.classList.contains('compact'), true);
});

test('system IME Enter does not arm delivery, and old shortcuts still keep the draft', () => {
  const f = directFixture(); f.event('Enter', 'Enter', { isComposing: true, keyCode: 229 }); f.release();
  assert.equal(deliveries(f).length, 0);
  for (const returnMode of ['copy_return', 'auto_paste']) {
    const old = fixture({}, { returnMode }); old.keys('nej'); old.event('Enter', 'Enter', { metaKey: true, shiftKey: true });
    assert.equal(deliveries(old).length, 1); ack(old);
    assert.equal(old.elements.editor.value, '你');
  }
});

test('in-flight delivery still allows confirming and selecting the next phrase without another paste', () => {
  const f = directFixture(); f.keys('nej'); f.event('Enter'); f.release();
  f.keys('hzj'); f.event('ArrowDown'); f.event('Enter'); f.release();
  assert.equal(deliveries(f).length, 1); assert.equal(f.elements.choices.children.length, 0);
  f.event('Enter'); f.release(); assert.equal(f.elements.editor.value, '你好');
  assert.equal(deliveries(f).length, 1); ack(f); assert.equal(f.elements.editor.value, '你好');
});

test('marked user-phrase Enter is never interpreted as paste', () => {
  const f = directFixture(); f.keys('nejhzj');
  f.event('ArrowLeft', 'ArrowLeft', { shiftKey: true }); f.event('ArrowLeft', 'ArrowLeft', { shiftKey: true });
  f.event('Enter'); f.release(); assert.equal(deliveries(f).length, 0);
});

test('UUID fallback stays valid and missing crypto or throwing bridges preserve the draft and unlock', () => {
  const fallback = directFixture(); fallback.window.crypto = { getRandomValues: require('node:crypto').getRandomValues };
  fallback.keys('nej'); fallback.event('Enter'); fallback.release();
  assert.match(deliveries(fallback)[0].value.operationID, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  for (const prepare of [f => { f.window.crypto = {}; },
    f => { f.window.webkit.messageHandlers.deliver.postMessage = () => { throw new Error('bridge disconnected'); }; }]) {
    const f = directFixture(); prepare(f); f.keys('nej'); f.event('Enter'); f.release();
    assert.equal(deliveries(f).length, 0); assert.equal(f.elements.editor.value, '你');
    assert.equal(f.elements['return-mode'].disabled, false); assert.match(f.elements.status.textContent, /保留/u);
  }
});

test('numpad Enter uses its matching release and Shift Enter confirms without paste or newline', () => {
  const f = directFixture(); f.keys('nej'); f.event('Enter', 'NumpadEnter'); f.release('Enter', 'NumpadEnter');
  assert.equal(deliveries(f).length, 1);
  const shifted = directFixture(); shifted.keys('nej'); shifted.event('Enter', 'Enter', { shiftKey: true }); shifted.release();
  assert.equal(deliveries(shifted).length, 0); assert.equal(shifted.elements.editor.value, '你');
});
