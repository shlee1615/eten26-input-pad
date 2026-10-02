const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fixture, audit } = require('./input-audit.cjs');

for (const layout of ['ETen26', 'Standard']) {
  for (const manual of [false, true]) {
    test(`${layout} ${manual ? 'manual' : 'automatic'}: every dictionary first tone converts successfully`, () => {
      const result = audit(layout, manual);
      assert.ok(result.tones['一聲'].tested >= 338);
      assert.equal(result.tones['一聲'].passed, result.tones['一聲'].tested);
      assert.deepEqual(result.failures.filter(item => !/[ˊˇˋ˙]$/u.test(item.reading)), []);
    });
  }
}

test('standard layout converts every tonal dictionary syllable, including standalone vowels', () => {
  assert.deepEqual(audit('Standard').failures, []);
  assert.deepEqual(audit('Standard', true).failures, []);
});

test('audit isolates the two existing ETen26 fourth-tone key collisions', () => {
  // q/z+ei and w/c+e cannot distinguish these bare vowels from zi/ci.
  // Track the upstream limitation explicitly instead of counting it as success.
  for (const manual of [false, true]) {
    const failures = audit('ETen26', manual).failures;
    assert.deepEqual(failures.map(item => item.reading).sort(), ['ㄝˋ', 'ㄟˋ']);
    assert.deepEqual(failures.map(item => item.actualReading).sort(), ['ㄗˋ', 'ㄘˋ']);
  }
});

test('all five tones can be entered consecutively without losing readings', () => {
  const f = fixture(); f.keys('ma mafmajmakmad');
  assert.deepEqual(f.pad.controller.keyHandler_.grid_.readings, ['ㄇㄚ', 'ㄇㄚˊ', 'ㄇㄚˇ', 'ㄇㄚˋ', 'ㄇㄚ˙']);
  f.event('Enter'); assert.equal(Array.from(f.editor.value).length, 5); assert.equal(f.errors(), 0);
});

test('first-tone syllables can be mixed with toned words in one composition', () => {
  const f = fixture(); f.keys('nejhzjhxq ');
  assert.deepEqual(f.pad.controller.keyHandler_.grid_.readings, ['ㄋㄧˇ', 'ㄏㄠˇ', 'ㄏㄨㄟ']);
  f.event('Enter'); assert.equal(f.editor.value, '你好揮'); assert.equal(f.errors(), 0);
});

test('backspace removes a phonetic final before completing the reading', () => {
  const f = fixture(); f.keys('hxq'); f.event('Backspace');
  assert.equal(f.state().composingBuffer.map(item => item.text).join(''), 'ㄏㄨ');
  f.event(' ', 'Space');
  assert.deepEqual(f.pad.controller.keyHandler_.grid_.readings, ['ㄏㄨ']);
  const choices = f.pad.controller.keyHandler_.languageModel_.getUnigrams('ㄏㄨ').map(item => item.value);
  f.event('Enter'); assert.ok(choices.includes(f.editor.value));
});

test('backspace removes only the last converted syllable', () => {
  const f = fixture(); f.keys('nejhzj'); f.event('Backspace'); f.event('Enter');
  assert.equal(f.editor.value, '你');
});

test('Escape clears all composition by default and preserves the committed draft', () => {
  const f = fixture({}, '原有'); f.keys('nejhxq'); f.event('Escape');
  assert.equal(f.pad.copyText(), '原有');
});

test('reading-only Escape clears phonetics while preserving converted text', () => {
  const f = fixture({ esc_key_clear_entire_buffer: false }); f.keys('nejhxq'); f.event('Escape'); f.event('Enter');
  assert.equal(f.editor.value, '你');
});

test('numpad Enter follows ordinary Enter after the first tone is complete', () => {
  const f = fixture(); f.keys('hxq '); f.event('Enter', 'NumpadEnter');
  assert.equal(f.editor.value, '揮'); assert.equal(f.errors(), 0);
});

test('invalid readings report an error and allow the next valid syllable', () => {
  const f = fixture(); f.keys('fuf');
  assert.equal(f.errors(), 1); assert.equal(f.editor.value, '');
  f.keys('hxq '); f.event('Enter'); assert.equal(f.editor.value, '揮');
});

test('selection replacement preserves emoji and rare Han suffixes through undo and redo', () => {
  const f = fixture({}, '😀原有𠮷尾'); f.editor.setSelectionRange(2, 4); f.keys('nejhzj'); f.event('Enter');
  assert.equal(f.editor.value, '😀你好𠮷尾');
  f.pad.undo(); assert.equal(f.editor.value, '😀原有𠮷尾');
  f.pad.redo(); assert.equal(f.editor.value, '😀你好𠮷尾');
});

test('candidate selection on the last page uses the visible cap correctly', () => {
  const f = fixture({ candidate_keys: 'asdfghjkl', candidate_keys_count: 9 }); f.keys('hxq '); f.event('ArrowDown'); f.event('End');
  assert.equal(f.state().candidatePageIndex, f.state().candidatePageCount);
  const candidate = f.state().candidates[0]; f.pad.choose(candidate.keyCap);
  assert.equal(f.pad.copyText(), candidate.candidate.value);
});
