/**
 * An adapter to make CodeMirror's vim bindings work with monaco
 */
import { IPosition, IRange, ISelection } from "monaco-editor";
import monaco from "monaco-editor";
import { StatusBarInputOptions, ModeChangeEvent } from "./statusbar";
import { ExCommandOptionalParameters } from "./keymap_vim";
import { Pos, getEventKeyName, makePos } from "./common";

const SelectionDirection = window.monaco.SelectionDirection;

export class CmSelection {
  /// Where the selection started from
  readonly anchor: Pos;
  /// Where the cursor currently is
  readonly head: Pos;

  constructor(anchor: Pos, head: Pos) {
    this.anchor = anchor;
    this.head = head;
  }

  /// Selections are directional, from is the highest point in the document.
  from(): Pos {
    if (this.anchor.line < this.head.line) {
      return this.anchor;
    } else if (this.anchor.line == this.head.line) {
      return this.anchor.ch < this.head.ch ? this.anchor : this.head;
    } else {
      return this.head;
    }
  }

  /// Indicates if the selection is empty (anchor and head are the same)
  empty(): boolean {
    return this.anchor.line == this.head.line && this.anchor.ch == this.head.ch;
  }
}

function toAdapterPos(pos: IPosition): Pos {
  return makePos(pos.lineNumber - 1, pos.column - 1);
}

function toMonacoPos(pos: Pos) {
  return makePosition(pos.line + 1, pos.ch + 1);
}

export class Marker implements Pos {
  adapter: EditorAdapter;
  id: number;
  insertRight: boolean = false;
  line: number;
  ch: number;

  constructor(adapter: EditorAdapter, id: number, line: number, ch: number) {
    this.line = line;
    this.ch = ch;
    this.adapter = adapter;
    this.id = id;
    adapter.marks.set(this.id, this);
  }

  clear() {
    this.adapter.marks.delete(this.id);
  }

  find(): Pos {
    return makePos(this.line, this.ch);
  }
}

export type BindingFunction = (
  adapter: EditorAdapter,
  next?: KeyMapEntry
) => void;
type CallFunction = (key: any, adapter: EditorAdapter) => any;
type Binding = string | BindingFunction | string[];

export interface KeyMapEntry {
  keys?: Record<string, string>;
  find?: (key: string) => boolean;
  fallthrough?: string | string[];
  attach?: BindingFunction;
  detach?: BindingFunction;
  call?: CallFunction;
}

export interface Change {
  text: string[];
  origin: "+input" | "paste";
  next?: Change;
}

interface Operation {
  lastChange?: Change;
  change?: Change;
  selectionChanged?: boolean;
  isVimOp?: boolean;
}

interface MatchingBracket {
  symbol: string;
  mode: "open" | "close";
  regex: RegExp;
}

const kMatchingBrackets: Record<string, MatchingBracket> = {
  "(": { symbol: ")", mode: "close", regex: /[()]/ },
  ")": { symbol: "(", mode: "open", regex: /[()]/ },
  "[": { symbol: "]", mode: "close", regex: /[[\]]/ },
  "]": { symbol: "[", mode: "open", regex: /[[\]]/ },
  "{": { symbol: "}", mode: "close", regex: /[{}]/ },
  "}": { symbol: "{", mode: "open", regex: /[{}]/ },
  "<": { symbol: ">", mode: "close", regex: /[<>]/ },
  ">": { symbol: "<", mode: "open", regex: /[<>]/ },
};

export default class EditorAdapter {
  static keyMap: Record<string, KeyMapEntry> = {
    default: { find: () => true },
  };
  static commands: Record<
    string,
    (adapter: EditorAdapter, params: ExCommandOptionalParameters) => void
  > = {
    redo: function (adapter: EditorAdapter) {
      adapter.triggerEditorAction("redo");
    },
    undo: function (adapter: EditorAdapter) {
      adapter.triggerEditorAction("undo");
    },
    newlineAndIndent: function (adapter: EditorAdapter) {
      adapter.triggerEditorAction("editor.action.insertLineAfter");
    },
  };

