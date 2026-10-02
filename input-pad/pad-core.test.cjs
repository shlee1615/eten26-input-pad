const assert = require("node:assert/strict");
const { test } = require("node:test");
global.self = global;
const { InputController } = require("../vendor/McBopomofoWeb/output/example/bundle.js");
const { InputPad } = require("./pad-core.js");

function fixture(value = "") {
  const editor = {
    value, selectionStart: value.length, selectionEnd: value.length,
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
  };
  let state;
  const pad = new InputPad(InputController, editor, (next) => { state = next; });
  const keys = (input) => { for (const key of input) pad.controller.simpleKeyboardEvent(key, false, false); };
  const special = (key, code = key) => pad.controller.keyEvent({ key, code, shiftKey: false, ctrlKey: false });
  return { editor, pad, keys, special, state: () => state };
}

test("倚天26 produces 你好 and copy includes uncommitted composition exactly once", () => {
  const f = fixture();
  f.keys("nejhzj");
  assert.equal(f.pad.copyText(), "你好");
  assert.equal(f.pad.copyText(), "你好");
});

test("clearing pending input does not later commit discarded text", () => {
  const f = fixture("原有");
  f.keys("nejhzj");
  f.pad.clear();
  assert.equal(f.editor.value, "");
  f.keys("nejhzj");
  f.special("Enter");
  assert.equal(f.pad.copyText(), "你好");
});

test("composition replaces a selection and preserves emoji plus suffix", () => {
  const f = fixture("😀原有文字尾");
  f.editor.setSelectionRange(2, 6);
  f.keys("nejhzj");
  assert.equal(f.pad.copyText(), "😀你好尾");
  assert.equal(f.editor.selectionStart, 4);
});

test("candidate click chooses the visible key on later pages", () => {
  const f = fixture();
  f.keys("nej");
  f.special("ArrowDown");
  assert.ok(f.state().candidates.length > 0);
  f.special("PageDown");
  assert.ok(f.state().candidatePageIndex > 0);
  const candidate = f.state().candidates[0];
  f.pad.choose(candidate.keyCap);
  assert.equal(f.pad.copyText(), candidate.candidate.value);
});

test("Enter commits Chinese; a following Enter can add an ordinary newline", () => {
  const f = fixture();
  f.keys("nejhzj");
  assert.equal(f.special("Enter"), true);
  assert.equal(f.editor.value, "你好");
  assert.equal(f.special("Enter"), false);
});

test("clear can be undone including pending Chinese, then redone", () => {
  const f = fixture("原有");
  f.keys("nejhzj");
  f.pad.clear();
  f.pad.undo();
  assert.equal(f.editor.value, "原有你好");
  f.pad.redo();
  assert.equal(f.editor.value, "");
});

test("undo discards pending composition before undoing committed text", () => {
  const f = fixture("原有");
  f.keys("nejhzj");
  f.pad.undo();
  assert.equal(f.editor.value, "原有");
  assert.equal(f.pad.copyText(), "原有");
});

test("commits, native edits, and selection replacement support undo/redo", () => {
  const f = fixture("😀尾");
  f.editor.setSelectionRange(2, 2);
  f.keys("nejhzj");
  f.pad.finish();
  assert.equal(f.editor.value, "😀你好尾");
  f.pad.undo();
  assert.equal(f.editor.value, "😀尾");
  assert.equal(f.editor.selectionStart, 2);
  f.pad.redo();
  f.editor.value += "ABC";
  f.editor.setSelectionRange(f.editor.value.length, f.editor.value.length);
  f.pad.checkpoint();
  f.pad.undo();
  assert.equal(f.editor.value, "😀你好尾");
  f.editor.setSelectionRange(2, 4);
  f.keys("nej");
  f.pad.finish();
  f.pad.redo();
  assert.equal(f.editor.value, "😀你尾");
});
