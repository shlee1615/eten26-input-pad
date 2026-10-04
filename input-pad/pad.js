"use strict";

const editor = document.getElementById("editor");
const composition = document.getElementById("composition");
const choices = document.getElementById("choices");
const status = document.getElementById("status");
let english = false;
let statusTimer;
let handlingKey;
let deliveryMode = "copy_return";
let armedDelivery = null;
let pendingDelivery = null;
let layoutFrame = null;
let lastLayout = "";
let nativeLayoutMode = null;

function updateLayout() {
  const compact = deliveryMode === "enter_paste" && !/[\r\n]/u.test(editor.value);
  document.body.classList.toggle("enter-mode", deliveryMode === "enter_paste");
  document.body.classList.toggle("compact", compact);
  editor.setAttribute("wrap", compact ? "off" : "soft");
  document.getElementById("help").textContent = deliveryMode === "enter_paste"
    ? "空白一聲 · ↓ 選字 · Enter 貼回" : "空白一聲 · ↓ 選字 · Enter 確定";
  const restore = document.getElementById("restore-sent");
  restore.hidden = deliveryMode !== "enter_paste" || !pad.lastSent;
  restore.disabled = !!editor.value || pad.hasComposition || returnUI.isBusy();
  if (!window.requestAnimationFrame || layoutFrame !== null) return;
  layoutFrame = window.requestAnimationFrame(() => {
    layoutFrame = null;
    if (deliveryMode !== "enter_paste") return;
    const bodyStyle = window.getComputedStyle(document.body);
    const children = [...document.body.children].filter((element) => element.tagName !== "SCRIPT"
      && window.getComputedStyle(element).display !== "none");
    let height = parseFloat(bodyStyle.paddingTop) + parseFloat(bodyStyle.paddingBottom)
      + Math.max(0, children.length - 1) * parseFloat(bodyStyle.rowGap);
    for (const element of children) {
      height += element === editor ? parseFloat(window.getComputedStyle(editor).minHeight)
        : element.getBoundingClientRect().height;
    }
    const payload = { mode: deliveryMode, compact, minContentHeight: Math.ceil(height) };
    const signature = JSON.stringify(payload);
    if (signature !== lastLayout) { lastLayout = signature; bridge("padLayout", payload); }
  });
}

function cancelArmed(message) {
  if (!armedDelivery) return;
  clearTimeout(armedDelivery.timer);
  armedDelivery = null;
  if (!pendingDelivery) returnUI.release();
  if (message) setStatus(message, true);
  updateLayout();
}

function deliverSnapshot(snapshot, mode) {
  if (pendingDelivery) return false;
  let operationID;
  try {
    if (window.crypto?.randomUUID) operationID = window.crypto.randomUUID();
    else {
      const bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
      const hex = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
      operationID = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    pendingDelivery = { operationID, snapshot, mode, timer: null };
    if (!bridge("deliver", { operationID, text: snapshot.text })) { pendingDelivery = null; return false; }
  } catch {
    pendingDelivery = null;
    setStatus("無法啟動貼回，文字仍保留；請複製後手動貼上。", true);
    return false;
  }
  pendingDelivery.timer = setTimeout(() => {
    if (pendingDelivery?.operationID !== operationID) return;
    setStatus("等待貼回結果確認，文字仍保留；請先查看原欄位。", true);
    // Query the original operation; never unlock an in-flight paste or resend it.
    bridge("deliveryStatus", operationID);
  }, 8000);
  return true;
}

function receiveDelivery(result) {
  // Keep old string notifications readable; only typed receipts may clear a draft.
  if (typeof result === "string") { setStatus(result, true); return; }
  if (!pendingDelivery || result?.operationID !== pendingDelivery.operationID) return;
  const sent = pendingDelivery;
  clearTimeout(sent.timer);
  pendingDelivery = null;
  let message = result.message || "送回操作已結束";
  if (result.status === "pasted" && sent.mode === "enter_paste") {
    if (pad.acknowledgeDelivery(sent.snapshot)) message = "已貼入原欄位 · 可復原上次貼回。";
    else message = "已貼入原欄位 · 新輸入仍保留在便箋。";
  }
  returnUI.release();
  setStatus(message, true);
  updateLayout();
}

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
  if (!state) { if (window.padHost) updateLayout(); return; }
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
  if (window.padHost) updateLayout();
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
  if (returnUI.isBusy()) return;
  const text = pad.copyText();
  if (!text) { setStatus("先輸入文字，再複製"); return; }
  bridge("copy", text);
  editor.focus();
  updateLayout();
}