  static lookupKey(
    key: string,
    map: string | KeyMapEntry,
    handle?: (binding: Binding) => boolean
  ): "nothing" | "multi" | "handled" | undefined {
    if (typeof map === "string") {
      map = EditorAdapter.keyMap[map];
    }

    const found = map.find
      ? map.find(key)
      : map.keys
      ? map.keys[key]
      : undefined;

    if (found === false) return "nothing";
    if (found === "...") return "multi";
    if (
      found !== null &&
      found !== undefined &&
      handle &&
      handle(found as string)
    )
      return "handled";

    if (map.fallthrough) {
      if (!Array.isArray(map.fallthrough))
        return EditorAdapter.lookupKey(key, map.fallthrough, handle);
      for (let i = 0; i < map.fallthrough.length; i++) {
        const result = EditorAdapter.lookupKey(key, map.fallthrough[i], handle);
        if (result) return result;
      }
    }
  }

  editor: monaco.editor.IStandaloneCodeEditor;
  state: Record<string, any> = { keyMap: "vim" };
  marks: Map<number, Marker> = new Map();
  uid: number = 0;
  disposables: monaco.IDisposable[] = [];
  listeners: Record<string, ((...args: any) => void)[]> = {};
  curOp: Operation = {};
  attached: boolean = false;
  options: any = {};
  ctxInsert: monaco.editor.IContextKey<boolean>;
  replaceMode: boolean = false;
  replaceStack: string[] = [];
  initialCursorWidth: number = 0;
  decorations: Map<string, monaco.editor.IEditorDecorationsCollection> =
    new Map();
  theme?: string;

  constructor(editor: monaco.editor.IStandaloneCodeEditor) {
    this.editor = editor;
    this.addLocalListeners();
    this.ctxInsert = this.editor.createContextKey("insertMode", true);
  }

  attach() {
    const vim = EditorAdapter.keyMap["vim"];
    if (vim && vim.attach) {
      vim.attach(this);
    }
  }

  detach() {
    const vim = EditorAdapter.keyMap["vim"];
    if (vim && vim.detach) {
      vim.detach(this);
    }
  }

  addLocalListeners() {
    this.disposables.push(
      this.editor.onDidChangeCursorPosition((e) => this.handleCursorChange(e)),
      this.editor.onDidChangeModelContent((e) => this.handleChange(e)),
      this.editor.onKeyDown((e) => this.handleKeyDown(e))
    );
  }

  handleKeyDown(e: monaco.IKeyboardEvent) {
    const KeyCode = window.monaco.KeyCode;
    // Allow previously registered keydown listeners to handle the event and
    // prevent this extension from also handling it.
    if (e.browserEvent.defaultPrevented && e.keyCode !== KeyCode.Escape) {
      return;
    }

    if (!this.attached) {
      return;
    }

    const key = getEventKeyName(e);

    if (this.replaceMode) {
      this.handleReplaceMode(key, e);
    }

    if (!key) {
      return;
    }

    const keymap = this.state.keyMap as string;
    if (EditorAdapter.keyMap[keymap] && EditorAdapter.keyMap[keymap].call) {
      const cmd = EditorAdapter.keyMap[keymap]!.call!(key, this);
      if (cmd) {
        e.preventDefault();
        e.stopPropagation();

        try {
          cmd();
        } catch (err) {
          console.error(err);
        }
      }
    }
  }

