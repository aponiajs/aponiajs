import type { ViewEngine } from "@aponiajs/common";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { escapeHtml } from "./escape-html.ts";

/** Options for the Laravel-style Blade view engine. */
export interface BladeViewEngineOptions {
  /** The directory templates resolve against; defaults to `views`. */
  readonly rootDir?: string;
  /** Values every template can read without being passed explicitly. */
  readonly shared?: Record<string, unknown>;
  /** Whether rendered templates are cached in memory; defaults to true. */
  readonly cache?: boolean;
}

type Data = Record<string, unknown>;
type Expression = (data: Data) => unknown;

/**
 * One render's deferred data values.
 *
 * Data is captured behind an opaque token and resolved once, after every
 * template has composed its final string. The token contains none of Blade's
 * delimiters, so a value can never be mistaken for template source on a later
 * pass.
 */
interface RenderState {
  capture(value: string): string;
  resolve(output: string): string;
}

/**
 * A Laravel-style Blade template engine.
 *
 * Supports dot-notation templates, layouts, sections, yields, includes,
 * components with props and slots, escaped and raw output, and basic
 * conditionals and loops. Templates are developer-authored, so expressions
 * compile to cached functions once and render from memory thereafter.
 */
export class BladeViewEngine implements ViewEngine {
  readonly #rootDir: string;
  readonly #useCache: boolean;
  readonly #shared: Data;
  readonly #templates = new Map<string, string>();
  readonly #expressions = new Map<string, Expression>();
  readonly #active = new Set<string>();

  constructor(options: BladeViewEngineOptions = {}) {
    this.#rootDir = options.rootDir ?? resolve(process.cwd(), "views");
    this.#useCache = options.cache ?? true;
    this.#shared = { ...options.shared };
  }

  /** Adds one value every subsequent render can read. */
  share(key: string, value: unknown): void {
    this.#shared[key] = value;
  }

  async render(
    template: string,
    data: Data,
    options?: { readonly layout?: string; readonly fragment?: boolean },
  ): Promise<string> {
    const state = createRenderState();
    const rendered = await this.#renderTemplate(
      template,
      { ...this.#shared, ...data },
      options,
      0,
      undefined,
      state,
    );
    return state.resolve(rendered);
  }

