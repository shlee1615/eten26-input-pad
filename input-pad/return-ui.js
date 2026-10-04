"use strict";
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ReturnUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function create(document, host) {
    const mode = document.getElementById("return-mode");
    const target = document.getElementById("return-target");
    const hint = document.getElementById("return-hint");
    const send = document.getElementById("return-send");
    const authorize = document.getElementById("return-authorize");
    let state = { mode: "copy_return", targetName: "", permissionGranted: false, hasCaret: false, busy: false };
    let localBusy = false;
    const normalizeMode = (value) => ["auto_paste", "enter_paste"].includes(value) ? value : "copy_return";
    const automatic = () => state.mode !== "copy_return";
    const busy = () => state.busy || localBusy;
    function render() {
      mode.value = state.mode;
      mode.disabled = busy();
      target.textContent = state.targetName ? `目的：${state.targetName}` : "先點好目標欄位";
      target.title = target.textContent;
      send.textContent = busy() ? "處理中…" : automatic() ? "複製並貼回" : "複製並返回";
      send.title = automatic() ? "自行複製並貼回原欄位（⌘ Shift Enter），不用先按複製" : "自行複製並返回原程式（⌘ Shift Enter），再手動貼上";
      if (hint) {
        if (!state.targetName) hint.textContent = "請先點目標程式的文字欄位，再打開便箋";
        else if (automatic() && !state.permissionGranted) hint.textContent = "自動貼回需要輔助使用授權；也可選「複製並返回」";
        else if (automatic() && state.hasCaret === false) hint.textContent = "尚未記住原欄位；請先點好目標欄位，再回到便箋";
        else if (state.mode === "enter_paste") hint.textContent = "Enter 確定並貼回 · 選字時先選字 · 不代按聊天送出";
        else hint.textContent = automatic()
          ? "按「複製並貼回」自動貼入；不用先按上方「複製」"
          : "按「複製並返回」切回原程式，再按 ⌘ V 貼上";
      }
      send.disabled = busy() || !state.targetName || (automatic() && !state.permissionGranted);
      authorize.hidden = !automatic() || state.permissionGranted;
      authorize.disabled = busy();
    }
    function reserve() {
      if (send.disabled) {
        const message = busy() ? "正在送回，請稍候"
          : !state.targetName ? "請先點目標程式的文字欄位，再打開便箋"
          : "自動貼回需要輔助使用授權；也可選「複製並返回」";
        host.notify?.(message);
        return false;
      }
      // Lock immediately, before an asynchronous native bridge or shortcut can repeat.
      localBusy = true;
      render();
      return true;
    }
    function release() { localBusy = false; render(); }
    function submit() {
      if (!reserve()) return false;
      if (host.send() === false) { release(); return false; }
      return true;
    }
    mode.addEventListener("change", () => {
      if (busy()) return;
      state.mode = normalizeMode(mode.value);
      render();
      host.modeChanged?.(state.mode);
      host.selectMode(state.mode);
      host.focusEditor?.();
    });
    send.addEventListener("pointerdown", (event) => event.preventDefault());
    authorize.addEventListener("pointerdown", (event) => event.preventDefault());
    send.addEventListener("click", submit);
    authorize.addEventListener("click", () => host.authorize());
    render();
    return {
      submit, reserve, release, isBusy: busy,
      getMode: () => state.mode,
      load(value = {}) {
        value = value || {};
        state = { mode: normalizeMode(value.mode), targetName: String(value.targetName || ""),
          permissionGranted: value.permissionGranted === true, hasCaret: value.hasCaret, busy: value.busy === true };
        render();
        host.modeChanged?.(state.mode);
      },
    };
  }
  return { create };
});
