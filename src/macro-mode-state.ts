import EditorAdapter from "./adapter";
import { vimGlobalState } from "./global";
import { InsertModeChanges, createInsertModeChanges } from "./keymap_vim";

export class MacroModeState {
  latestRegister?: string = undefined;
  isPlaying = false;
  isRecording = false;
  replaySearchQueries: string[] = [];
  onRecordingDone?: () => void = undefined;
  lastInsertModeChanges: InsertModeChanges;

  constructor() {
    this.lastInsertModeChanges = createInsertModeChanges();
  }

  exitMacroRecordMode() {
    if (this.onRecordingDone) {
      this.onRecordingDone(); // close dialog
    }
    this.onRecordingDone = undefined;
    this.isRecording = false;
  }

  enterMacroRecordMode(adapter: EditorAdapter, registerName: string) {
    const register =
      vimGlobalState.registerController.getRegister(registerName);
    if (register) {
      register.clear();
      this.latestRegister = registerName;
      this.onRecordingDone = adapter.displayMessage(
        `(recording)[${registerName}]`
      );
      this.isRecording = true;
    }
  }
}
