import { Marker, CmSelection } from "./adapter";
import { Pos } from "./common";
import { InputState } from "./input-state";
import { MotionFunc } from "./motions";
import { SearchState } from "./search";

export type VimOptions = Record<string, { value?: string | number | boolean }>;

export interface LastSelection {
  anchorMark: Marker;
  headMark: Marker;
  anchor: Pos;
  head: Pos;
  visualMode: boolean;
  visualLine: boolean;
  visualBlock: boolean;
}

export interface VimState {
  inputState: InputState;
  // Vim's input state that triggered the last edit, used to repeat
  // motions and operators with '.'.
  lastEditInputState?: InputState;
  // Vim's action command before the last edit, used to repeat actions
  // with '.' and insert mode repeat.
  lastEditActionCommand?: KeyMapping;
  // When using jk for navigation, if you move from a longer line to a
  // shorter line, the cursor may clip to the end of the shorter line.
  // If j is pressed again and cursor goes to the next line, the
  // cursor should go back to its horizontal position on the longer
  // line if it can. This is to keep track of the horizontal position.
  lastHPos: number;
  // Doing the same with screen-position for gj/gk
  lastHSPos: number;
  // The last motion command run. Cleared if a non-motion command gets
  // executed in between.
  lastMotion?: MotionFunc;
  marks: Record<string, Marker>;
  insertMode: boolean;
  // Repeat count for changes made in insert mode, triggered by key
  // sequences like 3,i. Only exists when insertMode is true.
  insertModeRepeat?: number;
  visualMode: boolean;
  // If we are in visual line mode. No effect if visualMode is false.
  visualLine: boolean;
  visualBlock: boolean;
  lastSelection?: LastSelection;
  lastPastedText?: string;
  sel: CmSelection;
  // Buffer-local/window-local values of vim options.
  options: VimOptions;

  searchState_?: SearchState;
  exMode?: boolean;
}

export interface MotionArgs {
  linewise?: boolean;
  toJumplist?: boolean;
  forward?: boolean;
  wordEnd?: boolean;
  bigWord?: boolean;
  inclusive?: boolean;
  explicitRepeat?: boolean;
  toFirstChar?: boolean;
  repeatOffset?: number;
  sameLine?: boolean;
  textObjectInner?: boolean;
  selectedCharacter?: string;
  repeatIsExplicit?: boolean;
  noRepeat?: boolean;
  repeat?: number;
}

export interface ActionArgs {
  after?: boolean;
  isEdit?: boolean;
  matchIndent?: boolean;
  forward?: boolean;
  linewise?: boolean;
  insertAt?: string;
  blockwise?: boolean;
  keepSpaces?: boolean;
  replace?: boolean;
  position?: "center" | "top" | "bottom";
  increase?: boolean;
  backtrack?: boolean;
  indentRight?: boolean;
  selectedCharacter?: string;
  repeat?: number;
  repeatIsExplicit?: boolean;
  registerName?: string;
  head?: Pos;
}

export interface OperatorArgs {
  indentRight?: boolean;
  toLower?: boolean;
  linewise?: boolean;
  shouldMoveCursor?: boolean;
  fullLine?: boolean;
  selectedCharacter?: string;
  lastSel?: Pick<
    LastSelection,
    "anchor" | "head" | "visualBlock" | "visualLine"
  >;
  repeat?: number;
  registerName?: string;
}

export interface SearchArgs {
  forward: boolean;
  querySrc: "prompt" | "wordUnderCursor";
  toJumplist: boolean;
  wholeWordOnly?: boolean;
  selectedCharacter?: string;
}

export interface OperatorMotionArgs {
  visualLine: boolean;
}

export interface ExArgs {
  input: string;
}

export type Context = "insert" | "normal" | "visual";

export type MappableCommandType =
  | "motion"
  | "action"
  | "operator"
  | "operatorMotion"
  | "search"
  | "ex";
export type MappableArgType =
  | MotionArgs
  | ActionArgs
  | OperatorArgs
  | OperatorMotionArgs
  | SearchArgs
  | ExArgs;

export interface KeyMapping {
  keys: string;
  type: "keyToKey" | "idle" | "keyToEx" | MappableCommandType;
  context?: Context;
  toKeys?: string;
  action?: string;
  actionArgs?: ActionArgs;
  motion?: string;
  motionArgs?: MotionArgs;
  isEdit?: boolean;
  operator?: string;
  operatorArgs?: OperatorArgs;
  operatorMotion?: string;
  operatorMotionArgs?: OperatorMotionArgs;
  interlaceInsertRepeat?: boolean;
  exitVisualBlock?: boolean;
  search?: string;
  searchArgs?: SearchArgs;
  repeatOverride?: number;
  ex?: string;
  exArgs?: ExArgs;
}

export interface ExCommand {
  name: string;
  type?: "exToEx" | "exToKey" | "api";
  shortName?: string;
  possiblyAsync?: boolean;
  excludeFromCommandHistory?: boolean;
  toKeys?: string;
  toInput?: string;
  user?: boolean;
}
