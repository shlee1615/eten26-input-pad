const { test } = require("node:test");
const assert = require("node:assert/strict");
const { create } = require("./return-ui.js");
function fixture(sendResult) {
  const ids = ["return-mode", "return-target", "return-hint", "return-send", "return-authorize"];
  const elements = Object.fromEntries(ids.map((id) => [id, { listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; } }]));
  let sends = 0, grants = 0, selected; const notices = [];
  const ui = create({ getElementById(id) { return elements[id]; } }, {
    send() { sends += 1; return sendResult; }, selectMode(value) { selected = value; }, authorize() { grants += 1; }, notify(message) { notices.push(message); },
  });
  return { ui, elements, notices, sends: () => sends, grants: () => grants, selected: () => selected };
}
test("copy-return is usable without granting Accessibility and displays the destination", () => {
  const f = fixture();
  f.ui.load({ mode: "copy_return", targetName: "文字編輯", permissionGranted: false });
  assert.equal(f.elements["return-send"].disabled, false);
  assert.equal(f.elements["return-authorize"].hidden, true);
  assert.equal(f.elements["return-target"].textContent, "目的：文字編輯");
  assert.equal(f.elements["return-send"].textContent, "複製並返回");
  assert.match(f.elements["return-hint"].textContent, /⌘ V/u);
  f.ui.submit(); assert.equal(f.sends(), 1);
});
test("automatic mode requires explicit authorization and does not send while untrusted", () => {
  const f = fixture();
  f.ui.load({ mode: "auto_paste", targetName: "文字編輯", permissionGranted: false });
  f.ui.submit(); assert.equal(f.sends(), 0);
  assert.equal(f.elements["return-authorize"].hidden, false);
  f.elements["return-authorize"].listeners.click(); assert.equal(f.grants(), 1);
  f.ui.load({ mode: "auto_paste", targetName: "文字編輯", permissionGranted: true });
  assert.equal(f.elements["return-send"].textContent, "複製並貼回");
  assert.match(f.elements["return-hint"].textContent, /不用先按/u);
  f.ui.submit(); assert.equal(f.sends(), 1);
  assert.equal(f.elements["return-send"].textContent, "處理中…");
});
test("click plus shortcut cannot duplicate a send while the bridge is pending", () => {
  const f = fixture();
  f.ui.load({ mode: "auto_paste", targetName: "文字編輯", permissionGranted: true });
  f.elements["return-send"].listeners.click(); f.ui.submit();
  assert.equal(f.sends(), 1); assert.equal(f.elements["return-mode"].disabled, true);
});
test("mode selection reaches the native host; absence of a target disables returning", () => {
  const f = fixture();
  f.elements["return-mode"].value = "auto_paste";
  f.elements["return-mode"].listeners.change();
  assert.equal(f.selected(), "auto_paste");
  f.ui.load({ mode: "copy_return", targetName: "" });
  assert.equal(f.elements["return-send"].disabled, true);
});
test("empty text unlocks immediately and a completed native response also unlocks", () => {
  const f = fixture(false);
  f.ui.load({ mode: "copy_return", targetName: "文字編輯" });
  f.ui.submit();
  assert.equal(f.elements["return-send"].disabled, false);
  assert.equal(f.elements["return-mode"].disabled, false);
  const pending = fixture(true);
  pending.ui.load({ mode: "copy_return", targetName: "文字編輯" });
  pending.ui.submit();
  pending.ui.load({ mode: "copy_return", targetName: "文字編輯", busy: false });
  assert.equal(pending.elements["return-send"].disabled, true, "idle state alone cannot unlock the pending operation");
  pending.ui.release();
  assert.equal(pending.elements["return-send"].disabled, false);
});

test("disabled shortcuts explain missing target or authorization, and null state recovers", () => {
  const f = fixture(); f.ui.load(null); f.ui.submit();
  assert.match(f.notices.at(-1), /目標程式/u);
  f.ui.load({ mode: 'auto_paste', targetName: 'Chrome', permissionGranted: false }); f.ui.submit();
  assert.match(f.notices.at(-1), /授權/u);
  f.ui.load({ mode: 'auto_paste', targetName: 'Chrome', permissionGranted: true, hasCaret: false });
  assert.match(f.elements['return-hint'].textContent, /尚未記住原欄位/u);
  f.ui.load({ mode: 'auto_paste', targetName: 'Chrome', permissionGranted: true, hasCaret: true });
  assert.match(f.elements['return-hint'].textContent, /不用先按/u);
});