  async #renderTemplate(
    template: string,
    data: Data,
    options: { readonly layout?: string; readonly fragment?: boolean } | undefined,
    depth: number,
    inheritedSections?: Map<string, string>,
    state?: RenderState,
  ): Promise<string> {
    if (this.#active.has(template)) {
      throw new Error(`Blade template "${template}" includes itself.`);
    }
    this.#active.add(template);
    try {
      return await this.#renderTemplateInner(
        template,
        data,
        options,
        depth,
        inheritedSections,
        state ?? createRenderState(),
      );
    } finally {
      this.#active.delete(template);
    }
  }

  async #renderTemplateInner(
    template: string,
    data: Data,
    options: { readonly layout?: string; readonly fragment?: boolean } | undefined,
    depth: number,
    inheritedSections: Map<string, string> | undefined,
    state: RenderState,
  ): Promise<string> {
    if (depth > 32) {
      throw new Error("Blade template recursion exceeded the supported depth.");
    }

    const source = await this.#loadTemplate(template);
    const sections = inheritedSections ?? new Map<string, string>();
    let body = source;

    const extendsMatch = /@extends\s*\(\s*['"]([^'"]+)['"]\s*\)/.exec(body);
    const layout = extendsMatch?.[1] ?? options?.layout;
    body = body.replace(/@extends\s*\(\s*['"][^'"]+['"]\s*\)/g, "");

    body = await this.#extractSections(body, data, sections, state);
    let rendered = await this.#renderSource(body, data, sections, state);

    if (options?.fragment) {
      return sections.get("content") ?? rendered;
    }

    if (layout !== undefined) {
      if (!sections.has("content")) {
        sections.set("content", rendered);
      }
      const layoutData: Data = { ...data };
      for (const [name, value] of sections) {
        layoutData[name] = value;
      }
      layoutData.sections = Object.fromEntries(sections);
      layoutData.content = sections.get("content") ?? rendered;
      rendered = await this.#renderTemplate(
        layout,
        layoutData,
        undefined,
        depth + 1,
        sections,
        state,
      );
    }

    return rendered;
  }

  async #extractSections(
    source: string,
    data: Data,
    sections: Map<string, string>,
    state: RenderState,
  ): Promise<string> {
    let result = source;
    const block = /@section\s*\(\s*['"]([^'"]+)['"]\s*\)([\s\S]*?)@endsection/g;
    const replacements: { full: string; name: string; content: string }[] = [];
    for (const match of result.matchAll(block)) {
      replacements.push({ full: match[0], name: match[1]!, content: match[2] ?? "" });
    }
    for (const replacement of replacements) {
      sections.set(
        replacement.name,
        await this.#renderSource(replacement.content, data, sections, state),
      );
      result = result.replace(replacement.full, "");
    }

    const inline = /@section\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([\s\S]*?)['"]\s*\)/g;
    for (const match of result.matchAll(inline)) {
      sections.set(match[1]!, match[2] ?? "");
    }
    result = result.replace(inline, "");

    return result;
  }

  async #renderSource(
    source: string,
    data: Data,
    sections: Map<string, string>,
    state: RenderState,
  ): Promise<string> {
    let result = source;

    result = await this.#renderBlocks(result, data, sections, state);
    result = await this.#renderIncludes(result, data, state);
    result = await this.#renderComponents(result, data, sections, state);
    result = this.#renderYields(result, sections, data, state);
    result = this.#renderEchoes(result, data, state);

    return result;
  }

  async #renderBlocks(
    source: string,
    data: Data,
    sections: Map<string, string>,
    state: RenderState,
  ): Promise<string> {
    let result = source;

    result = await replaceAsync(
      result,
      /@if\s*\(([\s\S]*?)\)\s*([\s\S]*?)@endif/g,
      async (_match, expression: string, inner: string) => {
        const [truthy, falsy] = splitElse(inner);
        const branch = this.#evaluate(expression.trim(), data) ? truthy : falsy;
        return await this.#renderSource(branch, data, sections, state);
      },
    );

    result = await replaceAsync(
      result,
      /@unless\s*\(([\s\S]*?)\)\s*([\s\S]*?)@endunless/g,
      async (_match, expression: string, inner: string) => {
        const branch = this.#evaluate(expression.trim(), data) ? "" : inner;
        return await this.#renderSource(branch, data, sections, state);
      },
    );

    result = await replaceAsync(
      result,
      /@foreach\s*\(([\s\S]*?)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*=>\s*([A-Za-z_][A-Za-z0-9_]*))?\s*\)\s*([\s\S]*?)@endforeach/g,
      async (
        match,
        expression: string,
        first: string,
        second: string | undefined,
        inner: string,
      ) => {
        const iterable = this.#evaluate(expression.trim(), data);
        if (iterable === undefined || iterable === null) {
          return "";
        }
        const keyName = second === undefined ? undefined : first;
        const itemName = second ?? first;
        const entries: [unknown, unknown][] = [];
        if (typeof iterable === "object" && Symbol.iterator in iterable) {
          let index = 0;
          for (const item of iterable as Iterable<unknown>) {
            entries.push([index, item]);
            index += 1;
          }
        } else if (typeof iterable === "object") {
          entries.push(...Object.entries(iterable));
        }
        let output = "";
        for (const [key, item] of entries) {
          const scope: Data = { ...data, [itemName]: item };
          if (keyName !== undefined) {
            scope[keyName] = key;
          }
          output += await this.#renderSource(inner, scope, sections, state);
        }
        return output;
      },
    );

    return result;
  }

  async #renderIncludes(source: string, data: Data, state: RenderState): Promise<string> {
    return await replaceAsync(
      source,
      /@include\s*\(\s*['"]([^'"]+)['"]\s*(?:,\s*([\s\S]*?))?\)/g,
      async (_match, name: string, expression: string | undefined) => {
        const extra = expression === undefined ? {} : this.#evaluateObject(expression, data);
        return await this.#renderTemplate(
          name,
          { ...data, ...extra },
          undefined,
          0,
          undefined,
          state,
        );
      },
    );
  }

  async #renderComponents(
    source: string,
    data: Data,
    sections: Map<string, string>,
    state: RenderState,
  ): Promise<string> {
    let result = source;
    let guard = 0;
    const pattern = /<x-([a-zA-Z0-9_-]+)((?:\s+[^>]*?)?)\s*(?:\/>|>([\s\S]*?)<\/x-\1\s*>)/;

    while (guard < 100) {
      guard += 1;
      const match = pattern.exec(result);
      if (match === null) {
        return result;
      }
      const [full, name, attrs, inner] = match;
      const props = this.#parseAttributes(attrs ?? "", data, state);
      const slot =
        inner === undefined ? "" : await this.#renderSource(inner, data, sections, state);
      const component = await this.#renderTemplate(
        `components/${name}`,
        { ...data, ...props, slot },
        undefined,
        0,
        undefined,
        state,
      );
      result = result.replace(full, () => component);
    }

    throw new Error("Blade component nesting exceeded the supported depth.");
  }

  #renderYields(
    source: string,
    sections: Map<string, string>,
    data: Data,
    state: RenderState,
  ): string {
    return source.replace(
      /@yield\s*\(\s*['"]([^'"]+)['"](?:\s*,\s*(['"])([\s\S]*?)\2)?\s*\)/g,
      (_match, name: string, _quote: string | undefined, fallback: string | undefined) =>
        sections.get(name) ??
        (fallback === undefined ? "" : this.#resolveString(fallback, data, state, true)),
    );
  }

  #renderEchoes(source: string, data: Data, state: RenderState): string {
    let result = source.replace(/\{!!\s*([\s\S]*?)\s*!!\}/g, (_match, expression: string) =>
      state.capture(this.#stringify(this.#evaluate(expression.trim(), data))),
    );
    result = result.replace(/\{\{\s*([\s\S]*?)\s*\}\}/g, (_match, expression: string) =>
      state.capture(escapeHtml(this.#stringify(this.#evaluate(expression.trim(), data)))),
    );
    return result;
  }

  #parseAttributes(source: string, data: Data, state: RenderState): Data {
    const props: Data = {};
    const pattern = /(?<bound>:)?([A-Za-z_][A-Za-z0-9_-]*)(?:\s*=\s*"([^"]*)")?/g;
    for (const match of source.matchAll(pattern)) {
      const bound = match[1] === ":";
      const name = match[2]!;
      const value = match[3];
      if (value === undefined) {
        props[name] = true;
        continue;
      }
      props[name] = bound ? this.#evaluate(value, data) : this.#resolveString(value, data, state);
    }
    return props;
  }

  #evaluateObject(expression: string, data: Data): Data {
    const trimmed = expression.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
      return {};
    }
    const value = this.#evaluate(trimmed, data);
    return typeof value === "object" && value !== null ? (value as Data) : {};
  }

  #resolveString(value: string, data: Data, state: RenderState, escape = false): string {
    return value.replace(/\{\{\s*([\s\S]*?)\s*\}\}/g, (_match, expression: string) => {
      const rendered = this.#stringify(this.#evaluate(expression.trim(), data));
      // A yield fallback is rendered into the document; a component prop is not.
      return state.capture(escape ? escapeHtml(rendered) : rendered);
    });
  }

  #evaluate(expression: string, data: Data): unknown {
    const normalized = expression.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, "$1");
    let compiled = this.#expressions.get(normalized);
    if (compiled === undefined) {
      compiled = compileBladeExpression(normalized);
      this.#expressions.set(normalized, compiled);
    }
    try {
      return compiled(data);
    } catch {
      return undefined;
    }
  }

  #stringify(value: unknown): string {
    if (value === undefined || value === null) {
      return "";
    }
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return "";
      }
    }
    return String(value as string | number | boolean | bigint);
  }

  async #loadTemplate(template: string): Promise<string> {
    if (template.includes("<") && template.includes(">")) {
      return template;
    }
    const key = template;
    const cached = this.#templates.get(key);
    if (cached !== undefined && this.#useCache) {
      return cached;
    }
    const path = await this.#resolveTemplate(template);
    const source = await Bun.file(path).text();
    if (this.#useCache) {
      this.#templates.set(key, source);
    }
    return source;
  }

  async #resolveTemplate(template: string): Promise<string> {
    const candidates = this.#candidatePaths(template);
    for (const candidate of candidates) {
      if (await Bun.file(candidate).exists()) {
        return candidate;
      }
    }
    throw new Error(`Blade template "${template}" was not found under ${this.#rootDir}.`);
  }

  #candidatePaths(template: string): string[] {
    const hasExtension = /\.(?:blade\.html|html|php|ejs|vue|tsx)$/.test(template);
    const normalized = hasExtension ? template : template.replace(/\./g, "/");
    const cwd = process.cwd();
    const callerRoot = this.#rootDir.endsWith("/views")
      ? this.#rootDir.slice(0, -"/views".length)
      : this.#rootDir;
    const baseDir =
      template.startsWith("/") || template.startsWith("./") || template.startsWith("../")
        ? cwd
        : this.#rootDir;
    const target = resolve(baseDir, normalized);
    // Feature folder views subfolder: src/<feature>/views/<name>
    const segments = normalized.split("/");
    const viewsNested =
      segments.length > 1
        ? resolve(callerRoot, "src", segments[0]!, "views", segments.slice(1).join("/"))
        : resolve(callerRoot, "src", "views", normalized);

    if (hasExtension) {
      return [viewsNested, target];
    }
    return [
      `${viewsNested}.blade.html`,
      `${viewsNested}.html`,
      `${target}.blade.html`,
      `${target}.html`,
    ];
  }
}