  handleReplaceMode(key: string, e: monaco.IKeyboardEvent) {
    let fromReplace = false;
    let char = key;
    const pos = this.getPos_();
    let range = makeRange(
      pos.lineNumber,
      pos.column,
      pos.lineNumber,
      pos.column + 1
    );
    let forceMoveMarkers = true;

    if (key.startsWith("'")) {
      char = key[1];
    } else if (char === "Enter") {
      char = "\n";
    } else if (char === "Backspace") {
      const lastItem = this.replaceStack.pop();

      if (!lastItem) {
        return;
      }

      fromReplace = true;
      char = lastItem;
      range = makeRange(
        pos.lineNumber,
        pos.column,
        pos.lineNumber,
        pos.column - 1
      );
    } else {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    if (!this.replaceStack) {
      this.replaceStack = [];
    }

    if (!fromReplace) {
      this.replaceStack.push(this.getModel_().getValueInRange(range));
    }

    this.editor.executeEdits("vim", [
      {
        text: char,
        range,
        forceMoveMarkers,
      },
    ]);

    if (fromReplace) {
      this.editor.setPosition(liftRange(range).getStartPosition());
    }
  }

  handleCursorChange(e: monaco.editor.ICursorPositionChangedEvent) {
    const selection = this.getSelection_();

    if (!this.ctxInsert.get() && e.source === "mouse" && selection.isEmpty()) {
      const maxCol = this.getModel_().getLineMaxColumn(e.position.lineNumber);

      if (e.position.column === maxCol) {
        this.editor.setPosition(
          makePosition(e.position.lineNumber, maxCol - 1)
        );
        return;
      }
    }

    this.dispatch("cursorActivity", this, e);
  }

  handleChange(e: monaco.editor.IModelContentChangedEvent) {
    const change: Change = {
      text: e.changes.map((change) => change.text),
      origin: "+input",
    };
    const curOp = (this.curOp = this.curOp || {});

    if (!curOp.lastChange) {
      curOp.lastChange = curOp.change = change;
    } else {
      curOp.lastChange.next = curOp.lastChange = change;
    }

    this.dispatch("change", this, change);
  }

  setOption(key: string, value: string | number | boolean) {
    this.state[key] = value;

    switch (key) {
      case "theme": {
        this.theme = value as string;
        this.editor.updateOptions({
          theme: this.theme,
        });
      }
      case "indentWithTabs": {
        const model = this.editor.getModel()!;
        model.updateOptions({ insertSpaces: !value });
        break;
      }
      case "tabSize": {
        const tabSize = typeof value === "number" ? value : Number(value);
        if (isNaN(tabSize)) {
          return;
        }
        const model = this.editor.getModel()!;
        model.updateOptions({ tabSize: tabSize });
        break;
      }
    }
  }

  getConfiguration() {
    const opts = window.monaco.editor.EditorOption;

    return {
      readOnly: this.editor.getOption(opts.readOnly) as boolean,
      viewInfo: {
        cursorWidth: this.editor.getOption(opts.cursorWidth) as number,
      },
      fontInfo: this.editor.getOption(opts.fontInfo) as monaco.editor.FontInfo,
    };
  }

  getOption(key: string): any {
    switch (key) {
      case "readOnly":
        return this.getConfiguration().readOnly;
      case "firstLineNumber":
        return this.firstLine() + 1;
      case "indentWithTabs": {
        const model = this.editor.getModel()!;
        return !model.getOptions().insertSpaces;
      }
      case "tabSize": {
        const model = this.editor.getModel()!;
        return model.getOptions().tabSize;
      }
      case "theme":
        if (this.theme) {
          return this.theme;
        }
      default:
        return (this.editor.getRawOptions() as Record<string, any>)[key];
    }
  }

  dispatch(
    signal: "status-prompt",
    prefix: string,
    desc: string,
    options: StatusBarInputOptions,
    id: string
  ): void;
  dispatch(signal: "status-close-prompt", id: string): void;
  dispatch(signal: "status-display", message: string, id: string): void;
  dispatch(signal: "status-close-display", id: string): void;
  dispatch(signal: "status-notify", message: string): void;
  dispatch(signal: "change", adapter: EditorAdapter, change: Change): void;
  dispatch(
    signal: "cursorActivity",
    adapter: EditorAdapter,
    e: monaco.editor.ICursorPositionChangedEvent
  ): void;
  dispatch(signal: "dispose"): void;
  dispatch(signal: "vim-command-done", reason?: string): void;
  dispatch(signal: "vim-set-clipboard-register"): void;
  dispatch(signal: "vim-mode-change", mode: ModeChangeEvent): void;
  dispatch(signal: "vim-keypress", key: string): void;
  dispatch(signal: string, ...args: any[]): void {
    const listeners = this.listeners[signal];
    if (!listeners) {
      return;
    }

    listeners.forEach((handler) => handler(...args));
  }

  on(
    event: "status-prompt",
    handler: (
      prefix: string,
      desc: string,
      options: StatusBarInputOptions,
      id: string
    ) => void
  ): void;
  on(event: "status-close-prompt", handler: (id: string) => void): void;
  on(
    event: "status-display",
    handler: (message: string, id: string) => void
  ): void;
  on(event: "status-close-display", handler: (id: string) => void): void;
  on(
    event: "status-display" | "status-notify",
    handler: (message: string) => void
  ): void;
  on(event: "cursorActivity", handler: (adapter: EditorAdapter) => void): void;
  on(
    event: "change",
    handler: (adapter: EditorAdapter, change: Change) => void
  ): void;
  on(event: "dispose", handler: () => void): void;
  on(event: "vim-command-done", handler: (reason?: string) => void): void;
  on(event: "vim-set-clipboard-register", handler: () => void): void;
  on(event: "vim-mode-change", handler: (mode: ModeChangeEvent) => void): void;
  on(event: "vim-keypress", handler: (key: string) => void): void;
  on(event: string, handler: (...args: any) => void): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }

