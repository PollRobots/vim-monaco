type Mode = "normal" | "visual" | "replace" | "insert";
type SubMode = "" | "linewise" | "blockwise";

export interface ModeChangeEvent {
  mode: Mode;
  subMode?: SubMode;
}

interface StatusBarInput {
  options: SecInfoOptions;
  node: HTMLInputElement;
  keyDownHandler: (evt: KeyboardEvent) => void;
  keyUpHandler: (evt: KeyboardEvent) => void;
  blurHandler: (evt: FocusEvent) => void;
}

export interface SecInfoOptions {
  onKeyDown?: (
    evt: KeyboardEvent,
    text: string,
    close: (value?: string) => void
  ) => boolean;
  onKeyUp?: (
    evt: KeyboardEvent,
    text: string,
    close: (value?: string) => void
  ) => void;
  onClose?: (value?: string) => void;
  bottom?: boolean;
  selectValueOnOpen?: boolean;
  value?: string;
  closeOnBlur?: boolean;
  closeOnEnter?: boolean;
}

export interface IStatusBar {
  toggleVisibility: (visible: boolean) => void;
  showNotification: (message: string) => void;
  setMode: (mode: ModeChangeEvent) => void;
  setKeyBuffer: (key: string) => void;
  setSecStatic: (message: string) => () => void;
  setSecPrompt: (
    prefix: string,
    desc: string,
    options: SecInfoOptions
  ) => () => void;
  closeInput: () => void;
  clear: () => void;
}

export class StatusBar implements IStatusBar {
  node: HTMLElement;
  modeInfoNode: HTMLSpanElement;
  secInfoNode: HTMLSpanElement;
  notifNode: HTMLSpanElement;
  keyInfoNode: HTMLSpanElement;
  setFocus: () => void;
  input?: StatusBarInput;
  notifTimeout: ReturnType<typeof setTimeout> = undefined;

  constructor(node: HTMLElement, setFocus?: () => void) {
    this.node = node;
    this.modeInfoNode = document.createElement("span");
    this.secInfoNode = document.createElement("span");
    this.notifNode = document.createElement("span");
    this.notifNode.className = "vim-notification";
    this.keyInfoNode = document.createElement("span");
    this.keyInfoNode.setAttribute("style", "float: right");
    this.node.appendChild(this.modeInfoNode);
    this.node.appendChild(this.secInfoNode);
    this.node.appendChild(this.notifNode);
    this.node.appendChild(this.keyInfoNode);
    this.toggleVisibility(false);
    this.setFocus = setFocus;
  }

  setMode(ev: ModeChangeEvent) {
    if (ev.mode === "visual") {
      if (ev.subMode === "linewise") {
        this.setText("--VISUAL LINE--");
      } else if (ev.subMode === "blockwise") {
        this.setText("--VISUAL BLOCK--");
      } else {
        this.setText("--VISUAL--");
      }
      return;
    }

    this.setText(`--${ev.mode.toUpperCase()}--`);
  }

  setKeyBuffer(key: string) {
    this.keyInfoNode.textContent = key;
  }

  setSecStatic(message: string): () => void {
    return this.setSec(document.createTextNode(message));
  }

  setSecPrompt(
    prefix: string,
    desc: string,
    options: SecInfoOptions
  ): () => void {
    const frag = document.createDocumentFragment();

    const span = document.createElement("span");
    span.style.fontFamily = "monospace";
    span.style.whiteSpace = "pre";
    span.appendChild(document.createTextNode(prefix));

    const input = document.createElement("input");
    input.type = "text";
    input.setAttribute("autocorrect", "off");
    input.autocapitalize = "off";
    input.spellcheck = false;

    span.appendChild(input);

    if (desc) {
      const descSpan = document.createElement("span");
      descSpan.style.color = "#888";
      span.appendChild(descSpan);
    }

    frag.appendChild(span);

    return this.setSec(frag, input, options);
  }

  private setSec(
    text: Node,
    input?: HTMLInputElement,
    options?: SecInfoOptions
  ): () => void {
    this.notifNode.textContent = "";

    this.setInnerHtml_(this.secInfoNode, text);

    if (input) {
      input.focus();
      this.input = {
        options: options || {},
        node: input,
        keyDownHandler: (evt) => this.inputKeyDown(evt),
        keyUpHandler: (evt) => this.inputKeyUp(evt),
        blurHandler: () => this.inputBlur(),
      };

      if (options) {
        if (options.selectValueOnOpen) {
          input.select();
        }

        if (options.value) {
          input.value = options.value;
        }
      }

      this.addInputListeners();
    }

    return () => this.closeInput();
  }

  setText(text: string) {
    this.modeInfoNode.textContent = text;
  }

  toggleVisibility(toggle: boolean) {
    if (toggle) {
      this.node.style.display = "block";
    } else {
      this.node.style.display = "none";
    }

    if (this.input) {
      this.removeInputListeners();
    }

    if (this.notifTimeout) {
      clearTimeout(this.notifTimeout);
      this.notifTimeout = undefined;
    }
  }

  closeInput() {
    this.removeInputListeners();
    this.input = null;
    this.setSec(document.createTextNode(""));

    if (this.setFocus) {
      this.setFocus();
    }
  }

  clear() {
    this.setInnerHtml_(this.node, document.createTextNode(""));
  }

  inputKeyUp(e: KeyboardEvent) {
    const { options, node: input } = this.input;
    if (options && options.onKeyUp) {
      options.onKeyUp(e, input.value, () => this.closeInput());
    }
  }

  inputBlur() {
    const { options } = this.input;

    if (options.closeOnBlur) {
      this.closeInput();
    }
  }

  inputKeyDown(e: KeyboardEvent) {
    const { options, node: input } = this.input;

    if (options && options.onKeyDown) {
      if (options.onKeyDown(e, input.value, () => this.closeInput())) {
        return;
      }
    }

    if (
      e.key === "Escape" ||
      (options && options.closeOnEnter !== false && e.key === "Enter")
    ) {
      this.input.node.blur();
      e.stopPropagation();
      this.closeInput();
    }

    if (e.key === "Enter" && options.onClose) {
      e.stopPropagation();
      e.preventDefault();
      options.onClose(input.value);
    }
  }

  addInputListeners() {
    this.input.node.addEventListener("keyup", this.input.keyUpHandler);
    this.input.node.addEventListener("keydown", this.input.keyDownHandler);
    this.input.node.addEventListener("blur", this.input.blurHandler);
  }

  removeInputListeners() {
    if (!this.input || !this.input.node) {
      return;
    }

    this.input.node.removeEventListener("keyup", this.input.keyUpHandler);
    this.input.node.removeEventListener("keydown", this.input.keyDownHandler);
    this.input.node.removeEventListener("blur", this.input.blurHandler);
  }

  showNotification(message: string) {
    this.notifNode.textContent = message;
    this.notifTimeout = setTimeout(() => {
      this.notifNode.textContent = "";
    }, 5000);
  }

  setInnerHtml_(element: Node, htmlContents: Node) {
    // Clear out previous contents first.
    while (element.childNodes.length) {
      element.removeChild(element.childNodes[0]);
    }
    element.appendChild(htmlContents);
  }
}
