"use strict";

const editor = document.getElementById("editor");
const composition = document.getElementById("composition");
const choices = document.getElementById("choices");
const status = document.getElementById("status");
let english = false;
let statusTimer;
let handlingKey;

function setStatus(text, persistent = false) {
  clearTimeout(statusTimer);
  document.body.classList.toggle("delivery-feedback", persistent);
  status.textContent = text;
  if (!persistent) statusTimer = setTimeout(() => { status.textContent = "Mac 選 ABC · Windows 選英文"; }, 4500);
}

function bridge(name, value) {
  const handler = window.webkit?.messageHandlers?.[name];
  if (handler) { handler.postMessage(value); return true; }
  setStatus("請從 Mac 小工具開啟");
  return false;
}

function engineKey(key, code) {
  pad.controller.keyEvent({ key, code, shiftKey: false, ctrlKey: false });
}

function addCandidate(label, action, className = "") {
  const button = document.createElement("button");
  button.textContent = label;
  button.className = className;
  button.addEventListener("pointerdown", (event) => event.preventDefault());
  button.addEventListener("click", () => { action(); editor.focus(); });
  choices.append(button);
  return button;
}

function render(state) {
  composition.replaceChildren();
  choices.replaceChildren();
  if (!state) return;
  // The engine cursor uses UTF-16 offsets, including surrogate pairs and IVS.
  let index = 0;
  for (const segment of state.composingBuffer || []) {
    const span = document.createElement("span");
    span.className = segment.style;
    for (const char of segment.text) {
      if (index === state.cursorIndex) {
        const caret = document.createElement("span");
        caret.className = "caret";
        span.append(caret);
      }
      span.append(document.createTextNode(char));
      index += char.length;
    }
    composition.append(span);
  }
  if (index > 0 && index === state.cursorIndex) {
    const caret = document.createElement("span");
    caret.className = "caret";
    composition.append(caret);
  }
  for (const candidate of state.candidates || []) {
    const button = addCandidate("", () => pad.choose(candidate.keyCap), candidate.selected ? "selected" : "");
    const cap = document.createElement("span");
    cap.className = "cap";
    cap.textContent = candidate.keyCap;
    button.append(cap, document.createTextNode(candidate.candidate.displayedText || candidate.candidate.value));
  }
  if (state.candidates?.length > 0 && state.candidatePageCount > 1) {
    addCandidate("‹", () => engineKey("PageUp", "PageUp")).setAttribute("aria-label", "上一頁候選字");
    const page = document.createElement("span");
    page.className = "page";
    page.textContent = `${state.candidatePageIndex}/${state.candidatePageCount}`;
    choices.append(page);
    addCandidate("›", () => engineKey("PageDown", "PageDown")).setAttribute("aria-label", "下一頁候選字");
  }
  if (state.tooltip) setStatus(state.tooltip);
}

const pad = new InputPad(mcbopomofo.InputController, editor, render, () => {
  const unfinishedReading = handlingKey === "Enter" && /[ㄅ-ㄩˊˇˋ˙]/u.test(composition.textContent);
  if (pad.settings.beep_on_error) bridge("beep", true);
  const hint = /[ˊˇˋ˙]/u.test(composition.textContent)
    ? "注音尚未完整，請補齊音節或用退格鍵修正"
    : "注音尚未完成聲調：一聲按空白，再按 Enter 確定";
  // Optional host feedback must not replace the actionable input error.
  setStatus(unfinishedReading ? hint : "這個按鍵目前無法使用");
}, window.initialPadSettings);

function installPhraseCallbacks() {
  for (const [method, key] of [["setOnPhraseChange", "user_phrases"], ["setOnExcludedPhraseChange", "excluded_phrases"]]) {
    pad.controller[method]((map) => {
      pad.settings[key] = PadSettings.serializePhraseMap(map);
      bridge("saveSettings", { value: pad.settings, closeAfter: false });
    });
  }
}

