const assert = require("node:assert/strict");
const { test } = require("node:test");
const vm = require("node:vm");
const fs = require("node:fs");
const api = require("./pad-settings.js");

function fixture(initial = {}) {
  function element(name, type = "select") {
    return { name, type, value: "", checked: false, listeners: {},
      classList: { toggle() {} }, append() {}, setAttribute() {},
      addEventListener(event, fn) { this.listeners[event] = fn; } };
  }
  const controls = [element("layout"), element("bpmf_font"), element("user_phrases", "textarea"), element("excluded_phrases", "textarea")];
  const byName = Object.fromEntries(controls.map((value) => [value.name, value]));
  const buttons = Object.fromEntries(["status", "save", "close", "reset"].map((id) => [id, element(id)]));
  let saved;
  const window = { initialPadSettings: initial, webkit: { messageHandlers: { saveSettings: { postMessage(value) { saved = value.value; } } } } };
  const document = {
    querySelectorAll(selector) { return selector.includes("input[name]") ? controls : []; },
    querySelector(selector) { return byName[selector.match(/name="(.*?)"/)[1]]; },
    getElementById(id) { return buttons[id]; }, createElement() { return element(""); },
  };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/settings.js`, "utf8"), { window, document, PadSettings: api });
  const edit = (name, value) => { byName[name].value = value; byName[name].listeners.input(); };
  const save = () => { buttons.save.listeners.click(); return saved; };
  return { window, byName, buttons, edit, save };
}

test("editing one setting does not overwrite phrases learned in the input window", () => {
  const f = fixture({ user_phrases: "你 ㄋㄧˇ" });
  f.edit("layout", "Standard");
  f.window.settingsHost.load({ ...api.DEFAULT_SETTINGS, user_phrases: "你 ㄋㄧˇ\n妳 ㄋㄧˇ" });
  const result = f.save();
  assert.equal(result.layout, "Standard");
  assert.equal(result.user_phrases, "你 ㄋㄧˇ\n妳 ㄋㄧˇ");
});

test("dictionary editing conflict preserves the draft and displays a notice", () => {
  const f = fixture({ user_phrases: "你 ㄋㄧˇ" });
  f.edit("user_phrases", "妳 ㄋㄧˇ");
  f.window.settingsHost.load({ ...api.DEFAULT_SETTINGS, user_phrases: "泥 ㄋㄧˇ" });
  assert.equal(f.byName.user_phrases.value, "妳 ㄋㄧˇ");
  assert.match(f.buttons.status.textContent, /正在編輯/);
});

test("reset preserves unsaved phrase edits while restoring options", () => {
  const f = fixture({ layout: "Standard" });
  f.edit("user_phrases", "你好 ㄋㄧˇ-ㄏㄠˇ");
  f.buttons.reset.listeners.click();
  const result = f.save();
  assert.equal(result.layout, "ETen26");
  assert.equal(result.user_phrases, "你好 ㄋㄧˇ-ㄏㄠˇ");
});
