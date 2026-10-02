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
    function render() {
      mode.value = state.mode;
      mode.disabled = state.busy;
      target.textContent = state.targetName ? `目的：${state.targetName}` : "先點好目標欄位";
      target.title = target.textContent;
      send.textContent = state.busy ? "處理中…" : state.mode === "auto_paste" ? "複製並貼回" : "複製並返回";
      send.title = state.mode === "auto_paste" ? "自行複製並貼回原欄位（⌘ Shift Enter），不用先按複製" : "自行複製並返回原程式（⌘ Shift Enter），再手動貼上";
      if (hint) {
        if (!state.targetName) hint.textContent = "請先點目標程式的文字欄位，再打開便箋";
        else if (state.mode === "auto_paste" && !state.permissionGranted) hint.textContent = "自動貼回需要輔助使用授權；也可選「複製並返回」";
        else if (state.mode === "auto_paste" && state.hasCaret === false) hint.textContent = "尚未記住原欄位；請先點好目標欄位，再回到便箋";
        else hint.textContent = state.mode === "auto_paste"
          ? "按「複製並貼回」自動貼入；不用先按上方「複製」"
          : "按「複製並返回」切回原程式，再按 ⌘ V 貼上";
      }
      send.disabled = state.busy || !state.targetName || (state.mode === "auto_paste" && !state.permissionGranted);
      authorize.hidden = state.mode !== "auto_paste" || state.permissionGranted;
      authorize.disabled = state.busy;
    }
    function submit() {
      if (send.disabled) {
        const message = state.busy ? "正在送回，請稍候"
          : !state.targetName ? "請先點目標程式的文字欄位，再打開便箋"
          : "自動貼回需要輔助使用授權；也可選「複製並返回」";
        host.notify?.(message);
        return;
      }
      // Lock immediately, before an asynchronous native bridge or shortcut can repeat.
      state.busy = true;
      render();
      if (host.send() === false) { state.busy = false; render(); }
    }
    mode.addEventListener("change", () => {
      if (state.busy) return;
      state.mode = mode.value === "auto_paste" ? "auto_paste" : "copy_return";
      render();
      host.selectMode(state.mode);
      host.focusEditor?.();
    });
    send.addEventListener("pointerdown", (event) => event.preventDefault());
    authorize.addEventListener("pointerdown", (event) => event.preventDefault());
    send.addEventListener("click", submit);
    authorize.addEventListener("click", () => host.authorize());
    render();
    return {
      submit,
      load(value = {}) {
        value = value || {};
        state = { mode: value.mode === "auto_paste" ? "auto_paste" : "copy_return", targetName: String(value.targetName || ""),
          permissionGranted: value.permissionGranted === true, hasCaret: value.hasCaret, busy: value.busy === true };
        render();
      },
    };
  }
  return { create };
});
