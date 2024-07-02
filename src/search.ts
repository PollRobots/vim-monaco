import EditorAdapter from "./adapter";
import { VimState, vimGlobalState } from "./keymap_vim";
import { StringStream } from "./string-stream";

export class SearchOverlay {
  query: RegExp;
  matchSol: boolean;

  constructor(query: RegExp) {
    this.query = query;
    this.matchSol = query.source.charAt(0) == "^";
  }

  token(stream: StringStream) {
    if (this.matchSol && !stream.sol()) {
      stream.skipToEnd();
      return;
    }
    const match = stream.match(this.query, false);
    if (match) {
      if (match[0].length == 0) {
        // Matched empty string, skip to next.
        stream.next();
        return "searching";
      }
      if (!stream.sol()) {
        // Backtrack 1 to match \b
        stream.backUp(1);
        if (!this.query.exec(stream.next() + match[0])) {
          stream.next();
          return null;
        }
      }
      stream.match(this.query);
      return "searching";
    }
    while (!stream.eol()) {
      stream.next();
      if (stream.match(this.query, false)) break;
    }
  }
}

export class SearchState {
  searchOverlay: SearchOverlay;
  annotate: any;

  getQuery(): RegExp | undefined {
    return vimGlobalState.query;
  }
  setQuery(query: RegExp) {
    vimGlobalState.query = query;
  }
  getOverlay() {
    return this.searchOverlay;
  }
  setOverlay(overlay: SearchOverlay) {
    this.searchOverlay = overlay;
  }
  isReversed() {
    return vimGlobalState.isReversed;
  }
  setReversed(reversed: boolean) {
    vimGlobalState.isReversed = reversed;
  }
  getScrollbarAnnotate() {
    return this.annotate;
  }
  setScrollbarAnnotate(annotate: any) {
    this.annotate = annotate;
  }
}

export const searchOverlay = (query: RegExp) => {
  return new SearchOverlay(query);
};

export const getSearchState = (adapter: EditorAdapter) => {
  const vim = adapter.state.vim as VimState;
  return vim.searchState_ || (vim.searchState_ = new SearchState());
};
