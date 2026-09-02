import { sourceProgramFor } from "../data/source-programs.ts";

const KEYWORDS = new Set([
  "auto",
  "break",
  "case",
  "const",
  "continue",
  "default",
  "do",
  "else",
  "enum",
  "extern",
  "for",
  "goto",
  "if",
  "inline",
  "register",
  "restrict",
  "return",
  "sizeof",
  "static",
  "struct",
  "switch",
  "typedef",
  "union",
  "volatile",
  "while",
]);

const TYPES = new Set([
  "char",
  "double",
  "float",
  "int",
  "long",
  "short",
  "signed",
  "unsigned",
  "void",
  "_Bool",
  "bool",
  "int8_t",
  "int16_t",
  "int32_t",
  "int64_t",
  "uint8_t",
  "uint16_t",
  "uint32_t",
  "uint64_t",
  "size_t",
]);

type TokenKind =
  | "comment"
  | "directive"
  | "function"
  | "keyword"
  | "number"
  | "operator"
  | "string"
  | "type";

interface LexerState {
  blockComment: boolean;
}

/** Shows the original C program associated with the currently active mission. */
export class SourceCodeView {
  private readonly trigger: HTMLButtonElement | null;
  private readonly title: HTMLElement | null;
  private readonly filename: HTMLElement | null;
  private readonly command: HTMLElement | null;
  private readonly code: HTMLElement | null;

  constructor(root: ParentNode = document) {
    this.trigger = root.querySelector<HTMLButtonElement>("[data-source-trigger]");
    this.title = root.querySelector<HTMLElement>("[data-source-title]");
    this.filename = root.querySelector<HTMLElement>("[data-source-filename]");
    this.command = root.querySelector<HTMLElement>("[data-source-command]");
    this.code = root.querySelector<HTMLElement>("[data-source-code]");
    this.clear();
  }

  setLevel(levelId: string, levelName: string, levelNumber: number): void {
    const program = sourceProgramFor(levelId);
    if (!program) {
      this.clear();
      return;
    }

    if (this.trigger) {
      this.trigger.disabled = false;
      this.trigger.title = `View the original C source for ${levelName}`;
    }
    if (this.title) {
      this.title.textContent = `${String(levelNumber).padStart(2, "0")} — ${levelName}`;
    }
    if (this.filename) this.filename.textContent = program.filename;
    if (this.command) renderCompileCommand(this.command, program.compileCommand);
    if (this.code) renderCSource(this.code, program.text);
  }

  clear(): void {
    if (this.trigger) {
      this.trigger.disabled = true;
      this.trigger.title = "Start a mission to view its source";
    }
    if (this.title) this.title.textContent = "Source code";
    if (this.filename) this.filename.textContent = "No mission selected";
    this.command?.replaceChildren();
    this.code?.replaceChildren();
  }
}

/** Preserve the supplied command while marking the options consumed by Hikari. */
export function renderCompileCommand(target: HTMLElement, command: string): void {
  target.replaceChildren();
  let hikariOptionFollows = false;

  for (const part of command.split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) {
      target.append(document.createTextNode(part));
      continue;
    }

    const node = document.createElement("span");
    node.textContent = part;
    if (part === "clang.exe") node.className = "command-tool";
    if (part === "-mllvm") {
      node.className = "command-hikari command-forwarder";
      hikariOptionFollows = true;
    } else if (hikariOptionFollows) {
      node.className = "command-hikari";
      hikariOptionFollows = false;
    }
    target.append(node);
  }
}

/** Render highlighted C without placing source text through innerHTML. */
export function renderCSource(target: HTMLElement, source: string): void {
  target.replaceChildren();
  const state: LexerState = { blockComment: false };
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();

  for (const text of lines) {
    const line = document.createElement("span");
    line.className = "source-line";
    const body = document.createElement("span");
    body.className = "source-line-code";
    highlightLine(body, text, state);
    line.append(body);
    target.append(line);
  }
}

function highlightLine(target: HTMLElement, line: string, state: LexerState): void {
  let index = 0;
  const firstNonSpace = line.search(/\S/);

  while (index < line.length) {
    if (state.blockComment) {
      const end = line.indexOf("*/", index);
      if (end < 0) {
        token(target, "comment", line.slice(index));
        return;
      }
      token(target, "comment", line.slice(index, end + 2));
      state.blockComment = false;
      index = end + 2;
      continue;
    }

    if (index === firstNonSpace && line[index] === "#") {
      token(target, "directive", line.slice(index));
      return;
    }

    if (line.startsWith("//", index)) {
      token(target, "comment", line.slice(index));
      return;
    }
    if (line.startsWith("/*", index)) {
      const end = line.indexOf("*/", index + 2);
      if (end < 0) {
        token(target, "comment", line.slice(index));
        state.blockComment = true;
        return;
      }
      token(target, "comment", line.slice(index, end + 2));
      index = end + 2;
      continue;
    }

    const char = line[index];
    if (char === '"' || char === "'") {
      const end = stringEnd(line, index, char);
      token(target, "string", line.slice(index, end));
      index = end;
      continue;
    }

    const number = line.slice(index).match(/^(?:0[xX][\dA-Fa-f]+|0[bB][01]+|\d+(?:\.\d*)?)(?:[uUlLfF]+)?/);
    if (number) {
      token(target, "number", number[0]);
      index += number[0].length;
      continue;
    }

    const identifier = line.slice(index).match(/^[A-Za-z_]\w*/);
    if (identifier) {
      const value = identifier[0];
      let kind: TokenKind | null = null;
      if (KEYWORDS.has(value)) kind = "keyword";
      else if (TYPES.has(value) || /_t$/.test(value)) kind = "type";
      else if (line.slice(index + value.length).match(/^\s*\(/)) kind = "function";
      if (kind) token(target, kind, value);
      else target.append(document.createTextNode(value));
      index += value.length;
      continue;
    }

    const operator = line.slice(index).match(/^(?:<<=|>>=|->|\+\+|--|&&|\|\||==|!=|<=|>=|<<|>>|[+\-*/%&|^~!=<>?:])/);
    if (operator) {
      token(target, "operator", operator[0]);
      index += operator[0].length;
      continue;
    }

    target.append(document.createTextNode(char));
    index += 1;
  }
}

function stringEnd(line: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < line.length) {
    if (line[index] === "\\") index += 2;
    else if (line[index] === quote) return index + 1;
    else index += 1;
  }
  return line.length;
}

function token(target: HTMLElement, kind: TokenKind, text: string): void {
  const node = document.createElement("span");
  node.className = `c-token c-${kind}`;
  node.textContent = text;
  target.append(node);
}
