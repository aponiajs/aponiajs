import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { camelCase, kebabCase, pascalCase } from "change-case";
import { singularize } from "inflection";
import type { SchematicFactory, SchematicFile, SchematicOptions } from "./schematic.types.ts";

/** What one schematic's template set needs to know about the invocation. */
export interface SchematicFactoryDefinition {
  /** The schematic name, used in error messages. */
  readonly schematic: string;
  /**
   * The template directory under `files/` to render when the definition does
   * not compute one itself. Omit it when the schematic ships one directory per
   * language, which is the upstream default.
   */
  readonly defaultTemplateDirectory?: string;
  /**
   * Selects the template directory for an invocation; the application
   * schematic chooses by module system and minimal layout.
   */
  readonly templateDirectory?: (options: SchematicOptions) => string;
  /** The languages the schematic's template set provides; omit for both. */
  readonly supportedLanguages?: readonly string[];
  /** The message a refused language reports; defaults to the generic one. */
  readonly unsupportedLanguageMessage?: string;
  /** Whether the schematic requires a name; a configuration does not. */
  readonly requiresName?: boolean;
  /**
   * Whether the schematic nests its output under the declared name when
   * `flat` is absent, as every component schematic does.
   */
  readonly nestByName?: boolean;
}

/**
 * Builds the plain-function factory one `collection.json` entry names.
 *
 * The Aponia collection contract is a function that returns the files it plans,
 * so the CLI can run a collection without an `@angular-devkit/schematics`
 * dependency. The definition only selects templates; rendering rules live
 * here once.
 *
 * @param definition - The schematic name and its template selection.
 * @returns A factory that renders the declared template set.
 */
export function createSchematicFactory(definition: SchematicFactoryDefinition): SchematicFactory {
  return async (options) => {
    const requestedName = options.name?.trim();
    if (!requestedName && definition.requiresName !== false) {
      throw new Error(`Schematic "${definition.schematic}" requires a name.`);
    }
    const name = requestedName ?? "";

    const language = options.language ?? "ts";
    if (
      definition.supportedLanguages !== undefined &&
      !definition.supportedLanguages.includes(language)
    ) {
      const message =
        language === "js" && definition.unsupportedLanguageMessage !== undefined
          ? definition.unsupportedLanguageMessage
          : `Schematic "${definition.schematic}" does not support "${language}".`;
      throw new Error(message);
    }
    if (language !== "ts" && language !== "js") {
      throw new Error(`Schematic "${definition.schematic}" does not support "${language}".`);
    }
    const specFileSuffix = options.specFileSuffix ?? "spec";
    const directory =
      definition.templateDirectory?.(options) ??
      join("files", definition.defaultTemplateDirectory ?? language);
    const templateRoot = join(import.meta.dir, definition.schematic, directory);
    const outputRoot = resolveOutputRoot(definition, name, options);
    const files = await renderTemplates({
      templateRoot,
      outputRoot,
      name,
      spec: options.spec !== false,
      specFileSuffix,
      options,
    });

    return { files };
  };
}

function resolveOutputRoot(
  definition: SchematicFactoryDefinition,
  name: string,
  options: SchematicOptions,
): string {
  const base = options.path ?? "";
  if (definition.nestByName !== true || options.flat === true) {
    return base;
  }
  return join(base, kebabCase(name));
}

/** @internal */
export interface RenderTemplatesOptions {
  readonly templateRoot: string;
  readonly outputRoot: string;
  readonly name: string;
  readonly spec: boolean;
  readonly specFileSuffix: string;
  readonly options: SchematicOptions;
}

async function renderTemplates(render: RenderTemplatesOptions): Promise<readonly SchematicFile[]> {
  const entries = await listFiles(render.templateRoot);
  const files: SchematicFile[] = [];

  for (const entry of entries) {
    const relative = entry.slice(render.templateRoot.length + 1);
    if (shouldSkipTemplate(relative, render)) {
      continue;
    }

    const content = await Bun.file(entry).text();
    const path = join(render.outputRoot, resolveFileName(relative, render));
    files.push({ path, content: renderTemplate(content, render) });
  }

  return files;
}

/**
 * Whether one template file is left out of this invocation.
 *
 * The upstream schematics drop the test runner's setup along with the specs,
 * because a config file with nothing to run reads as an invitation to write
 * tests, and they only emit `CLAUDE.md` for the agent targets that asked for
 * it. Both decisions are per invocation, so they are made here rather than by
 * shipping a second template set.
 */
