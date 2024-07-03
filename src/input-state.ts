import { OperatorArgs, MotionArgs } from "./types";

// Represents the current input state.

export class InputState {
  prefixRepeat: string[] = [];
  motionRepeat: string[] = [];

  operator?: string;
  operatorArgs?: OperatorArgs;
  motion?: string;
  motionArgs?: MotionArgs;
  keyBuffer: string = ""; // For matching multi-key commands.
  registerName?: string; // Defaults to the unnamed register.
  selectedCharacter?: string;
  repeatOverride?: number;
  operatorShortcut?: string;

  pushRepeatDigit(n: string) {
    if (!this.operator) {
      this.prefixRepeat.push(n);
    } else {
      this.motionRepeat.push(n);
    }
  }

  getRepeat() {
    let repeat = 0;
    if (this.prefixRepeat.length > 0 || this.motionRepeat.length > 0) {
      repeat = 1;
      if (this.prefixRepeat.length > 0) {
        repeat *= parseInt(this.prefixRepeat.join(""), 10);
      }
      if (this.motionRepeat.length > 0) {
        repeat *= parseInt(this.motionRepeat.join(""), 10);
      }
    }
    return repeat;
  }
}
