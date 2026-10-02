(function (root) {
  "use strict";
  const LAYOUTS = {
    Standard: "標準", ETen: "倚天", Hsu: "許式", ETen26: "倚天26", HanyuPinyin: "漢語拼音",
    IBM: "IBM", Su: "蘇式", GinYieh: "精業", MITAC: "神通",
  };
  const FONTS = {
    "BpmfZihiSerif-Regular": "字嗨注音宋體",
    "BpmfZihiKaiStd-Regular": "字嗨注音楷書",
    "BpmfZihiSans-Regular": "字嗨注音黑體",
    "ToneOZ-Pinyin-Kai-Traditional": "澳聲通拼音庫楷－繁",
  };
  const DEFAULT_SETTINGS = Object.freeze({
    layout: "ETen26", trad_mode: false, chinese_conversion: false, half_width_punctuation: false,
    candidate_keys: "123456789", candidate_keys_count: 5, moving_cursor_option: 0,
    select_phrase: "before_cursor", move_cursor: false, esc_key_clear_entire_buffer: true,
    letter_mode: "upper", ctrl_enter_option: 0, allow_changing_prior_tone: false,
    repeated_punctuation_choose_candidate: false, prefer_longer_phrases: false, beep_on_error: false,
    bopomofo_font_annotation_support_enabled: false, bpmf_font: "BpmfZihiSerif-Regular",
    user_phrases: "", excluded_phrases: "",
  });

  function normalizeSettings(input) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const result = { ...DEFAULT_SETTINGS };
    for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
      if (typeof fallback === "boolean" && typeof source[key] === "boolean") result[key] = source[key];
    }
    const choices = {
      layout: Object.keys(LAYOUTS), candidate_keys: ["123456789", "asdfghjkl", "asdfzxcvb"],
      select_phrase: ["before_cursor", "after_cursor"], letter_mode: ["upper", "lower"], bpmf_font: Object.keys(FONTS),
      candidate_keys_count: [4, 5, 6, 7, 8, 9], moving_cursor_option: [0, 1, 2], ctrl_enter_option: [0, 1, 2, 3, 4, 5],
    };
    for (const [key, allowed] of Object.entries(choices)) {
      if (allowed.includes(source[key])) result[key] = source[key];
    }
    for (const key of ["user_phrases", "excluded_phrases"]) {
      if (typeof source[key] === "string" && source[key].length <= 200000) result[key] = source[key];
    }
    return result;
  }

  function normalizePhraseTable(text, label = "詞庫") {
    if (text.length > 200000) throw new Error(`${label}超過 200,000 字，請縮短後再儲存。`);
    return text.split(/\r?\n/).map((line, index) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return trimmed;
      const columns = trimmed.split(/\s+/);
      if (columns.length !== 2) throw new Error(`${label}第 ${index + 1} 行：請使用「詞語 空格 注音」，例如「你好 ㄋㄧˇ-ㄏㄠˇ」。`);
      return columns.join(" ");
    }).join("\n");
  }

  function serializePhraseMap(map) {
    const lines = [];
    for (const [reading, values] of map) for (const value of values) lines.push(`${value} ${reading}`);
    return lines.join("\n");
  }

  function applyControllerSettings(controller, settings) {
    const s = normalizeSettings(settings);
    controller.setTraditionalMode(s.trad_mode);
    controller.setChineseConversionEnabled(s.chinese_conversion);
    controller.setKeyboardLayout(s.layout);
    controller.setHalfWidthPunctuationEnabled(s.half_width_punctuation);
    controller.setCandidateKeys(s.candidate_keys);
    controller.setCandidateKeysCount(s.candidate_keys_count);
    controller.setMovingCursorOption(s.moving_cursor_option);
    controller.setSelectPhrase(s.select_phrase);
    controller.setMoveCursorAfterSelection(s.move_cursor);
    controller.setEscClearEntireBuffer(s.esc_key_clear_entire_buffer);
    controller.setLetterMode(s.letter_mode);
    controller.setCtrlEnterOption(s.ctrl_enter_option);
    controller.setAllowChangingPriorTone(s.allow_changing_prior_tone);
    controller.setRepeatedPunctuationChooseCandidate(s.repeated_punctuation_choose_candidate);
    controller.setPreferLongerPhrases(s.prefer_longer_phrases);
    controller.setBopomofoFontAnnotationSupportEnabled(s.bopomofo_font_annotation_support_enabled);
    controller.setUserPhrases(s.user_phrases);
    controller.setExcludedPhrases(s.excluded_phrases);
    return s;
  }

  const api = { LAYOUTS, FONTS, DEFAULT_SETTINGS, normalizeSettings, normalizePhraseTable, serializePhraseMap, applyControllerSettings };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PadSettings = api;
})(globalThis);