function shouldSkipTemplate(relative: string, render: RenderTemplatesOptions): boolean {
  const path = `/${relative.replaceAll("\\", "/").replace(/\.tmpl$/, "")}`;
  if (path.endsWith("/CLAUDE.md") && !claudeRequested(render.options.skills)) {
    return true;
  }
  if (render.spec) {
    return false;
  }
  const language = render.options.language ?? "ts";
  return (
    path.includes("__specFileSuffix__") ||
    path.startsWith("/test/") ||
    path.includes(`.spec.${language}`) ||
    /^\/(jest|vitest)\.config(\.e2e)?\.(ts|js)$/.test(path)
  );
}

function claudeRequested(skills: readonly string[] | undefined): boolean {
  return (skills ?? []).some((skill) => skill === "all" || skill === "claude");
}

function resolveFileName(relative: string, render: RenderTemplatesOptions): string {
  return relative
    .replaceAll("__name@singular@ent__", `${singularize(kebabCase(render.name))}.entity`)
    .replaceAll("__name@singular__", singularize(kebabCase(render.name)))
    .replaceAll("__name__", kebabCase(render.name))
    .replaceAll("__specFileSuffix__", render.specFileSuffix)
    .replace(/\.tmpl$/, "")
    .replace(/\.template$/, "");
}

/** @internal */
export function renderTemplate(content: string, render: RenderTemplatesOptions): string {
  const values = createTemplateValues(render);
  const rendered = applyControlBlocks(content, render);
  return rendered.replace(/<%=\s*([\s\S]*?)\s*%>/g, (_match, expression: string) => {
    const key = normalizeExpression(expression);
    const value = values[key];
    if (value === undefined) {
      throw new Error(`Unsupported template expression "${key}".`);
    }
    return value;
  });
}

function normalizeExpression(expression: string): string {
  return expression.trim().replace(/\s+/g, " ");
}

/**
 * The values the upstream templates ask for.
 *
 * `lowercased` is the resource schematic's own override, not a plain
 * lower-casing: it classifies first, so `lowercased(name)` reads
 * `userProfiles` for a `user-profiles` resource. `singular` uses the
 * inflection package on the kebab-case name the template receives.
 */
function createTemplateValues(render: RenderTemplatesOptions): Readonly<Record<string, string>> {
  const name = render.name;
  const isEsm = render.options.isEsm === true || render.options.type === "esm";
  return {
    "classify(name)": pascalCase(name),
    "singular(classify(name))": singularize(pascalCase(name)),
    "lowercased(singular(classify(name)))": lowercased(singularize(pascalCase(name))),
    "lowercased(classify(name))": lowercased(pascalCase(name)),
    "lowercased(name)": lowercased(pascalCase(name)),
    "singular(name)": singularize(kebabCase(name)),
    "camelize(name)": camelCase(name),
    "dasherize(name)": kebabCase(name),
    name: kebabCase(name),
    "classify(className)": pascalCase(name),
    "isEsm ? '.js' : ''": isEsm ? ".js" : "",
    "isEsm ? 'await ' : 'void '": isEsm ? "await " : "void ",
    "minimal ? 'src/main.ts' : 'src/app.module.ts'": render.options.minimal
      ? "src/main.ts"
      : "src/app.module.ts",
    "skills.join(',')": (render.options.skills ?? []).join(","),
    specFileSuffix: render.specFileSuffix,
    sourceRoot: render.options.sourceRoot ?? "src",
    entryFile: "main",
    packageManager: render.options.packageManager ?? "bun",
    description: render.options.description ?? "",
    author: render.options.author ?? "",
    version: render.options.version ?? "0.0.1",
    strict: render.options.strict === false ? "false" : "true",
    collection: render.options.collection ?? "@aponiajs/schematics",
    language: render.options.language ?? "ts",
  };
}

