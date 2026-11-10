import type { ViewEngine } from "@aponiajs/common";
import { resolve } from "node:path";

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
    (this.#shared as Record<string, unknown>)[key] = value;
  }

  async render(
    template: string,
    data: Data,
    options?: { readonly layout?: string; readonly fragment?: boolean },
  ): Promise<string> {
    return await this.#renderTemplate(template, { ...this.#shared, ...data }, options, 0);
  }

  async #renderTemplate(
    template: string,
    data: Data,
    options: { readonly layout?: string; readonly fragment?: boolean } | undefined,
    depth: number,
    inheritedSections?: Map<string, string>,
  ): Promise<string> {
    if (this.#active.has(template)) {
      throw new Error(`Blade template "${template}" includes itself.`);
    }
    this.#active.add(template);
    try {
      return await this.#renderTemplateInner(template, data, options, depth, inheritedSections);
    } finally {
      this.#active.delete(template);
    }
  }

  async #renderTemplateInner(
    template: string,
    data: Data,
    options: { readonly layout?: string; readonly fragment?: boolean } | undefined,
    depth: number,
    inheritedSections?: Map<string, string>,
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

    body = await this.#extractSections(body, data, sections);
    let rendered = await this.#renderSource(body, data, sections);

    if (options?.fragment) {
      return sections.get("content") ?? rendered;
    }

    if (layout !== undefined) {
      if (sections.size === 0) {
        sections.set("content", rendered);
      } else if (!sections.has("content")) {
        sections.set("content", rendered);
      }
      const layoutData: Data = { ...data };
      for (const [name, value] of sections) {
        layoutData[name] = value;
      }
      layoutData.sections = Object.fromEntries(sections);
      layoutData.content = sections.get("content") ?? rendered;
      rendered = await this.#renderTemplate(layout, layoutData, undefined, depth + 1, sections);
    }

    return rendered;
  }

  async #extractSections(
    source: string,
    data: Data,
    sections: Map<string, string>,
  ): Promise<string> {
    let result = source;
    const block = /@section\s*\(\s*['"]([^'"]+)['"]\s*\)([\s\S]*?)@endsection/g;
    const replacements: { full: string; name: string; content: string }[] = [];
    for (const match of result.matchAll(block)) {
      replacements.push({ full: match[0], name: match[1]!, content: match[2] ?? "" });
    }
    for (const replacement of replacements) {
      sections.set(replacement.name, await this.#renderSource(replacement.content, data, sections));
      result = result.replace(replacement.full, "");
    }

    const inline = /@section\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([\s\S]*?)['"]\s*\)/g;
    for (const match of result.matchAll(inline)) {
      sections.set(match[1]!, match[2] ?? "");
    }
    result = result.replace(inline, "");

    return result;
  }

  async #renderSource(source: string, data: Data, sections: Map<string, string>): Promise<string> {
    let result = source;

    result = await this.#renderBlocks(result, data, sections);
    result = await this.#renderIncludes(result, data);
    result = await this.#renderComponents(result, data, sections);
    result = this.#renderYields(result, sections, data);
    result = this.#renderEchoes(result, data);

    return result;
  }

  async #renderBlocks(source: string, data: Data, sections: Map<string, string>): Promise<string> {
    let result = source;

    result = await replaceAsync(
      result,
      /@if\s*\(([\s\S]*?)\)\s*([\s\S]*?)@endif/g,
      async (_match, expression: string, inner: string) => {
        const [truthy, falsy] = splitElse(inner);
        const branch = this.#evaluate(expression.trim(), data) ? truthy : falsy;
        return await this.#renderSource(branch, data, sections);
      },
    );

    result = await replaceAsync(
      result,
      /@unless\s*\(([\s\S]*?)\)\s*([\s\S]*?)@endunless/g,
      async (_match, expression: string, inner: string) => {
        const branch = this.#evaluate(expression.trim(), data) ? "" : inner;
        return await this.#renderSource(branch, data, sections);
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
          entries.push(...Object.entries(iterable as Record<string, unknown>));
        }
        let output = "";
        for (const [key, item] of entries) {
          const scope: Data = { ...data, [itemName]: item };
          if (keyName !== undefined) {
            scope[keyName] = key;
          }
          output += await this.#renderSource(inner, scope, sections);
        }
        return output;
      },
    );

    return result;
  }

  async #renderIncludes(source: string, data: Data): Promise<string> {
    return await replaceAsync(
      source,
      /@include\s*\(\s*['"]([^'"]+)['"]\s*(?:,\s*([\s\S]*?))?\)/g,
      async (_match, name: string, expression: string | undefined) => {
        const extra = expression === undefined ? {} : this.#evaluateObject(expression, data);
        return await this.#renderTemplate(name, { ...data, ...extra }, undefined, 0);
      },
    );
  }

  async #renderComponents(
    source: string,
    data: Data,
    sections: Map<string, string>,
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
      const props = this.#parseAttributes(attrs ?? "", data);
      const slot = inner === undefined ? "" : await this.#renderSource(inner, data, sections);
      const component = await this.#renderTemplate(
        `components/${name}`,
        { ...data, ...props, slot },
        undefined,
        0,
      );
      result = result.replace(full, component);
    }

    throw new Error("Blade component nesting exceeded the supported depth.");
  }

  #renderYields(source: string, sections: Map<string, string>, data: Data): string {
    return source.replace(
      /@yield\s*\(\s*['"]([^'"]+)['"](?:\s*,\s*(['"])([\s\S]*?)\2)?\s*\)/g,
      (_match, name: string, _quote: string | undefined, fallback: string | undefined) =>
        sections.get(name) ?? (fallback === undefined ? "" : this.#resolveString(fallback, data)),
    );
  }

  #renderEchoes(source: string, data: Data): string {
    return source
      .replace(/\{!!\s*([\s\S]*?)\s*!!\}/g, (_match, expression: string) =>
        this.#stringify(this.#evaluate(expression.trim(), data)),
      )
      .replace(/\{\{\s*([\s\S]*?)\s*\}\}/g, (_match, expression: string) =>
        escapeHtml(this.#stringify(this.#evaluate(expression.trim(), data))),
      );
  }

  #parseAttributes(source: string, data: Data): Data {
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
      props[name] = bound ? this.#evaluate(value, data) : this.#resolveString(value, data);
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

  #resolveString(value: string, data: Data): string {
    return value.replace(/\{\{\s*([\s\S]*?)\s*\}\}/g, (_match, expression: string) =>
      this.#stringify(this.#evaluate(expression.trim(), data)),
    );
  }

  #evaluate(expression: string, data: Data): unknown {
    const normalized = expression.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, "$1");
    let compiled = this.#expressions.get(normalized);
    if (compiled === undefined) {
      // Blade expressions are developer-authored templates, compiled once and cached.
      // oxlint-disable-next-line typescript/no-implied-eval
      compiled = new Function(
        "data",
        `with (data) { try { return (${normalized}); } catch { return undefined; } }`,
      ) as Expression;
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
