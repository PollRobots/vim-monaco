import monaco from "monaco-editor";
import * as StatusBar from "./statusbar";
import EditorAdapter from "./adapter";
import { initVimAdapter, vimApi } from "./keymap_vim";
import * as Registers from "./register-controller";
import { VimOptions } from "./types";

export type IRegister = Registers.IRegister;
export type IStatusBar = StatusBar.IStatusBar;
export type ModeChangeEvent = StatusBar.ModeChangeEvent;
export type StatusBarInputOptions = StatusBar.StatusBarInputOptions;

declare global {
  interface Window {
    monaco: typeof monaco;
  }
}

export const makeDomStatusBar = (
  parent: HTMLElement,
  setFocus?: () => void
): IStatusBar => {
  return new StatusBar.StatusBar(parent, setFocus);
};

interface SetOptionConfig {
  append?: boolean;
  remove?: boolean;
  adapterOption?: boolean;
}

export class FileEvent extends Event {
  readonly filename: string;

  constructor(type: "open-file" | "save-file", filename: string) {
    super(type);
    this.filename = filename;
  }
}
interface Listener<T> {
  (evt: T): void;
}

interface ListenerObject<T> {
  handleEvent(object: T): void;
}

type EventHandler<T> = Listener<T> | ListenerObject<T>;

export class VimMode implements EventTarget {
  private editor_: monaco.editor.IStandaloneCodeEditor;
  private statusBar_?: IStatusBar;
  private adapter_: EditorAdapter;
  private keyBuffer_: string = "";
  private attached_: boolean = false;
  private listeners_: Map<
    string,
    (EventHandler<Event> | EventHandler<FileEvent>)[]
  > = new Map();
  private closers_: Map<string, () => void> = new Map();

  constructor(
    editor: monaco.editor.IStandaloneCodeEditor,
    statusBar?: IStatusBar
  ) {
    this.editor_ = editor;
    this.statusBar_ = statusBar;

    initVimAdapter();
    this.adapter_ = new EditorAdapter(editor);

    this.initListeners();
  }

  private initListeners() {
    this.adapter_.on("vim-set-clipboard-register", () => {
      this.dispatchEvent(new Event("clipboard"));
    });

    if (this.statusBar_ !== undefined) {
      const statusBar = this.statusBar_;

      this.adapter_.on("vim-mode-change", (mode) => {
        statusBar.setMode(mode);
      });

      this.adapter_.on("vim-keypress", (key) => {
        if (key === ":") {
          this.keyBuffer_ = "";
        } else {
          this.keyBuffer_ += key;
        }
        statusBar.setKeyBuffer(this.keyBuffer_);
      });

      this.adapter_.on("vim-command-done", () => {
        this.keyBuffer_ = "";
        statusBar.setKeyBuffer(this.keyBuffer_);
      });

      this.adapter_.on("status-display", (msg, id) => {
        const closer = statusBar.startDisplay(msg);
        this.closers_.set(id, closer);
      });

      this.adapter_.on("status-close-display", (id) => {
        const closer = this.closers_.get(id);
        if (closer) {
          closer();
          this.closers_.delete(id);
        }
      });

      this.adapter_.on("status-prompt", (prefix, desc, options, id) => {
        const closer = statusBar.startPrompt(prefix, desc, options);
        this.closers_.set(id, closer);
      });

      this.adapter_.on("status-close-prompt", (id) => {
        const closer = this.closers_.get(id);
        if (closer) {
          closer();
          this.closers_.delete(id);
        }
      });

      this.adapter_.on("status-notify", (msg) => {
        statusBar.showNotification(msg);
      });

      this.adapter_.on("dispose", () => {
        statusBar.toggleVisibility(false);
        statusBar.closeInput();
        statusBar.clear();
      });
    }

    EditorAdapter.commands["open"] = (adapter, params) =>
      this.dispatchEvent(new FileEvent("open-file", params.argString || ""));
    EditorAdapter.commands["save"] = (adapter, params) =>
      this.dispatchEvent(new FileEvent("save-file", params.argString || ""));
  }

  get attached(): boolean {
    return this.attached_;
  }

  addEventListener(
    type: "open-file" | "save-file",
    callback: EventHandler<FileEvent>,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: "clipboard",
    callback: EventHandler<Event>,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: string,
    callback: EventHandler<Event> | EventHandler<FileEvent>,
    options?: boolean | AddEventListenerOptions
  ): void {
    const typeListeners = this.listeners_.get(type);
    if (!typeListeners) {
      if (type === "clipboard") {
      }
      this.listeners_.set(type, [callback]);
    } else {
      typeListeners.push(callback);
    }
  }

  dispatchEvent(event: Event): boolean {
    const typeListeners = this.listeners_.get(event.type);
    if (typeListeners) {
      for (const listener of typeListeners) {
        const callback = Reflect.has(listener, "handleEvent")
          ? (listener as EventListenerObject).handleEvent
          : (listener as EventListener);
        callback(event);
        if (event.cancelable && event.defaultPrevented) {
          break;
        }
      }
    }
    return !(event.cancelable && event.defaultPrevented);
  }

  removeEventListener(
    type: "open-file" | "save-file",
    callback: EventHandler<FileEvent>,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener(
    type: "clipboard",
    callback: EventHandler<Event>,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener(
    type: string,
    callback: EventHandler<Event> | EventHandler<FileEvent>,
    options?: boolean | EventListenerOptions
  ): void {
    const typeListeners = this.listeners_.get(type);
    if (typeListeners) {
      const index = typeListeners.lastIndexOf(callback);
      if (index >= 0) {
        typeListeners.splice(index, 1);
      }
      if (typeListeners.length == 0) {
        this.listeners_.delete(type);
      }
    }
  }

  enable() {
    if (!this.attached_) {
      this.adapter_.attach();
      this.attached_ = true;
    }
  }

  disable() {
    if (this.attached_) {
      this.adapter_.detach();
      this.attached_ = false;
    }
  }

  setClipboardRegister(register: IRegister) {
    vimApi.defineRegister("*", register);
    vimApi.defineRegister("+", register);
  }

  executeCommand(input: string) {
    if (!this.attached) {
      throw new Error("Cannot execute commands when not attached");
    }
    vimApi.handleEx(this.adapter_, input);
  }

  setOption(
    name: string,
    value: string | number | boolean,
    config?: SetOptionConfig
  ) {
    if (config && config.adapterOption) {
      this.adapter_.setOption(name, value);
    } else {
      vimApi.setOption(name, value, this.adapter_, config);
    }
  }
}