function splitElse(inner: string): [string, string] {
  const index = inner.indexOf("@else");
  if (index === -1) {
    return [inner, ""];
  }
  return [inner.slice(0, index), inner.slice(index + "@else".length)];
}

async function replaceAsync(
  source: string,
  pattern: RegExp,
  replacer: (...match: string[]) => Promise<string>,
): Promise<string> {
  const matches = [...source.matchAll(pattern)];
  if (matches.length === 0) {
    return source;
  }
  let result = "";
  let cursor = 0;
  for (const match of matches) {
    const index = match.index ?? 0;
    result += source.slice(cursor, index);
    result += await replacer(...(match as unknown as string[]));
    cursor = index + match[0].length;
  }
  result += source.slice(cursor);
  return result;
}

/**
 * Creates one render's deferred-value table.
 *
 * The token is random per render and contains no Blade delimiters, so a value
 * that itself contains braces cannot be mistaken for template source.
 */
function createRenderState(): RenderState {
  const nonce = randomUUID();
  let sequence = 0;
  const values = new Map<string, string>();
  const tokenPattern = /%%aponia:([0-9a-f-]+):(\d+)%%/g;
  return {
    capture(value: string): string {
      const token = `%%aponia:${nonce}:${sequence}%%`;
      sequence += 1;
      values.set(token, value);
      return token;
    },
    resolve(output: string): string {
      let current = output;
      for (let pass = 0; pass <= values.size; pass += 1) {
        let changed = false;
        const next = current.replace(tokenPattern, (token) => {
          const value = values.get(token);
          if (value === undefined) {
            return token;
          }
          changed = true;
          return value;
        });
        if (!changed) {
          return next;
        }
        current = next;
      }
      return current;
    },
  };
}

