export class StringStream {
  pos: number = 0;
  start: number = 0;
  str: string;
  tabSize: number;
  lastColumnPos: number = 0;
  lastColumnValue: number = 0;
  lineStart: number = 0;

  constructor(str: string, tabSize?: number) {
    this.str = str;
    this.tabSize = tabSize || 8;
  }

  eol() {
    return this.pos >= this.str.length;
  }

  sol() {
    return this.pos == this.lineStart;
  }

  peek() {
    return this.str.charAt(this.pos) || undefined;
  }

  next() {
    if (this.pos < this.str.length) {
      return this.str.charAt(this.pos++);
    }
  }

  eat(match: string | RegExp | ((ch: string) => boolean)) {
    const ch = this.str.charAt(this.pos);
    const ok =
      typeof match === "string"
        ? ch === match
        : ch && (match instanceof RegExp ? match.test(ch) : match(ch));

    if (ok) {
      ++this.pos;
      return ch;
    }
  }

  eatWhile(match: string | RegExp | ((ch: string) => boolean)) {
    var start = this.pos;
    while (this.eat(match)) {}
    return this.pos > start;
  }

  eatSpace() {
    var start = this.pos;
    while (/[\s\u00a0]/.test(this.str.charAt(this.pos))) {
      ++this.pos;
    }
    return this.pos > start;
  }

  skipToEnd() {
    this.pos = this.str.length;
  }

  skipTo(ch: string) {
    var found = this.str.indexOf(ch, this.pos);
    if (found > -1) {
      this.pos = found;
      return true;
    }
  }

  backUp(n: number) {
    this.pos -= n;
  }

  column() {
    throw new Error("not implemented");
  }

  indentation() {
    throw new Error("not implemented");
  }

  match(
    pattern: string,
    consume?: boolean,
    caseInsensitive?: boolean
  ): string | boolean;
  match(pattern: RegExp, consume?: boolean): RegExpMatchArray;
  match(
    pattern: string | RegExp,
    consume?: boolean,
    caseInsensitive?: boolean
  ): string | boolean | RegExpMatchArray | null {
    if (typeof pattern == "string") {
      const cased = (str: string) => {
        return caseInsensitive ? str.toLowerCase() : str;
      };
      const substr = this.str.substring(this.pos, this.pos + pattern.length);
      if (cased(substr) == cased(pattern)) {
        if (consume !== false) {
          this.pos += pattern.length;
        }
        return true;
      }
      return null;
    } else {
      var match = this.str.slice(this.pos).match(pattern);
      if (match && match.index && match.index > 0) {
        return null;
      }
      if (match && consume !== false) {
        this.pos += match[0].length;
      }
      return match;
    }
  }

  current() {
    return this.str.slice(this.start, this.pos);
  }

  hideFirstChars(n: number, inner: () => {}) {
    this.lineStart += n;
    try {
      return inner();
    } finally {
      this.lineStart -= n;
    }
  }
}