    this.listeners[event].push(handler);
  }

  off(event: string, handler: (...args: any) => void) {
    const listeners = this.listeners[event];
    if (!listeners) {
      return;
    }

    this.listeners[event] = listeners.filter((l) => l !== handler);
  }

  firstLine() {
    return 0;
  }

  lastLine() {
    return this.lineCount() - 1;
  }

  lineCount() {
    return this.getModel_().getLineCount();
  }

  defaultTextHeight() {
    return 1;
  }

  getLine(line: number) {
    if (line < 0) {
      return "";
    }
    const model = this.getModel_();
    const maxLines = model.getLineCount();

    if (line + 1 > maxLines) {
      line = maxLines - 1;
    }

    return this.getModel_().getLineContent(line + 1);
  }

  getAnchorForSelection(sel: ISelection) {
    const selection = liftSelection(sel);
    if (selection.isEmpty()) {
      return selection.getPosition();
    }

    return selection.getDirection() === SelectionDirection.LTR
      ? selection.getStartPosition()
      : selection.getEndPosition();
  }

  getHeadForSelection(sel: ISelection) {
    const selection = liftSelection(sel);
    if (selection.isEmpty()) {
      return selection.getPosition();
    }

    return selection.getDirection() === SelectionDirection.LTR
      ? selection.getEndPosition()
      : selection.getStartPosition();
  }

  getCursor(type: string | null = null) {
    if (!type) {
      return toAdapterPos(this.getPos_());
    }

    const sel = this.getSelection_();
    let pos;

    if (sel.isEmpty()) {
      pos = sel.getPosition();
    } else if (type === "anchor") {
      pos = this.getAnchorForSelection(sel);
    } else {
      pos = this.getHeadForSelection(sel);
    }

    return toAdapterPos(pos);
  }

  getRange(start: Pos, end: Pos) {
    const p1 = toMonacoPos(start);
    const p2 = toMonacoPos(end);

    return this.getModel_().getValueInRange(makeRange(p1, p2));
  }

  getSelection() {
    return this.getSelections_()
      .map((sel) => this.getModel_().getValueInRange(sel))
      .join("\n");
  }

  replaceRange(text: string, start: Pos, end?: Pos) {
    const p1 = toMonacoPos(start);
    const p2 = !end ? p1 : toMonacoPos(end);

    this.editor.executeEdits("vim", [
      {
        text,
        range: makeRange(p1, p2),
      },
    ]);
    // @TODO - Check if this breaks any other expectation
    this.pushUndoStop();
  }

  pushUndoStop() {
    this.editor.pushUndoStop();
  }

  setCursor(line: Pos, ch?: number): void;
  setCursor(line: number, ch: number): void;
  setCursor(line: number | Pos, ch: number) {
    const pos = typeof line === "number" ? makePos(line, ch) : line;

    const monacoPos = this.getModel_().validatePosition(toMonacoPos(pos));
    this.editor.setPosition(toMonacoPos(pos));
    this.editor.revealPosition(monacoPos);
  }

  somethingSelected() {
    return !this.getSelection_().isEmpty();
  }

  listSelections(): CmSelection[] {
    const selections = this.getSelections_();

    if (!selections.length) {
      return [
        new CmSelection(this.getCursor("anchor"), this.getCursor("head")),
      ];
    }

    return selections.map(
      (sel) =>
        new CmSelection(
          this.clipPos(toAdapterPos(this.getAnchorForSelection(sel))),
          this.clipPos(toAdapterPos(this.getHeadForSelection(sel)))
        )
    );
  }

  focus() {
    this.editor.focus();
  }

  setSelections(selections: CmSelection[], primIndex?: number) {
    const hasSel = !!this.getSelections_().length;
    const sels = selections.map((sel, index) => {
      const { anchor, head } = sel;

      if (hasSel) {
        return makeSelection(toMonacoPos(anchor), toMonacoPos(head));
      } else {
        return makeSelection(toMonacoPos(head), toMonacoPos(anchor));
      }
    });

    if (!primIndex) {
    } else if (sels[primIndex]) {
      sels.push(sels.splice(primIndex, 1)[0]);
    }

    if (!sels.length) {
      return;
    }

    const sel = liftSelection(sels[0]);
    let posToReveal;

    if (sel.getDirection() === SelectionDirection.LTR) {
      posToReveal = sel.getEndPosition();
    } else {
      posToReveal = sel.getStartPosition();
    }

    this.editor.setSelections(sels);
    this.editor.revealPosition(posToReveal);
  }

  setSelection(frm: Pos, to: Pos) {
    const range = makeRange(toMonacoPos(frm), toMonacoPos(to));
    this.editor.setSelection(range);
  }

  getSelections() {
    return this.getSelections_().map((sel) =>
      this.getModel_().getValueInRange(sel)
    );
  }

  replaceSelections(texts: string[]) {
    this.getSelections_().forEach((sel, index) => {
      this.editor.executeEdits("vim", [
        {
          range: sel,
          text: texts[index],
          forceMoveMarkers: false,
        },
      ]);
    });
  }

  toggleOverwrite(toggle: boolean) {
    if (toggle) {
      this.enterVimMode();
      this.replaceMode = true;
    } else {
      this.leaveVimMode();
      this.replaceMode = false;
      this.replaceStack = [];
    }
  }

  charCoords(pos: Pos, mode: string) {
    return {
      top: pos.line,
      left: pos.ch,
    };
  }

  coordsChar(pos: Pos, mode: string) {
    if (mode === "local") {
    }
  }

  clipPos(p: Pos) {
    const pos = this.getModel_().validatePosition(toMonacoPos(p));
    return toAdapterPos(pos);
  }

  setBookmark(cursor: Pos, options?: { insertLeft?: boolean }) {
    const bm = new Marker(this, this.uid++, cursor.line, cursor.ch);

    if (!options || !options.insertLeft) {
      bm.insertRight = true;
    }

    return bm;
  }

  getScrollInfo() {
    const [range] = this.editor.getVisibleRanges();

    return {
      left: 0,
      top: range.startLineNumber - 1,
      height: this.getModel_().getLineCount(),
      clientHeight: range.endLineNumber - range.startLineNumber + 1,
    };
  }

  triggerEditorAction(action: string) {
    this.editor.trigger("vim", action, {});
  }

  dispose() {
    this.dispatch("dispose");
    this.removeOverlay();

    this.detach();

    this.disposables.forEach((d) => d.dispose());
  }

  enterVimMode(toVim = true) {
    this.ctxInsert.set(false);
    const config = this.getConfiguration();
    this.initialCursorWidth = config.viewInfo.cursorWidth || 0;

    this.editor.updateOptions({
      cursorWidth: config.fontInfo.typicalFullwidthCharacterWidth,
      cursorBlinking: "solid",
    });
  }

  leaveVimMode() {
    this.ctxInsert.set(true);

    this.editor.updateOptions({
      cursorWidth: this.initialCursorWidth || 0,
      cursorBlinking: "blink",
    });
  }

  getUserVisibleLines() {
    const ranges = this.editor.getVisibleRanges();
    if (!ranges.length) {
      return {
        top: 0,
        bottom: 0,
      };
    }

    const res = {
      top: Infinity,
      bottom: 0,
    };

    ranges.reduce((acc, range) => {
      if (range.startLineNumber < acc.top) {
        acc.top = range.startLineNumber;
      }

      if (range.endLineNumber > acc.bottom) {
        acc.bottom = range.endLineNumber;
      }

      return acc;
    }, res);

    res.top -= 1;
    res.bottom -= 1;

    return res;
  }

  findPosV(startPos: Pos, amount: number, unit: "line" | "page") {
    const pos = toMonacoPos(startPos);

    switch (unit) {
      case "page":
        const editorHeight = this.editor.getLayoutInfo().height;
        const lineHeight = this.getConfiguration().fontInfo.lineHeight;
        const finalAmount = amount * Math.floor(editorHeight / lineHeight);
        return toAdapterPos(liftPosition(pos).delta(finalAmount));
      case "line":
        return toAdapterPos(liftPosition(pos).delta(amount));
      default:
        return startPos;
    }
  }

  findMatchingBracket(cur: Pos) {
    const line = this.getLine(cur.line);
    for (let ch = cur.ch; ch < line.length; ch++) {
      const curCh = line.charAt(ch);
      const matchable = kMatchingBrackets[curCh];
      if (matchable) {
        // current character is a bracket, simply
        // step 1 forwards (if open)
        // scan for brackets
        const offset = matchable.mode === "close" ? 1 : 0;
        return this.scanForBracket(
          makePos(cur.line, ch + offset),
          offset,
          matchable.regex
        );
      }
    }
  }

  findFirstNonWhiteSpaceCharacter(line: number) {
    return this.getModel_().getLineFirstNonWhitespaceColumn(line + 1) - 1;
  }

  scrollTo(x?: number, y?: number) {
    if (!x && !y) {
      return;
    }
    if (!x) {
      if (y! < 0) {
        y = this.getPos_().lineNumber - y!;
      }
      this.editor.setScrollTop(this.editor.getTopForLineNumber(y! + 1));
    }
  }

  moveCurrentLineTo(viewPosition: "top" | "center" | "bottom") {
    const pos = this.getPos_();
    const range = makeRange(pos, pos);

    switch (viewPosition) {
      case "top":
        this.editor.revealRangeAtTop(range);
        break;
      case "center":
        this.editor.revealRangeInCenter(range);
        break;
      case "bottom":
        // private api. no other way
        if (Reflect.has(this.editor, "_revealRange")) {
          const ScrollType = window.monaco.editor.ScrollType;
          const revealRange = (this.editor as any)._revealRange as (
            range: IRange,
            verticalType: number, // enum VerticalRevealType,
            revealHorizontal: boolean,
            scrollType: monaco.editor.ScrollType
          ) => void;
          if (revealRange) {
            revealRange(
              range,
              4, // enum VerticalRevealType.Bottom(4),
              true,
              ScrollType.Smooth
            );
          }
        }
        break;
    }
  }

  getSearchCursor(pattern: string | RegExp, pos: Pos) {
    let matchCase = false;
    let isRegex = false;

    if (pattern instanceof RegExp) {
      matchCase = !pattern.ignoreCase;
      isRegex = true;
    }

    const query = typeof pattern === "string" ? pattern : pattern.source;

    if (pos.ch == undefined) pos.ch = Number.MAX_VALUE;

    const monacoPos = toMonacoPos(pos);
    const context = this;
    let lastSearch: IRange;
    const model = this.getModel_();
    const matches =
      model.findMatches(query, false, isRegex, matchCase, null, false) || [];

    const capturedEditor = this.editor;
    return {
      getMatches() {
        return matches;
      },
      findNext() {
        return this.find(false);
      },
      findPrevious() {
        return this.find(true);
      },
      jumpTo(index: number) {
        if (!matches || !matches.length) {
          return false;
        }
        const match = matches[index];
        lastSearch = match.range;
        context.highlightRanges([lastSearch], "currentFindMatch");
        context.highlightRanges(
          matches.map((m) => m.range).filter((r) => !r.equalsRange(lastSearch))
        );

        return lastSearch;
      },
      find(back: boolean) {
        if (!matches || !matches.length) {
          return false;
        }

        let match;

        if (back) {
          const pos = lastSearch
            ? liftRange(lastSearch).getStartPosition()
            : monacoPos;
          match = model.findPreviousMatch(
            query,
            pos,
            isRegex,
            matchCase,
            null,
            false
          );

          if (!match || !match.range.getStartPosition().isBeforeOrEqual(pos)) {
            return false;
          }
        } else {
          const pos = lastSearch
            ? model.getPositionAt(
                model.getOffsetAt(liftRange(lastSearch).getEndPosition()) + 1
              )
            : monacoPos;
          match = model.findNextMatch(
            query,
            pos,
            isRegex,
            matchCase,
            null,
            false
          );
          if (
            !match ||
            !liftPosition(pos).isBeforeOrEqual(match.range.getStartPosition())
          ) {
            return false;
          }
        }

        lastSearch = match.range;
        context.highlightRanges([lastSearch], "currentFindMatch");
        context.highlightRanges(
          matches.map((m) => m.range).filter((r) => !r.equalsRange(lastSearch))
        );

        return lastSearch;
      },
      from() {
        return (
          lastSearch && toAdapterPos(liftRange(lastSearch).getStartPosition())
        );
      },
      to() {
        return (
          lastSearch && toAdapterPos(liftRange(lastSearch).getEndPosition())
        );
      },
      replace(text: string) {
        if (lastSearch) {
          capturedEditor.executeEdits(
            "vim",
            [
              {
                range: lastSearch,
                text,
                forceMoveMarkers: true,
              },
            ],
            (edits: monaco.editor.IValidEditOperation[]) => {
              const { endLineNumber, endColumn } = edits[0].range;
              lastSearch = liftRange(lastSearch).setEndPosition(
                endLineNumber,
                endColumn
              );
              return null;
            }
          );
          capturedEditor.setPosition(liftRange(lastSearch).getStartPosition());
        }
      },
    };
  }

  highlightRanges(ranges: IRange[], className: string = "findMatch") {
    const decorations = ranges.map((range) => ({
      range: range,
      options: {
        stickiness:
          window.monaco.editor.TrackedRangeStickiness
            .NeverGrowsWhenTypingAtEdges,
        zIndex: 13,
        className,
        showIfCollapsed: true,
      },
    }));
    const previous = this.decorations.get(className);
    if (previous) {
      previous.append(decorations);
    } else {
      const collection = this.editor.createDecorationsCollection(decorations);
      this.decorations.set(className, collection);
    }
  }

  addOverlay(query: string | RegExp) {
    let matchCase = false;
    let isRegex = false;

    if (query && query instanceof RegExp) {
      isRegex = true;
      matchCase = !query.ignoreCase;
      query = query.source;
    }

    const match = this.getModel_().findNextMatch(
      query as string,
      this.getPos_(),
      isRegex,
      matchCase,
      null,
      false
    );

    if (!match || !match.range) {
      return;
    }

    this.highlightRanges([match.range]);
  }

  removeOverlay() {
    ["currentFindMatch", "findMatch"].forEach((key) => {
      const collection = this.decorations.get(key);
      if (collection) {
        collection.clear();
      }
    });
  }

  scrollIntoView(pos?: Pos, ingored?: number) {
    if (!pos) {
      return;
    }
    this.editor.revealPosition(toMonacoPos(pos));
  }

  moveH(amount: number, units: "char") {
    if (units !== "char") {
      return;
    }
    const pos = this.getPos_();
    this.editor.setPosition(pos.delta(0, amount));
  }

  scanForBracket(pos: Pos, dir: number, bracketRegex: RegExp) {
    let searchPos = toMonacoPos(pos);
    const model = this.getModel_();

    const query = bracketRegex.source;

    const searchFunc =
      dir <= 0
        ? (start: IPosition) =>
            model.findPreviousMatch(query, start, true, true, null, true)
        : (start: IPosition) =>
            model.findNextMatch(query, start, true, true, null, true);
    let depth = 0;
    let iterations = 0;

    while (true) {
      if (iterations > 100) {
        // Searched too far, give up.
        return undefined;
      }

      const match = searchFunc(searchPos);
      if (!match) {
        return undefined;
      }

      const thisBracket = match.matches![0];

      const matchingBracket = kMatchingBrackets[thisBracket];

      if (matchingBracket && (matchingBracket.mode === "close") == dir > 0) {
        depth++;
      } else if (depth === 0) {
        const res = match.range.getStartPosition();

        return {
          pos: toAdapterPos(res),
        };
      } else {
        depth--;
      }

      searchPos =
        dir > 0
          ? model.getPositionAt(
              model.getOffsetAt(match.range.getStartPosition()) + 1
            )
          : match.range.getStartPosition();

      iterations += 1;
    }
  }

  indexFromPos(pos: Pos) {
    return this.getModel_().getOffsetAt(toMonacoPos(pos));
  }

  posFromIndex(offset: number) {
    return toAdapterPos(this.getModel_().getPositionAt(offset));
  }

  indentLine(line: number, indentRight: boolean = true) {
    const useTabs = !!this.getOption("indentWithTabs");
    const tabWidth = Number(this.getOption("tabSize"));
    const spaces = "".padEnd(tabWidth, " ");

    if (indentRight) {
      const indent = useTabs ? "\t" : spaces;

      this.editor.executeEdits("vim", [
        {
          range: makeRange(line + 1, 1, line + 1, 1),
          text: indent,
        },
      ]);
    } else {
      const model = this.getModel_();

      const range = makeRange(line + 1, 1, line + 1, tabWidth);
      const begin = model.getValueInRange(range);

      const edit: monaco.editor.IIdentifiedSingleEditOperation = {
        range: range,
        text: null,
      };

      if (!begin || begin === "") {
        return;
      } else if (useTabs) {
        if (begin[0] == "\t") {
          edit.range = makeRange(line + 1, 1, line + 1, 1);
        } else if (begin == spaces) {
          // don't edit range.
        } else {
          edit.range = makeRange(
            line + 1,
            1,
            line + 1,
            Array.from(begin).findIndex((ch) => ch != " ")
          );
        }
      } else if (begin !== spaces) {
        edit.range = makeRange(
          line + 1,
          1,
          line + 1,
          Array.from(begin).findIndex((ch) => ch != " ")
        );
      }

      this.editor.executeEdits("vim", [edit]);
    }
  }

  displayMessage(message: string): () => void {
    const id = window.crypto.randomUUID();
    this.dispatch("status-display", message, id);
    return () => {
      this.dispatch("status-close-display", id);
    };
  }

  openPrompt(
    prefix: string,
    desc: string,
    options: StatusBarInputOptions
  ): () => void {
    const id = window.crypto.randomUUID();
    this.dispatch("status-prompt", prefix, desc, options, id);
    return () => {
      this.dispatch("status-close-prompt", id);
    };
  }

  openNotification(message: string) {
    this.dispatch("status-notify", message);
  }

  smartIndent() {
    // Only works if a formatter is added for the current language.
    // reindentselectedlines does not work here.
    this.editor.getAction("editor.action.formatSelection")!.run();
  }

  moveCursorTo(to: "start" | "end") {
    const pos = this.getPos_();

    if (to === "start") {
      this.editor.setPosition(makePosition(pos.lineNumber, 1));
    } else if (to === "end") {
      const maxColumn = this.getModel_().getLineMaxColumn(pos.lineNumber);
      this.editor.setPosition(makePosition(pos.lineNumber, maxColumn));
    }
  }

  execCommand(command: "goLineLeft" | "goLineRight" | "indentAuto") {
    switch (command) {
      case "goLineLeft":
        this.moveCursorTo("start");
        break;
      case "goLineRight":
        this.moveCursorTo("end");
        break;
      case "indentAuto":
        this.smartIndent();
        break;
    }
  }

  getModel_() {
    return this.editor.getModel()!;
  }

  getPos_() {
    return this.editor.getPosition()!;
  }

  getSelection_() {
    return this.editor.getSelection()!;
  }

  getSelections_() {
    return this.editor.getSelections()!;
  }
}