function lowercased(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

/** @internal */
export function applyControlBlocks(content: string, render: RenderTemplatesOptions): string {
  const parts = content.split(/(<%[\s\S]*?%>)/g);
  interface Frame {
    readonly parentActive: boolean;
    readonly condition: boolean;
  }
  const stack: Frame[] = [];
  let active = true;
  let output = "";

  for (const part of parts) {
    const match = /^<%([\s\S]*?)%>$/.exec(part);
    if (match === null) {
      if (active) {
        output += part;
      }
      continue;
    }

    const inner = (match[1] ?? "").trim();
    if (inner.startsWith("=")) {
      if (active) {
        output += part;
      }
      continue;
    }
    if (inner.startsWith("#")) {
      continue;
    }
    if (inner.startsWith("if ")) {
      const condition = evaluateCondition(inner.slice(3, -1).trim(), render);
      stack.push({ parentActive: active, condition });
      active = active && condition;
      continue;
    }
    if (inner.startsWith("} else if ")) {
      const frame = stack.pop();
      if (frame === undefined) {
        throw new Error('Template directive "} else if" has no open condition.');
      }
      const condition = evaluateCondition(inner.slice("} else if ".length, -1).trim(), render);
      stack.push({ parentActive: frame.parentActive, condition });
      active = frame.parentActive && condition;
      continue;
    }
    if (inner === "} else {") {
      const frame = stack.pop();
      if (frame === undefined) {
        throw new Error('Template directive "} else" has no open condition.');
      }
      const condition = !frame.condition;
      stack.push({ parentActive: frame.parentActive, condition });
      active = frame.parentActive && condition;
      continue;
    }
    if (inner === "}") {
      const frame = stack.pop();
      if (frame === undefined) {
        throw new Error('Template directive "}" has no open condition.');
      }
      active = frame.parentActive;
      continue;
    }
    throw new Error(`Unsupported template directive "<%${inner}%>".`);
  }

  return output;
}

/** @internal */
export function evaluateCondition(expression: string, render: RenderTemplatesOptions): boolean {
  const options = render.options;
  const type = options.type ?? "rest";
  const conditions: Readonly<Record<string, boolean>> = {
    spec: options.spec !== false,
    observe: options.observe === true,
    crud: options.crud !== false,
    minimal: options.minimal === true,
    "!minimal": options.minimal !== true,
    isEsm: options.isEsm === true || options.type === "esm",
    isSwaggerInstalled: false,
    "skills.length": (options.skills?.length ?? 0) > 0,
    "(skills.length)": (options.skills?.length ?? 0) > 0,
    "type === 'rest'": type === "rest",
    "type === 'ws'": type === "ws",
    "type === 'graphql-code-first'": type === "graphql-code-first",
    "type === 'graphql-schema-first'": type === "graphql-schema-first",
    "type === 'microservice'": type === "microservice",
    "type !== 'graphql-code-first'": type !== "graphql-code-first",
    "type !== 'graphql-schema-first'": type !== "graphql-schema-first",
    "crud && type === 'graphql-code-first'":
      options.crud !== false && type === "graphql-code-first",
    "crud && type === 'graphql-schema-first'":
      options.crud !== false && type === "graphql-schema-first",
    "crud && type === 'rest'": options.crud !== false && type === "rest",
    "type === 'rest' && crud": type === "rest" && options.crud !== false,
    "type === 'graphql-code-first' && crud":
      type === "graphql-code-first" && options.crud !== false,
    "type === 'microservice' && crud": type === "microservice" && options.crud !== false,
    "crud && type === 'microservice'": options.crud !== false && type === "microservice",
    "crud && type === 'ws'": options.crud !== false && type === "ws",
    "crud && type !== 'graphql-code-first' && type !== 'graphql-schema-first'":
      options.crud !== false && type !== "graphql-code-first" && type !== "graphql-schema-first",
    "(type === 'microservice' || type === 'ws') && crud":
      (type === "microservice" || type === "ws") && options.crud !== false,
    "type === 'rest' || type === 'microservice'": type === "rest" || type === "microservice",
    "type !== 'graphql-code-first' && type !== 'graphql-schema-first'":
      type !== "graphql-code-first" && type !== "graphql-schema-first",
    "type === 'graphql-code-first' || type === 'graphql-schema-first'":
      type === "graphql-code-first" || type === "graphql-schema-first",
  };
  const normalized = stripOuterParentheses(expression);
  if (normalized.startsWith("!")) {
    return !evaluateCondition(normalized.slice(1).trim(), render);
  }
  const value = conditions[normalized];
  if (value === undefined) {
    throw new Error(`Unsupported template condition "${expression}".`);
  }
  return value;
}

function stripOuterParentheses(expression: string): string {
  return expression.startsWith("(") && expression.endsWith(")")
    ? expression.slice(1, -1).trim()
    : expression;
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? listFiles(path) : [path];
      }),
  );
  return files.flat();
}