type BladeToken =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "ident"; readonly value: string }
  | { readonly kind: "op"; readonly value: string };

const multiCharOps = ["===", "!==", "==", "!=", "<=", ">=", "&&", "||", "??"] as const;
const blockedKeys = new Set(["__proto__", "constructor", "prototype"]);

function tokenizeBladeExpression(source: string): readonly BladeToken[] | undefined {
  const tokens: BladeToken[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i] ?? "";
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    const multi = multiCharOps.find((op) => source.startsWith(op, i));
    if (multi !== undefined) {
      tokens.push({ kind: "op", value: multi });
      i += multi.length;
      continue;
    }

    if ("+-*/%!<>?:.,()[]{}".includes(ch)) {
      tokens.push({ kind: "op", value: ch });
      i += 1;
      continue;
    }

    if (ch === "'" || ch === '"') {
      const quote = ch;
      i += 1;
      let text = "";
      let closed = false;
      while (i < source.length) {
        const cur = source[i] ?? "";
        if (cur === "\\") {
          const next = source[i + 1];
          if (next === undefined) {
            return undefined;
          }
          text += next;
          i += 2;
          continue;
        }
        if (cur === quote) {
          closed = true;
          i += 1;
          break;
        }
        text += cur;
        i += 1;
      }
      if (!closed) {
        return undefined;
      }
      tokens.push({ kind: "string", value: text });
      continue;
    }

    if (/[0-9]/.test(ch)) {
      let end = i + 1;
      while (end < source.length && /[0-9.]/.test(source[end] ?? "")) {
        end += 1;
      }
      const num = Number(source.slice(i, end));
      if (Number.isNaN(num)) {
        return undefined;
      }
      tokens.push({ kind: "number", value: num });
      i = end;
      continue;
    }

    if (/[A-Za-z_$]/.test(ch)) {
      let end = i + 1;
      while (end < source.length && /[A-Za-z0-9_$]/.test(source[end] ?? "")) {
        end += 1;
      }
      tokens.push({ kind: "ident", value: source.slice(i, end) });
      i = end;
      continue;
    }

    return undefined;
  }

  return tokens;
}