const returnUI = ReturnUI.create(document, {
  send() {
    if (deliveryMode === "enter_paste" && pad.hasComposition) {
      setStatus("請先完成組字並按 Enter 確定，再貼回", true);
      return false;
    }
    const text = deliveryMode === "enter_paste" ? editor.value : pad.copyText();
    if (!text) { setStatus("先輸入文字，再送回"); return false; }
    return deliverSnapshot({ ...pad.deliverySnapshot(), text }, deliveryMode);
  },
  modeChanged(value) {
    if (deliveryMode !== value) { cancelArmed(); lastLayout = ""; }
    deliveryMode = value;
    updateLayout();
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
  loadDelivery(value) {
    // Re-measure after native mode acknowledgement, including a quick round trip.
    if (nativeLayoutMode !== value?.mode) { nativeLayoutMode = value?.mode; lastLayout = ""; }
    returnUI.load(value);
    if (value?.lastResult) receiveDelivery(value.lastResult);
  },
  deliveryResult: receiveDelivery,
  copied: () => setStatus("已複製 · 切到目標欄位貼上"),
  setPinned: (flag) => document.getElementById("pin").setAttribute("aria-pressed", String(flag)),
  finish: () => pad.finish(),
  undo: () => { cancelArmed(); pad.undo(); updateLayout(); editor.focus(); },
  redo: () => { cancelArmed(); pad.redo(); updateLayout(); editor.focus(); },
  applySettings(value) {
    pad.applySettings(value);
    installPhraseCallbacks();
    updateAppearance();
    updateLayout();
    setStatus("輸入設定已套用");
  },
  settingsSaved: () => setStatus("詞庫已儲存"),
  settingsError: () => setStatus("詞庫無法儲存，請在設定視窗重試"),
};

for (const id of ["copy", "clear", "mode", "pin", "settings"]) {
  document.getElementById(id).addEventListener("pointerdown", (event) => event.preventDefault());
}
document.getElementById("copy").addEventListener("click", copyAll);
document.getElementById("settings").addEventListener("click", () => { if (returnUI.isBusy()) return; pad.finish(); bridge("settings", true); });
document.getElementById("clear").addEventListener("click", () => { if (returnUI.isBusy()) return; pad.clear(); updateLayout(); editor.focus(); setStatus("已清空"); });
document.getElementById("restore-sent").addEventListener("click", () => {
  if (returnUI.isBusy()) return;
  if (pad.restoreLastSent()) { updateLayout(); editor.focus(); setStatus("已復原文字；尚未再次貼回"); }
});
document.getElementById("mode").addEventListener("click", () => {
  if (returnUI.isBusy()) return;
  pad.finish();
  english = !english;
  document.getElementById("mode").textContent = english ? "英文" : "中文";
  document.getElementById("mode").setAttribute("aria-pressed", String(english));
  editor.focus();
  updateLayout();
});
document.getElementById("pin").addEventListener("click", () => {
  bridge("pin", document.getElementById("pin").getAttribute("aria-pressed") !== "true");
});

editor.addEventListener("keydown", (event) => {
  if (armedDelivery && event.key !== "Enter") cancelArmed();
  if (event.key === "Enter" && returnUI.isBusy()) {
    event.preventDefault();
    // An in-flight paste blocks another delivery, not editing the next phrase.
    if (!armedDelivery && !event.repeat && !english && !event.metaKey && !event.altKey
      && !event.isComposing && event.keyCode !== 229) {
      handlingKey = event.key;
      try { pad.handleKey(event); } finally { handlingKey = undefined; }
      updateLayout();
    }
    return;
  }
  if (event.metaKey && event.key === "Enter") {
    event.preventDefault();
    if (event.shiftKey) returnUI.submit(); else copyAll();
    return;
  }
  if (event.metaKey && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) pad.redo(); else pad.undo();
    updateLayout();
    return;
  }
  if (event.isComposing || event.keyCode === 229) {
    if (deliveryMode === "enter_paste" && event.key === "Enter") event.preventDefault();
    setStatus("請將 Mac 的系統輸入來源切成 ABC");
    return;
  }
  if (deliveryMode === "enter_paste" && event.key === "Enter" && !event.metaKey && !event.altKey && !event.ctrlKey) {
    event.preventDefault();
    if (event.repeat) return;
    handlingKey = event.key;
    let ready;
    try {
      // Shift+Enter keeps the engine's confirm action, but never adds a newline here.
      if (event.shiftKey) { if (!english) pad.handleKey(event); ready = false; }
      else ready = pad.confirmForDelivery(event, english);
    } finally { handlingKey = undefined; }
    if (ready && returnUI.reserve()) {
      armedDelivery = { snapshot: pad.deliverySnapshot(), code: event.code, timeStamp: event.timeStamp,
        timer: setTimeout(() => cancelArmed("貼回已取消：請放開 Enter 再重按，文字仍保留。"), 5000) };
    }
    updateLayout();
    return;
  }
  if (event.metaKey || event.altKey) { pad.finish(); return; }
  if (!english) {
    handlingKey = event.key;
    try {
      if (pad.controller.keyEvent(event)) event.preventDefault();
    } finally { handlingKey = undefined; }
  }
  updateLayout();
});
document.addEventListener("keyup", (event) => {
  if (!armedDelivery || event.key !== "Enter") return;
  event.preventDefault();
  if (event.code !== armedDelivery.code || event.isComposing || document.activeElement !== editor
    || (Number.isFinite(event.timeStamp) && Number.isFinite(armedDelivery.timeStamp) && event.timeStamp < armedDelivery.timeStamp)) { cancelArmed(); return; }
  const armed = armedDelivery;
  clearTimeout(armed.timer);
  armedDelivery = null;
  if (pad.revision !== armed.snapshot.revision || editor.value !== armed.snapshot.text
    || !deliverSnapshot(armed.snapshot, deliveryMode)) {
    if (!pendingDelivery) returnUI.release();
  }
  updateLayout();
});
window.addEventListener("blur", () => cancelArmed());
document.addEventListener("visibilitychange", () => { if (document.hidden) cancelArmed(); });
document.addEventListener("pointerdown", () => cancelArmed());
editor.addEventListener("blur", () => cancelArmed());
editor.addEventListener("pointerdown", () => pad.finish());
editor.addEventListener("paste", () => pad.finish());
editor.addEventListener("cut", () => pad.finish());
editor.addEventListener("beforeinput", () => { cancelArmed(); pad.saveSelection(); });
editor.addEventListener("input", () => { pad.checkpoint(); updateLayout(); });
// Use the native menu bar and toolbar; disable the WebKit context menu's Reload.
editor.addEventListener("contextmenu", (event) => event.preventDefault());
editor.focus();
updateLayout();
if (window.ResizeObserver) {
  const observer = new window.ResizeObserver(updateLayout);
  for (const element of [document.body, composition, choices, document.getElementById("return-hint"), status]) observer.observe(element);
}