const liftRange = (range: IRange) => window.monaco.Range.lift(range);

function makeRange(startPos: IPosition, endPos: IPosition): IRange;
function makeRange(
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number
): IRange;
function makeRange(
  startLine: number | IPosition,
  startColumn: number | IPosition,
  endLine?: number,
  endColumn?: number
): IRange {
  if (typeof startLine !== "number" && typeof startColumn !== "number") {
    const start = startLine as IPosition;
    const end = startColumn as IPosition;
    startLine = start.lineNumber;
    startColumn = start.column;
    endLine = end.lineNumber;
    endColumn = end.column;
  }
  return {
    startLineNumber: startLine as number,
    startColumn: startColumn as number,
    endLineNumber: endLine!,
    endColumn: endColumn!,
  };
}

const liftPosition = (position: IPosition) =>
  window.monaco.Position.lift(position);

const makePosition = (lineNumber: number, column: number): IPosition => ({
  lineNumber: lineNumber,
  column: column,
});

const liftSelection = (selection: ISelection) =>
  window.monaco.Selection.liftSelection(selection);

const makeSelection = (start: IPosition, end: IPosition): ISelection => ({
  selectionStartLineNumber: start.lineNumber,
  selectionStartColumn: start.column,
  positionLineNumber: end.lineNumber,
  positionColumn: end.column,
});
