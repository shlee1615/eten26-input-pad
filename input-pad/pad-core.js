/* Local UI adapter; the phonetic engine is the MIT-licensed McBopomofoWeb. */
(function (root) {
  "use strict";
  const settingsAPI = typeof module === "object" && module.exports ? require("./pad-settings.js") : root.PadSettings;

  class InputPad {
    constructor(Engine, editor, render, onError = () => {}, settings = {}) {
      this.editor = editor;
      this.suppressCommit = false;
      this.hasComposition = false;
      this.history = [this.snapshot()];
      this.historyIndex = 0;
      this.controller = new Engine({
        reset: () => { this.hasComposition = false; render(null); },
        update: (state) => {
          const next = JSON.parse(state);
          this.hasComposition = next.composingBuffer.some((segment) => segment.text.length > 0);
          render(next);
        },
        commitString: (text) => {
          if (this.suppressCommit) return;
          this.saveSelection();
          const start = editor.selectionStart;
          const end = editor.selectionEnd;
          editor.value = editor.value.slice(0, start) + text + editor.value.slice(end);
          editor.setSelectionRange(start + text.length, start + text.length);
          this.checkpoint();
        },
      });
      this.controller.setLanguageCode("zh-TW");
      this.settings = settingsAPI.applyControllerSettings(this.controller, settings);
      this.controller.setOnError(onError);
    }

    applySettings(settings) {
      this.finish();
      this.settings = settingsAPI.applyControllerSettings(this.controller, settings);
    }

    finish() {
      // Upstream reset commits the current preedit. Use it before copy or editing.
      this.controller.reset();
    }

    copyText() {
      this.finish();
      return this.editor.value;
    }

    clear() {
      this.finish();
      this.saveSelection();
      this.editor.value = "";
      this.editor.setSelectionRange(0, 0);
      this.checkpoint();
    }

    discardComposition() {
      this.suppressCommit = true;
      try {
        this.controller.reset();
      } finally {
        this.suppressCommit = false;
      }
    }

    snapshot() {
      return { value: this.editor.value, start: this.editor.selectionStart, end: this.editor.selectionEnd };
    }

    saveSelection() {
      if (this.history[this.historyIndex].value === this.editor.value) {
        this.history[this.historyIndex] = this.snapshot();
      }
    }

    checkpoint() {
      if (this.history[this.historyIndex].value === this.editor.value) return;
      this.history.splice(this.historyIndex + 1);
      this.history.push(this.snapshot());
      if (this.history.length > 200) this.history.shift();
      this.historyIndex = this.history.length - 1;
    }

    restore(index) {
      const snapshot = this.history[index];
      this.editor.value = snapshot.value;
      this.editor.setSelectionRange(snapshot.start, snapshot.end);
      this.historyIndex = index;
    }

    undo() {
      if (this.hasComposition) { this.discardComposition(); return; }
      this.saveSelection();
      if (this.historyIndex > 0) this.restore(this.historyIndex - 1);
    }

    redo() {
      this.discardComposition();
      if (this.historyIndex + 1 < this.history.length) this.restore(this.historyIndex + 1);
    }

    choose(keyCap) {
      // Numeric-feature caps show a modifier; the engine expects the actual
      // shifted character, while ordinary caps select within the current page.
      const shifted = keyCap.startsWith("⇧ ");
      const cap = shifted ? keyCap.slice(2) : keyCap;
      const shiftedDigits = { "1": "!", "2": "@", "3": "#", "4": "$", "5": "%", "6": "^", "7": "&", "8": "*", "9": "(", "0": ")" };
      const actual = shifted ? (shiftedDigits[cap] || cap.toUpperCase()) : cap;
      this.controller.simpleKeyboardEvent(actual, shifted, false);
    }
  }

  if (typeof module === "object" && module.exports) module.exports = { InputPad };
  else root.InputPad = InputPad;
})(globalThis);
