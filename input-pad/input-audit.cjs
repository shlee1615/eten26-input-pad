// Audit the pinned engine and local adapter without opening apps or reading user data.
global.self ??= global;
const { InputController, BopomofoKeyboardLayout } = require('../vendor/McBopomofoWeb/output/example/bundle.js');
const { InputPad } = require('./pad-core.js');

function fixture(settings = {}, value = '') {
  const editor = { value, selectionStart: value.length, selectionEnd: value.length,
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; } };
  let state, errors = 0;
  const pad = new InputPad(InputController, editor, next => { state = next; }, () => errors++, settings);
  const event = (key, code = key, extras = {}) => pad.controller.keyEvent({ key, code, shiftKey: false, ctrlKey: false, ...extras });
  const keys = text => {
    for (const key of text) event(key, key === ' ' ? 'Space' : /^[0-9]$/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`);
  };
  return { pad, editor, event, keys, state: () => state, errors: () => errors };
}

function corpus(controller) {
  // These private fields are used only to audit this pinned 2.1.0 dictionary.
  // Production input and UI code do not depend on them.
  const model = controller.keyHandler_.languageModel_;
  const Syllable = controller.keyHandler_.reading_.syllable.constructor;
  return Object.keys(model.map_).filter(key => key.length === 2 && !key.startsWith('_'))
    .map(key => Syllable.FromAbsoluteOrderString(key))
    .filter(syllable => /^[ㄅ-ㄩˊˇˋ˙]+$/u.test(syllable.composedString)
      && model.getUnigrams(syllable.composedString).some(item => /\p{Script=Han}/u.test(item.value)));
}

function audit(layoutName, traditional = false) {
  const settings = { layout: layoutName, trad_mode: traditional };
  const probe = fixture(settings);
  const model = probe.pad.controller.keyHandler_.languageModel_;
  const layout = BopomofoKeyboardLayout[`${layoutName}Layout`];
  const failures = [], tones = {};
  for (const syllable of corpus(probe.pad.controller)) {
    const f = fixture(settings);
    const reading = syllable.composedString;
    const tone = reading.match(/[ˊˇˋ˙]$/u)?.[0] || '一聲';
    tones[tone] ??= { tested: 0, passed: 0 };
    tones[tone].tested++;
    const sequence = layout.keySequenceFromSyllable(syllable) + (syllable.hasToneMarker ? '' : ' ');
    f.keys(sequence);
    let actualReading;
    if (traditional) {
      actualReading = f.state()?.candidates?.[0]?.candidate.reading;
      if (f.state()?.candidates?.length) f.pad.choose(f.state().candidates[0].keyCap);
    } else {
      actualReading = f.pad.controller.keyHandler_.grid_.readings[0];
      f.event('Enter');
    }
    const outputOK = model.getUnigrams(reading).some(item => item.value === f.editor.value);
    const readingOK = traditional && actualReading === undefined ? outputOK : actualReading === reading;
    if (f.errors() || !readingOK || !outputOK) {
      failures.push({ reading, sequence, actualReading, output: f.editor.value, errors: f.errors() });
    } else tones[tone].passed++;
  }
  const tested = Object.values(tones).reduce((sum, item) => sum + item.tested, 0);
  return { layout: layoutName, mode: traditional ? 'manual' : 'automatic', tested, passed: tested - failures.length, tones, failures };
}

module.exports = { fixture, corpus, audit };
if (require.main === module) {
  const results = ['Standard', 'ETen26'].flatMap(layout => [audit(layout), audit(layout, true)]);
  console.log(JSON.stringify({ engine: 'McBopomofoWeb 2.1.0', scope: 'dictionary single syllables with Han candidates; canonical physical key sequences', results }, null, 2));
  process.exitCode = results.some(result => result.failures.length) ? 1 : 0;
}
