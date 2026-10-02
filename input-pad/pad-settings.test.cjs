const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
global.self = global;
const { InputController } = require("../vendor/McBopomofoWeb/output/example/bundle.js");
const { InputPad } = require("./pad-core.js");
const { DEFAULT_SETTINGS, normalizeSettings, normalizePhraseTable, serializePhraseMap } = require("./pad-settings.js");

function fixture(settings = {}) {
  const editor = { value: "", selectionStart: 0, selectionEnd: 0,
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; } };
  let state;
  const pad = new InputPad(InputController, editor, (value) => { state = value; }, () => {}, settings);
  const keys = (text) => { for (const key of text) pad.controller.simpleKeyboardEvent(key, false, false); };
  const event = (key, code = key, extras = {}) => pad.controller.keyEvent({ key, code, shiftKey: false, ctrlKey: false, ...extras });
  return { pad, editor, keys, event, state: () => state };
}

test("every persisted input setting has an editable UI control", () => {
  const html = fs.readFileSync(`${__dirname}/settings.html`, "utf8");
  for (const key of Object.keys(DEFAULT_SETTINGS)) assert.ok(html.includes(`name="${key}"`), key);
});

test("settings roundtrip preserves options and custom dictionaries; invalid fields fall back", () => {
  const source = { ...DEFAULT_SETTINGS, trad_mode: true, layout: "Standard", candidate_keys_count: 9,
    user_phrases: "# 自訂\n臺灣 ㄋㄧˇ-ㄏㄠˇ", excluded_phrases: "泥 ㄋㄧˇ" };
  assert.deepEqual(normalizeSettings(JSON.parse(JSON.stringify(source))), source);
  const bad = normalizeSettings({ layout: "invalid", candidate_keys_count: 99, chinese_conversion: "false", bpmf_font: "evil", unknown: 1 });
  assert.deepEqual(bad, { ...DEFAULT_SETTINGS });
});

test("phrase validation keeps comments, normalizes tabs/spaces, and rejects malformed rows", () => {
  assert.equal(normalizePhraseTable("# 註解\r\n你好\t ㄋㄧˇ-ㄏㄠˇ \r\n"), "# 註解\n你好 ㄋㄧˇ-ㄏㄠˇ\n");
  assert.throws(() => normalizePhraseTable("你好"), /第 1 行/);
  assert.throws(() => normalizePhraseTable("你好 ㄋㄧˇ-ㄏㄠˇ 多餘"), /第 1 行/);
  assert.equal(serializePhraseMap(new Map([["ㄋㄧˇ", ["你", "妳"]]])), "你 ㄋㄧˇ\n妳 ㄋㄧˇ");
});

test("changing settings commits pending Chinese once and preserves existing draft", () => {
  const f = fixture();
  f.keys("nejhzj");
  f.pad.applySettings({ ...DEFAULT_SETTINGS, candidate_keys_count: 9 });
  assert.equal(f.editor.value, "你好");
  assert.equal(f.pad.copyText(), "你好");
});

test("manual mode opens candidates and chosen text commits", () => {
  const f = fixture({ trad_mode: true });
  f.keys("nej");
  assert.ok(f.state().candidates.length > 0);
  const candidate = f.state().candidates[0];
  f.pad.choose(candidate.keyCap);
  assert.equal(f.editor.value, candidate.candidate.value);
});

test("custom phrases affect automatic choice and conversion outputs simplified Chinese", () => {
  const f = fixture({ user_phrases: "臺灣 ㄋㄧˇ-ㄏㄠˇ", chinese_conversion: true });
  f.keys("nejhzj");
  assert.equal(f.pad.copyText(), "台湾");
});

test("excluded phrases no longer appear in candidates", () => {
  const f = fixture({ excluded_phrases: "你 ㄋㄧˇ" });
  f.keys("nej");
  f.event("ArrowDown");
  assert.ok(f.state().candidates.length > 0);
  assert.ok(f.state().candidates.every((candidate) => candidate.candidate.value !== "你"));
});

test("letter candidate keys and nine choices work on later pages", () => {
  const f = fixture({ candidate_keys: "asdfghjkl", candidate_keys_count: 9 });
  f.keys("nej");
  f.event("ArrowDown");
  assert.equal(f.state().candidates.length, 9);
  assert.equal(f.state().candidates[0].keyCap, "a");
  f.event("PageDown");
  const candidate = f.state().candidates[1];
  f.pad.choose(candidate.keyCap);
  assert.equal(f.pad.copyText(), candidate.candidate.value);
});

test("Ctrl Enter phonetic setting reaches the engine", () => {
  const f = fixture({ ctrl_enter_option: 1 });
  f.keys("nejhzj");
  assert.equal(f.event("Enter", "Enter", { ctrlKey: true }), true);
  assert.equal(f.editor.value, "ㄋㄧˇ-ㄏㄠˇ");
});

test("half width punctuation changes emitted symbols", () => {
  const full = fixture({ half_width_punctuation: false });
  const half = fixture({ half_width_punctuation: true });
  for (const f of [full, half]) f.event("<", "Comma", { shiftKey: true });
  assert.equal(full.pad.copyText(), "〈");
  assert.equal(half.pad.copyText(), "<");
});
