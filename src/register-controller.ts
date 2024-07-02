import { isUpperCase } from "./common";
import {
  InsertModeChanges,
  createInsertModeChanges,
  validRegisters,
  vimGlobalState,
} from "./keymap_vim";

export interface IRegister {
  readonly linewise: boolean;
  readonly blockwise: boolean;

  setText(text: string, linewise?: boolean, blockwise?: boolean): void;
  pushText(text: string, linewise?: boolean): void;
  clear(): void;
}

/*
 * Register stores information about copy and paste registers.  Besides
 * text, a register must store whether it is linewise (i.e., when it is
 * pasted, should it insert itself into a new line, or should the text be
 * inserted at the cursor position.)
 */
export class Register implements IRegister {
  keyBuffer: string[];
  insertModeChanges: InsertModeChanges[] = [];
  searchQueries: string[] = [];
  linewise: boolean;
  blockwise: boolean;

  constructor(text?: string, linewise?: boolean, blockwise?: boolean) {
    this.keyBuffer = [text || ""];
    this.linewise = !!linewise;
    this.blockwise = !!blockwise;
  }
  setText(text: string, linewise?: boolean, blockwise?: boolean) {
    this.keyBuffer = [text || ""];
    this.linewise = !!linewise;
    this.blockwise = !!blockwise;
  }

  pushText(text: string, linewise?: boolean) {
    // if this register has ever been set to linewise, use linewise.
    if (linewise) {
      if (!this.linewise) {
        this.keyBuffer.push("\n");
      }
      this.linewise = true;
    }
    this.keyBuffer.push(text);
  }

  pushInsertModeChanges(changes: InsertModeChanges) {
    this.insertModeChanges.push(createInsertModeChanges(changes));
  }
  pushSearchQuery(query: string) {
    this.searchQueries.push(query);
  }

  clear() {
    this.keyBuffer = [];
    this.insertModeChanges = [];
    this.searchQueries = [];
    this.linewise = false;
  }

  toString() {
    return this.keyBuffer.join("");
  }
}

/**
 * Defines an external register.
 *
 * The name should be a single character that will be used to reference the register.
 * The register should support setText, pushText, clear, and toString(). See Register
 * for a reference implementation.
 */
export function defineRegister(name: string, register: IRegister) {
  const registers = vimGlobalState.registerController.registers;
  if (!name || name.length != 1) {
    throw Error("Register name must be 1 character");
  }
  if (registers[name]) {
    throw Error("Register already defined " + name);
  }
  registers[name] = register;
  validRegisters.push(name);
}

/*
 * vim registers allow you to keep many independent copy and paste buffers.
 * See http://usevim.com/2012/04/13/registers/ for an introduction.
 *
 * RegisterController keeps the state of all the registers.  An initial
 * state may be passed in.  The unnamed register '"' will always be
 * overridden.
 */
export class RegisterController {
  registers: Record<string, IRegister>;
  unnamedRegister: Register;

  constructor(registers: Record<string, Register>) {
    this.registers = registers;
    this.unnamedRegister = registers['"'] = new Register();
    registers["."] = new Register();
    registers[":"] = new Register();
    registers["/"] = new Register();
  }

  pushText(
    registerName: string,
    operator: string,
    text: string,
    linewise?: boolean,
    blockwise?: boolean
  ) {
    // The black hole register, "_, means delete/yank to nowhere.
    if (registerName === "_") return;
    if (linewise && text.charAt(text.length - 1) !== "\n") {
      text += "\n";
    }
    // Lowercase and uppercase registers refer to the same register.
    // Uppercase just means append.
    const register = this.isValidRegister(registerName)
      ? this.getRegister(registerName)
      : null;
    // if no register/an invalid register was specified, things go to the
    // default registers
    if (!register) {
      switch (operator) {
        case "yank":
          // The 0 register contains the text from the most recent yank.
          this.registers["0"] = new Register(text, linewise, blockwise);
          break;
        case "delete":
        case "change":
          if (text.indexOf("\n") == -1) {
            // Delete less than 1 line. Update the small delete register.
            this.registers["-"] = new Register(text, linewise);
          } else {
            // Shift down the contents of the numbered registers and put the
            // deleted text into register 1.
            this.shiftNumericRegisters_();
            this.registers["1"] = new Register(text, linewise);
          }
          break;
      }
      // Make sure the unnamed register is set to what just happened
      this.unnamedRegister.setText(text, linewise, blockwise);
      return;
    }

    // If we've gotten to this point, we've actually specified a register
    const append = isUpperCase(registerName);
    if (append) {
      register.pushText(text, linewise);
    } else {
      register.setText(text, linewise, blockwise);
    }
    // The unnamed register always has the same value as the last used
    // register.
    this.unnamedRegister.setText(register.toString(), linewise);
  }

  // Gets a register that is defined internally, (i.e. is an instance of
  // Register). This allows the macro and search components to access
  // non-public register apis.
  getInternalRegister(name: string): Register {
    const register = this.getRegister(name);
    if (register instanceof Register) {
      return register;
    }
    return this.unnamedRegister;
  }

  // Gets the register named @name.  If one of @name doesn't already exist,
  // create it.  If @name is invalid, return the unnamedRegister.
  getRegister(name: string) {
    if (!this.isValidRegister(name)) {
      return this.unnamedRegister;
    }
    name = name.toLowerCase();
    if (!this.registers[name]) {
      this.registers[name] = new Register();
    }
    return this.registers[name];
  }

  isValidRegister(name: string) {
    return name && validRegisters.includes(name);
  }

  private shiftNumericRegisters_() {
    for (let i = 9; i >= 2; i--) {
      this.registers[i] = this.getRegister(`${i - 1}`);
    }
  }
}
