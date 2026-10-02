"use strict";
const controls = [...document.querySelectorAll("input[name], select[name], textarea[name]")];
const status = document.getElementById("status");
let current = PadSettings.normalizeSettings(window.initialPadSettings);
const dirtyFields = new Set();

function message(text, error = false) {
  status.textContent = text;
  status.classList.toggle("error", error);
}

for (const [name, values] of [["layout", PadSettings.LAYOUTS], ["bpmf_font", PadSettings.FONTS]]) {
  const select = document.querySelector(`[name="${name}"]`);
  for (const [value, label] of Object.entries(values)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
}

function fill(settings) {
  for (const control of controls) {
    if (control.type === "checkbox") control.checked = settings[control.name];
    else control.value = String(settings[control.name]);
  }
}

function read() {
  const result = { ...current };
  for (const control of controls) {
    const fallback = PadSettings.DEFAULT_SETTINGS[control.name];
    if (control.type === "checkbox") result[control.name] = control.checked;
    else if (typeof fallback === "boolean") result[control.name] = control.value === "true";
    else if (typeof fallback === "number") result[control.name] = Number(control.value);
    else result[control.name] = control.value;
  }
  for (const name of ["user_phrases", "excluded_phrases"]) {
    result[name] = PadSettings.normalizePhraseTable(result[name], name === "user_phrases" ? "自訂詞" : "排除詞");
  }
  return PadSettings.normalizeSettings(result);
}

function save(closeAfter = false) {
  try {
    const value = read();
    window.webkit.messageHandlers.saveSettings.postMessage({ value, closeAfter });
  } catch (error) { message(error.message, true); }
}

window.settingsHost = {
  load(value) {
    const next = PadSettings.normalizeSettings(value);
    for (const control of controls) {
      if (dirtyFields.has(control.name)) continue;
      if (control.type === "checkbox") control.checked = next[control.name];
      else control.value = String(next[control.name]);
    }
    if (["user_phrases", "excluded_phrases"].some((key) => dirtyFields.has(key) && next[key] !== current[key])) {
      message("輸入中的詞庫已更新；儲存時會採用此處正在編輯的詞庫內容。", true);
    }
    current = next;
  },
  saved(value) {
    dirtyFields.clear();
    current = PadSettings.normalizeSettings(value);
    fill(current);
    message("已儲存並套用；下次開啟會繼續使用。");
  },
  error: (text) => message(text, true),
};

for (const control of controls) control.addEventListener("input", () => {
  dirtyFields.add(control.name);
  message("尚未儲存，按「儲存設定」套用。");
});
for (const button of document.querySelectorAll("[data-tab]")) button.addEventListener("click", () => {
  for (const section of document.querySelectorAll("main section")) section.hidden = section.id !== button.dataset.tab;
  for (const tab of document.querySelectorAll("[data-tab]")) tab.setAttribute("aria-pressed", String(tab === button));
});
document.getElementById("save").addEventListener("click", () => save());
document.getElementById("close").addEventListener("click", () => save(true));
document.getElementById("reset").addEventListener("click", () => {
  const fields = Object.fromEntries(controls.filter((control) => ["user_phrases", "excluded_phrases"].includes(control.name)).map((control) => [control.name, control.value]));
  fill({ ...PadSettings.DEFAULT_SETTINGS, ...fields });
  for (const control of controls) {
    if (!["user_phrases", "excluded_phrases"].includes(control.name)) dirtyFields.add(control.name);
  }
  message("已還原輸入設定，自訂及排除詞保留；請按「儲存設定」。");
});
fill(current);
if (window.settingsRecoveryNotice) message(window.settingsRecoveryNotice, true);
