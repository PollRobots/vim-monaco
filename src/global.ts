import { HistoryController } from "./history-controller";
import { CircularJumpList, createCircularJumpList } from "./jump-list";
import { MacroModeState } from "./macro-mode-state";
import { resetOptions } from "./options";
import { RegisterController } from "./register-controller";

interface VimGlobalState {
  // The current search query.
  searchQuery?: string;
  // Whether we are searching backwards.
  searchIsReversed: boolean;
  // Replace part of the last substituted pattern
  lastSubstituteReplacePart?: string;
  jumpList: CircularJumpList;
  macroModeState: MacroModeState;
  // Recording latest f, t, F or T motion command.
  lastCharacterSearch: {
    increment: number;
    forward: boolean;
    selectedCharacter: string;
  };
  registerController: RegisterController;
  // search history buffer
  searchHistoryController: HistoryController;
  // ex Command history buffer
  exCommandHistoryController: HistoryController;
  query?: RegExp;
  isReversed?: boolean;
}

export let vimGlobalState: VimGlobalState;
export function resetVimGlobalState() {
  vimGlobalState = {
    // The current search query.
    searchQuery: undefined,
    // Whether we are searching backwards.
    searchIsReversed: false,
    // Replace part of the last substituted pattern
    lastSubstituteReplacePart: undefined,
    jumpList: createCircularJumpList(),
    macroModeState: new MacroModeState(),
    // Recording latest f, t, F or T motion command.
    lastCharacterSearch: {
      increment: 0,
      forward: true,
      selectedCharacter: "",
    },
    registerController: new RegisterController({}),
    // search history buffer
    searchHistoryController: new HistoryController(),
    // ex Command history buffer
    exCommandHistoryController: new HistoryController(),
  };
  resetOptions();
}