function compileBladeExpression(source: string): Expression {
  const tokens = tokenizeBladeExpression(source);
  if (tokens === undefined || tokens.length === 0) {
    return () => undefined;
  }

  let cursor = 0;
  const peek = (): BladeToken | undefined => tokens[cursor];
  const consume = (): BladeToken | undefined => {
    const token = tokens[cursor];
    cursor += 1;
    return token;
  };
  const matchOp = (op: string): boolean => {
    const token = peek();
    if (token?.kind === "op" && token.value === op) {
      cursor += 1;
      return true;
    }
    return false;
  };

  const parseTernary = (): Expression | undefined => {
    const condition = parseNullish();
    if (condition === undefined) {
      return undefined;
    }
    if (!matchOp("?")) {
      return condition;
    }
    const whenTrue = parseTernary();
    if (whenTrue === undefined || !matchOp(":")) {
      return undefined;
    }
    const whenFalse = parseTernary();
    if (whenFalse === undefined) {
      return undefined;
    }
    return (data) => (condition(data) ? whenTrue(data) : whenFalse(data));
  };

  const parseNullish = (): Expression | undefined => {
    let left = parseOr();
    if (left === undefined) {
      return undefined;
    }
    while (matchOp("??")) {
      const right = parseOr();
      if (right === undefined) {
        return undefined;
      }
      const prev: Expression = left;
      left = (data) => prev(data) ?? right(data);
    }
    return left;
  };

  const parseOr = (): Expression | undefined => {
    let left = parseAnd();
    if (left === undefined) {
      return undefined;
    }
    while (matchOp("||")) {
      const right = parseAnd();
      if (right === undefined) {
        return undefined;
      }
      const prev: Expression = left;
      left = (data) => prev(data) || right(data);
    }
    return left;
  };

  const parseAnd = (): Expression | undefined => {
    let left = parseEquality();
    if (left === undefined) {
      return undefined;
    }
    while (matchOp("&&")) {
      const right = parseEquality();
      if (right === undefined) {
        return undefined;
      }
      const prev: Expression = left;
      left = (data) => prev(data) && right(data);
    }
    return left;
  };

  const parseEquality = (): Expression | undefined => {
    let left = parseRelational();
    if (left === undefined) {
      return undefined;
    }
    while (true) {
      const op = peek();
      if (
        op?.kind === "op" &&
        (op.value === "===" || op.value === "!==" || op.value === "==" || op.value === "!=")
      ) {
        consume();
        const right = parseRelational();
        if (right === undefined) {
          return undefined;
        }
        const prev: Expression = left;
        if (op.value === "===") {
          left = (data) => prev(data) === right(data);
        } else if (op.value === "!==") {
          left = (data) => prev(data) !== right(data);
        } else if (op.value === "==") {
          // Intentionally mirrors JS `==` semantics when explicitly written in templates.
          // oxlint-disable-next-line eqeqeq
          left = (data) => prev(data) == right(data);
        } else {
          // oxlint-disable-next-line eqeqeq
          left = (data) => prev(data) != right(data);
        }
      } else {
        break;
      }
    }
    return left;
  };

  const parseRelational = (): Expression | undefined => {
    let left = parseAdditive();
    if (left === undefined) {
      return undefined;
    }
    while (true) {
      const op = peek();
      if (
        op?.kind === "op" &&
        (op.value === "<" || op.value === "<=" || op.value === ">" || op.value === ">=")
      ) {
        consume();
        const right = parseAdditive();
        if (right === undefined) {
          return undefined;
        }
        const prev: Expression = left;
        left = (data) => {
          const l = prev(data) as number;
          const r = right(data) as number;
          if (op.value === "<") return l < r;
          if (op.value === "<=") return l <= r;
          if (op.value === ">") return l > r;
          return l >= r;
        };
      } else {
        break;
      }
    }
    return left;
  };

  const parseAdditive = (): Expression | undefined => {
    let left = parseMultiplicative();
    if (left === undefined) {
      return undefined;
    }
    while (true) {
      const op = peek();
      if (op?.kind === "op" && (op.value === "+" || op.value === "-")) {
        consume();
        const right = parseMultiplicative();
        if (right === undefined) {
          return undefined;
        }
        const prev: Expression = left;
        left =
          op.value === "+"
            ? (data) => (prev(data) as number) + (right(data) as number)
            : (data) => (prev(data) as number) - (right(data) as number);
      } else {
        break;
      }
    }
    return left;
  };

  const parseMultiplicative = (): Expression | undefined => {
    let left = parseUnary();
    if (left === undefined) {
      return undefined;
    }
    while (true) {
      const op = peek();
      if (op?.kind === "op" && (op.value === "*" || op.value === "/" || op.value === "%")) {
        consume();
        const right = parseUnary();
        if (right === undefined) {
          return undefined;
        }
        const prev: Expression = left;
        left = (data) => {
          const l = prev(data) as number;
          const r = right(data) as number;
          if (op.value === "*") return l * r;
          if (op.value === "/") return l / r;
          return l % r;
        };
      } else {
        break;
      }
    }
    return left;
  };

  const parseUnary = (): Expression | undefined => {
    if (matchOp("!")) {
      const operand = parseUnary();
      return operand === undefined ? undefined : (data) => !operand(data);
    }
    if (matchOp("-")) {
      const operand = parseUnary();
      return operand === undefined ? undefined : (data) => -(operand(data) as number);
    }
    if (matchOp("+")) {
      const operand = parseUnary();
      return operand === undefined ? undefined : (data) => +(operand(data) as number);
    }
    return parseMember();
  };

  const parseMember = (): Expression | undefined => {
    let target = parsePrimary();
    if (target === undefined) {
      return undefined;
    }
    while (true) {
      if (matchOp(".")) {
        const prop = consume();
        if (prop?.kind !== "ident") {
          return undefined;
        }
        const key = prop.value;
        const prev: Expression = target;
        target = (data) => {
          const obj = prev(data);
          if (obj === null || obj === undefined || blockedKeys.has(key)) {
            return undefined;
          }
          return (obj as Record<string, unknown>)[key];
        };
      } else if (matchOp("[")) {
        const keyExpr = parseTernary();
        if (keyExpr === undefined || !matchOp("]")) {
          return undefined;
        }
        const prev: Expression = target;
        target = (data) => {
          const obj = prev(data);
          const key = keyExpr(data);
          if (obj === null || obj === undefined || key === null || key === undefined) {
            return undefined;
          }
          const keyString = String(key as string | number);
          if (blockedKeys.has(keyString)) {
            return undefined;
          }
          return (obj as Record<string, unknown>)[keyString];
        };
      } else {
        break;
      }
    }
    return target;
  };

  const parsePrimary = (): Expression | undefined => {
    const token = consume();
    if (token === undefined) {
      return undefined;
    }
    if (token.kind === "number" || token.kind === "string") {
      return () => token.value;
    }
    if (token.kind === "ident") {
      if (token.value === "true") return () => true;
      if (token.value === "false") return () => false;
      if (token.value === "null") return () => null;
      if (token.value === "undefined") return () => undefined;
      const key = token.value;
      if (blockedKeys.has(key)) {
        return () => undefined;
      }
      return (data) => (Object.hasOwn(data, key) ? data[key] : undefined);
    }
    if (token.kind === "op" && token.value === "(") {
      const inner = parseTernary();
      return inner !== undefined && matchOp(")") ? inner : undefined;
    }
    if (token.kind === "op" && token.value === "[") {
      const items: Expression[] = [];
      if (!matchOp("]")) {
        while (true) {
          const item = parseTernary();
          if (item === undefined) {
            return undefined;
          }
          items.push(item);
          if (matchOp("]")) {
            break;
          }
          if (!matchOp(",")) {
            return undefined;
          }
        }
      }
      return (data) => items.map((item) => item(data));
    }
    if (token.kind === "op" && token.value === "{") {
      const entries: { readonly key: string; readonly value: Expression }[] = [];
      if (!matchOp("}")) {
        while (true) {
          const keyToken = consume();
          if (keyToken === undefined || (keyToken.kind !== "ident" && keyToken.kind !== "string")) {
            return undefined;
          }
          if (!matchOp(":")) {
            return undefined;
          }
          const value = parseTernary();
          if (value === undefined) {
            return undefined;
          }
          if (!blockedKeys.has(keyToken.value)) {
            entries.push({ key: keyToken.value, value });
          }
          if (matchOp("}")) {
            break;
          }
          if (!matchOp(",")) {
            return undefined;
          }
        }
      }
      return (data) => {
        const result: Data = {};
        for (const entry of entries) {
          result[entry.key] = entry.value(data);
        }
        return result;
      };
    }
    return undefined;
  };

  const parsed = parseTernary();
  if (parsed === undefined || cursor !== tokens.length) {
    return () => undefined;
  }
  return parsed;
}