function updateAppearance() {
  const s = pad.settings;
  document.getElementById("layout-name").textContent = PadSettings.LAYOUTS[s.layout];
  document.getElementById("script-name").textContent = s.chinese_conversion ? "簡體" : "繁體";
  editor.placeholder = `在這裡用${PadSettings.LAYOUTS[s.layout]}打字…`;
  editor.setAttribute("aria-label", `${PadSettings.LAYOUTS[s.layout]}文字輸入區`);
  document.body.classList.toggle("bpmf", s.bopomofo_font_annotation_support_enabled);
  const family = s.bopomofo_font_annotation_support_enabled ? `"${s.bpmf_font}", -apple-system, sans-serif` : "";
  for (const element of [editor, composition, choices]) element.style.fontFamily = family;
  if (s.bopomofo_font_annotation_support_enabled) {
    document.fonts.load(`24px "${s.bpmf_font}"`).catch(() => setStatus("注音字型無法載入，請重新開啟工具"));
  }
}

installPhraseCallbacks();
updateAppearance();

function copyAll() {
  const text = pad.copyText();
  if (!text) { setStatus("先輸入文字，再複製"); return; }
  bridge("copy", text);
  editor.focus();
}

const returnUI = ReturnUI.create(document, {
  send() {
    const text = pad.copyText();
    if (!text) { setStatus("先輸入文字，再送回"); return false; }
    return bridge("deliver", text);
  },
  selectMode: (value) => bridge("deliveryMode", value),
  authorize: () => bridge("requestAccessibility", true),
  focusEditor: () => editor.focus(),
  notify: (message) => setStatus(message, true),
});
returnUI.load(window.initialDeliveryState);

window.padHost = {
  copyAll,
  sendBack: () => returnUI.submit(),
  loadDelivery: (value) => returnUI.load(value),
  deliveryResult: (message) => setStatus(message, true),
  copied: () => setStatus("已複製 · 切到目標欄位貼上"),
  setPinned: (flag) => document.getElementById("pin").setAttribute("aria-pressed", String(flag)),
  finish: () => pad.finish(),
  undo: () => { pad.undo(); editor.focus(); },
  redo: () => { pad.redo(); editor.focus(); },
  applySettings(value) {
    pad.applySettings(value);
    installPhraseCallbacks();
    updateAppearance();
    setStatus("輸入設定已套用");
  },
  settingsSaved: () => setStatus("詞庫已儲存"),
  settingsError: () => setStatus("詞庫無法儲存，請在設定視窗重試"),
};

for (const id of ["copy", "clear", "mode", "pin", "settings"]) {
  document.getElementById(id).addEventListener("pointerdown", (event) => event.preventDefault());
}
document.getElementById("copy").addEventListener("click", copyAll);
document.getElementById("settings").addEventListener("click", () => { pad.finish(); bridge("settings", true); });
document.getElementById("clear").addEventListener("click", () => { pad.clear(); editor.focus(); setStatus("已清空"); });
document.getElementById("mode").addEventListener("click", () => {
  pad.finish();
  english = !english;
  document.getElementById("mode").textContent = english ? "英文" : "中文";
  document.getElementById("mode").setAttribute("aria-pressed", String(english));
  editor.focus();
});
document.getElementById("pin").addEventListener("click", () => {
  bridge("pin", document.getElementById("pin").getAttribute("aria-pressed") !== "true");
});

editor.addEventListener("keydown", (event) => {
  if (event.metaKey && event.key === "Enter") {
    event.preventDefault();
    if (event.shiftKey) returnUI.submit(); else copyAll();
    return;
  }
  if (event.metaKey && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) pad.redo(); else pad.undo();
    return;
  }
  if (event.isComposing || event.keyCode === 229) {
    setStatus("請將 Mac 的系統輸入來源切成 ABC");
    return;
  }
  if (event.metaKey || event.altKey) { pad.finish(); return; }
  if (!english) {
    handlingKey = event.key;
    try {
      if (pad.controller.keyEvent(event)) event.preventDefault();
    } finally { handlingKey = undefined; }
  }
});
editor.addEventListener("pointerdown", () => pad.finish());
editor.addEventListener("paste", () => pad.finish());
editor.addEventListener("cut", () => pad.finish());
editor.addEventListener("beforeinput", () => pad.saveSelection());
editor.addEventListener("input", () => pad.checkpoint());
// Use the native menu bar and toolbar; disable the WebKit context menu's Reload.
editor.addEventListener("contextmenu", (event) => event.preventDefault());
editor.focus();
