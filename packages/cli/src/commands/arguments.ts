import { pascalCase } from "change-case";
import parseCliArguments from "yargs-parser";
import { schematicNames } from "./command.constants.ts";
import type {
  AddCommandOptions,
  AgentClient,
  AgentCommandOptions,
  ApplicationType,
  BuildCommandOptions,
  CliCommand,
  DevCommandOptions,
  GenerateCommandOptions,
  GenerateSchematic,
  InfoCommandOptions,
  LibraryCommandOptions,
  NewCommandOptions,
  ResourceTransport,
  StartCommandOptions,
  TestRunner,
} from "../interfaces/command.interface.ts";

const schematicAliases: Readonly<Record<string, GenerateSchematic>> = {
  app: "app",
  "sub-app": "app",
  application: "application",
  config: "configuration",
  configuration: "configuration",
  update: "upgrade",
  upgrade: "upgrade",
  lib: "library",
  library: "library",
  mcp: "mcp",
  pl: "plugin",
  plugin: "plugin",
  cl: "class",
  class: "class",
  co: "controller",
  controller: "controller",
  route: "controller",
  router: "controller",
  routes: "controller",
  d: "decorator",
  decorator: "decorator",
  f: "filter",
  filter: "filter",
  ga: "gateway",
  gateway: "gateway",
  gu: "guard",
  guard: "guard",
  itf: "interface",
  interface: "interface",
  itc: "interceptor",
  interceptor: "interceptor",
  mi: "middleware",
  middleware: "middleware",
  mo: "module",
  module: "module",
  pi: "pipe",
  pipe: "pipe",
  pr: "provider",
  provider: "provider",
  r: "resolver",
  resolver: "resolver",
  res: "resource",
  resource: "resource",
  s: "service",
  service: "service",
};

const resourceTransports = new Set<string>([
  "rest",
  "graphql",
  "graphql-code-first",
  "graphql-schema-first",
  "microservice",
  "mvc",
  "ws",
]);

const applicationTypes = new Set<ApplicationType>(["bun", "esm", "cjs"]);
const testRunners = new Set<TestRunner>(["bun", "vitest", "jest"]);
const packageManagers = new Set(["bun", "npm", "pnpm", "yarn"]);

/**
 * Parses raw CLI arguments into a typed command.
 *
 * Driven by `yargs-parser` rather than hand-rolled parsing; flags that take
 * no value reject an attached value instead of ignoring it.
 *
 * @param arguments_ - The raw command-line arguments, without the binary name.
 * @returns The parsed command.
 * @throws A plain `Error` for an unknown command or an invalid flag value.
 *
 * @example
 * ```ts
 * parseArguments(["generate", "controller", "users"]);
 * ```
 */
export function parseArguments(arguments_: readonly string[]): CliCommand {
  const [command = "help", ...rest] = arguments_;

  if (command === "help" || command === "--help" || command === "-h") {
    return { command: "help" };
  }

  if (command === "version" || command === "--version" || command === "-v") {
    return { command: "version" };
  }

  if (command === "new" || command === "n") {
    return parseNewCommand(rest);
  }

  if (command === "generate" || command === "g") {
    return parseGenerateCommand(rest);
  }

  if (command === "update" || command === "upgrade") {
    return parseUpgradeCommand(rest);
  }

  if (command === "build") {
    return parseBuildCommand(rest);
  }

  if (command === "start") {
    return parseStartCommand(rest);
  }

  if (command === "info") {
    return parseInfoCommand(rest);
  }

  if (command === "add") {
    return parseAddCommand(rest);
  }

  if (command === "dev") {
    return parseDevCommand(rest);
  }

  if (command === "library") {
    return parseLibraryCommand(rest);
  }

  if (command === "manifest") {
    if (rest.length > 0) {
      throw new Error(`Unexpected argument "${rest[0]}".`);
    }
    return { command: "manifest" };
  }

  if (command === "agent") {
    return parseAgentCommand(rest);
  }

  throw new Error(`Unknown command "${command}".`);
}

function parseNewCommand(arguments_: readonly string[]): NewCommandOptions {
  const parsed = parseOptions(arguments_);
  const [name, ...extraPositionals] = parsed._;
  if (!name) {
    throw new Error("Project name is required.");
  }
  if (extraPositionals.length > 0) {
    throw new Error(`Unexpected argument "${extraPositionals[0]}".`);
  }

  assertKnownOptions(parsed, [
    "collection",
    "directory",
    "dry-run",
    "language",
    "minimal",
    "observe",
    "package-manager",
    "skip-git",
    "skip-install",
    "skip-skills",
    "skills",
    "strict",
    "test-runner",
    "type",
  ]);

  const type = readApplicationType(parsed);
  const testRunner = readTestRunner(parsed, type);
  const packageManager = readStringOption(parsed, "package-manager");
  if (packageManager !== undefined && !packageManagers.has(packageManager)) {
    throw new Error('Option "--package-manager" must be "bun", "npm", "pnpm", or "yarn".');
  }

  return {
    command: "new",
    name,
    directory: readStringOption(parsed, "directory"),
    dryRun: readBooleanOption(parsed, "dry-run", false),
    type,
    testRunner,
    minimal: readBooleanOption(parsed, "minimal", false),
    skipInstall: readBooleanOption(parsed, "skip-install", false),
    skipGit: readBooleanOption(parsed, "skip-git", false),
    ...(packageManager === undefined ? {} : { packageManager }),
    language: readLanguageOption(parsed),
    strict: readBooleanOption(parsed, "strict", true),
    collection: readStringOption(parsed, "collection"),
    observe: readOptionalBooleanOption(parsed, "observe"),
    skills: readClients(readStringOption(parsed, "skills")),
    skipSkills: readBooleanOption(parsed, "skip-skills", false),
  };
}

function parseGenerateCommand(arguments_: readonly string[]): GenerateCommandOptions {
  const parsed = parseOptions(arguments_);
  const [schematicName, name, ...extraPositionals] = parsed._;
  if (!schematicName) {
    throw new Error("Schematic name is required.");
  }

  const schematic = schematicAliases[schematicName];
  if (!schematic) {
    throw new Error(
      `Unknown schematic "${schematicName}". Available schematics: ${schematicNames.join(", ")}.`,
    );
  }
  const requiresName = schematic !== "upgrade" && schematic !== "configuration";
  if (requiresName && !name) {
    throw new Error(`${pascalCase(schematic)} name is required.`);
  }
  if (extraPositionals.length > 0) {
    throw new Error(`Unexpected argument "${extraPositionals[0]}".`);
  }

  assertKnownOptions(parsed, [
    "collection",
    "crud",
    "dry-run",
    "flat",
    "interactive",
    "language",
    "module",
    "observe",
    "path",
    "prefix",
    "publish",
    "project",
    "scope",
    "skip-import",
    "skip-install",
    "spec",
    "spec-file-suffix",
    "strict",
    "tag",
    "type",
  ]);

  const applicationType = schematic === "application" ? readApplicationType(parsed) : undefined;
  const type = applicationType === undefined ? readResourceTransport(parsed) : "rest";

  return {
    command: "generate",
    schematic,
    ...(name === undefined ? {} : { name }),
    dryRun: readBooleanOption(parsed, "dry-run", false),
    flat: readOptionalBooleanOption(parsed, "flat"),
    spec: readOptionalBooleanOption(parsed, "spec"),
    specFileSuffix: readStringOption(parsed, "spec-file-suffix"),
    skipImport: readBooleanOption(parsed, "skip-import", false),
    path: readStringOption(parsed, "path"),
    module: readStringOption(parsed, "module"),
    project: readStringOption(parsed, "project"),
    crud: readBooleanOption(parsed, "crud", true),
    type,
    ...(applicationType === undefined ? {} : { applicationType }),
    publish: readBooleanOption(parsed, "publish", false),
    scope: readStringOption(parsed, "scope"),
    prefix: readStringOption(parsed, "prefix"),
    skipInstall: readBooleanOption(parsed, "skip-install", false),
    language: readLanguageOption(parsed),
    strict: readOptionalBooleanOption(parsed, "strict"),
    collection: readStringOption(parsed, "collection"),
    interactive: readBooleanOption(parsed, "interactive", true),
    tag: readStringOption(parsed, "tag"),
  };
}

function parseUpgradeCommand(arguments_: readonly string[]): GenerateCommandOptions {
  const base = parseGenerateCommand(["upgrade", ...arguments_]);
  return { ...base, schematic: "upgrade", name: undefined };
}

function parseBuildCommand(arguments_: readonly string[]): BuildCommandOptions {
  const parsed = parseOptions(arguments_);
  const [positional, ...extraPositionals] = parsed._;
  if (extraPositionals.length > 0) {
    throw new Error(`Unexpected argument "${extraPositionals[0]}".`);
  }

  assertKnownOptions(parsed, [
    "all",
    "builder",
    "config",
    "dry-run",
    "emit-declarations",
    "path",
    "project",
    "rspack",
    "swc",
    "tsc",
    "type-check",
    "watch",
    "webpack",
  ]);

  const all = readBooleanOption(parsed, "all", false);
  const project = readStringOption(parsed, "project") ?? positional;
  if (all && project !== undefined) {
    throw new Error('Option "--all" cannot be combined with a project name.');
  }

  return {
    command: "build",
    dryRun: readBooleanOption(parsed, "dry-run", false),
    project,
    path: readStringOption(parsed, "path"),
    watch: readBooleanOption(parsed, "watch", false),
    builder: readBuilder(parsed),
    all,
    config: readStringOption(parsed, "config"),
    typeCheck: readOptionalBooleanOption(parsed, "type-check"),
    emitDeclarations: readBooleanOption(parsed, "emit-declarations", false),
  };
}

function parseAddCommand(arguments_: readonly string[]): AddCommandOptions {
  const parsed = parseOptions(arguments_);
  const [library, ...extra] = parsed._;
  if (!library) {
    throw new Error("A package name is required.");
  }
  if (extra.length > 0) {
    throw new Error(`Unexpected argument "${extra[0]}".`);
  }
  assertKnownOptions(parsed, ["dry-run", "skip-install"]);
  return {
    command: "add",
    library,
    dryRun: readBooleanOption(parsed, "dry-run", false),
    skipInstall: readBooleanOption(parsed, "skip-install", false),
  };
}

function parseDevCommand(arguments_: readonly string[]): DevCommandOptions {
  const parsed = parseOptions(arguments_);
  const [positional, ...extra] = parsed._;
  if (extra.length > 0) {
    throw new Error(`Unexpected argument "${extra[0]}".`);
  }

  assertKnownOptions(parsed, ["entry", "update-check"]);

  const updateCheck = readBooleanOption(parsed, "update-check", true);
  return {
    command: "dev",
    entry: positional ?? readStringOption(parsed, "entry") ?? "src/main.ts",
    ...(updateCheck ? {} : { updateCheck: false }),
  };
}

function parseStartCommand(arguments_: readonly string[]): StartCommandOptions {
  const parsed = parseOptions(arguments_);
  const [entry, ...extra] = parsed._;
  if (extra.length > 0) {
    throw new Error(`Unexpected argument "${extra[0]}".`);
  }
  assertKnownOptions(parsed, [
    "config",
    "cwd",
    "debug",
    "exec",
    "path",
    "prod",
    "project",
    "watch",
  ]);
  return {
    command: "start",
    cwd: readStringOption(parsed, "cwd"),
    ...(entry === undefined ? {} : { entry }),
    path: readStringOption(parsed, "path"),
    project: readStringOption(parsed, "project"),
    exec: readStringOption(parsed, "exec"),
    config: readStringOption(parsed, "config"),
    watch: readBooleanOption(parsed, "watch", false),
    debug: readBooleanOption(parsed, "debug", false),
    prod: readBooleanOption(parsed, "prod", false),
  };
}

function parseInfoCommand(arguments_: readonly string[]): InfoCommandOptions {
  const parsed = parseOptions(arguments_);
  if (parsed._.length > 0) {
    throw new Error(`Unexpected argument "${parsed._[0]}".`);
  }
  assertKnownOptions(parsed, ["cwd", "json"]);
  return {
    command: "info",
    json: readBooleanOption(parsed, "json", false),
    cwd: readStringOption(parsed, "cwd"),
  };
}

function parseLibraryCommand(arguments_: readonly string[]): LibraryCommandOptions {
  const parsed = parseOptions(arguments_);
  const [action, ...positionals] = parsed._;
  if (action !== "check" && action !== "new" && action !== "publish" && action !== "search") {
    throw new Error(
      'The library command requires the "new", "check", "publish", or "search" action.',
    );
  }
  if (positionals.length > 1) {
    throw new Error(`Unexpected argument "${positionals[1]}".`);
  }
  if (action === "new" && !positionals[0]) {
    throw new Error("Library name is required.");
  }
  assertKnownOptions(parsed, [
    "json",
    "kind",
    "path",
    "publish",
    "scope",
    "skip-install",
    "tag",
    "yes",
    "remote",
  ]);
  if (action !== "new" && parsed.kind !== undefined) {
    throw new Error('Option "--kind" is only valid with "library new".');
  }

  return {
    command: "library",
    action,
    path:
      action === "check" || action === "publish"
        ? (positionals[0] ?? readStringOption(parsed, "path"))
        : undefined,
    json: readBooleanOption(parsed, "json", false),
    publish: action === "check" ? readBooleanOption(parsed, "publish", false) : false,
    ...(action === "search" ? { query: positionals[0] ?? "" } : {}),
    ...(action === "new"
      ? {
          name: positionals[0],
          kind: readLibraryKind(parsed),
          scope: readStringOption(parsed, "scope"),
          skipInstall: readBooleanOption(parsed, "skip-install", false),
        }
      : {}),
    ...(action === "publish"
      ? { yes: readBooleanOption(parsed, "yes", false), tag: readStringOption(parsed, "tag") }
      : {}),
    ...(action === "search" ? { remote: readBooleanOption(parsed, "remote", false) } : {}),
  };
}

function parseAgentCommand(arguments_: readonly string[]): AgentCommandOptions {
  const parsed = parseOptions(arguments_);
  const [action, ...positionals] = parsed._;
  if (action !== "init") {
    throw new Error('The agent command requires the "init" action.');
  }
  if (positionals.length > 0) {
    throw new Error(`Unexpected argument "${positionals[0]}".`);
  }
  assertKnownOptions(parsed, ["clients", "cwd", "dry-run"]);
  const clients = readClients(readStringOption(parsed, "clients"));
  return {
    command: "agent",
    action: "init",
    clients,
    dryRun: readBooleanOption(parsed, "dry-run", false),
    cwd: readStringOption(parsed, "cwd"),
  };
}

interface ParsedOptions extends Readonly<Record<string, unknown>> {
  readonly _: readonly string[];
}

// The options that take no value. Declaring them in yargs-parser's `boolean`
// list keeps a bare flag, its short alias, and `--no-<flag>` meaning what they
// mean, and it keeps `aponia new --dry-run app` reading `app` as the project
// name: a declared boolean never consumes the token after it.
const valueLessOptions = [
  "all",
  "crud",
  "debug",
  "dry-run",
  "emit-declarations",
  "flat",
  "interactive",
  "json",
  "minimal",
  "observe",
  "prod",
  "publish",
  "rspack",
  "skip-git",
  "skip-import",
  "skip-install",
  "skip-skills",
  "spec",
  "strict",
  "swc",
  "tsc",
  "type-check",
  "update-check",
  "watch",
  "webpack",
] as const;

const optionAliases: Readonly<Record<string, string[]>> = {
  "dry-run": ["d"],
  project: ["p"],
  "skip-install": ["s"],
};

function readApplicationType(parsed: ParsedOptions): ApplicationType {
  const value = readStringOption(parsed, "type") ?? "bun";
  if (!applicationTypes.has(value as ApplicationType)) {
    throw new Error('Option "--type" must be "bun", "esm", or "cjs".');
  }
  return value as ApplicationType;
}

function readTestRunner(parsed: ParsedOptions, type: ApplicationType): TestRunner {
  const value =
    readStringOption(parsed, "test-runner") ??
    (type === "esm" ? "vitest" : type === "cjs" ? "jest" : "bun");
  if (!testRunners.has(value as TestRunner)) {
    throw new Error('Option "--test-runner" must be "bun", "vitest", or "jest".');
  }
  return value as TestRunner;
}

function readLanguageOption(parsed: ParsedOptions): string | undefined {
  const value = readStringOption(parsed, "language");
  if (value === undefined) {
    return undefined;
  }
  if (value === "typescript") {
    return "ts";
  }
  if (value === "javascript") {
    return "js";
  }
  if (value !== "ts" && value !== "js") {
    throw new Error('Option "--language" must be "ts" or "js".');
  }
  return value;
}

function readResourceTransport(parsed: ParsedOptions): ResourceTransport {
  const value = readStringOption(parsed, "type") ?? "rest";
  if (!resourceTransports.has(value)) {
    throw new Error(`Unknown resource transport "${value}".`);
  }
  return (value === "graphql" ? "graphql-code-first" : value) as ResourceTransport;
}

function readBuilder(parsed: ParsedOptions): string | undefined {
  const explicit = readStringOption(parsed, "builder");
  const flags = ["tsc", "swc", "webpack", "rspack"].filter((builder) =>
    readBooleanOption(parsed, builder, false),
  );
  if (flags.length > 1) {
    throw new Error(`Use one builder flag at a time; received ${flags.join(", ")}.`);
  }
  const builder = explicit ?? flags[0];
  if (builder === "webpack" || builder === "rspack") {
    throw new Error(
      `The "${builder}" builder is not supported by the Aponia CLI. Use "tsc" or "swc": both map to the workspace's Bun/Vite+ build.`,
    );
  }
  if (builder !== undefined && builder !== "tsc" && builder !== "swc") {
    throw new Error(`Unknown builder "${builder}". Use "tsc" or "swc".`);
  }
  return builder;
}

function readClients(value: string | undefined): readonly AgentClient[] {
  if (value === undefined) {
    return Object.freeze(["codex", "claude", "cursor"]);
  }
  const clients = value
    .split(",")
    .map((client) => client.trim())
    .filter(Boolean);
  const expanded = clients.flatMap((client) =>
    client === "all" || client === "agents" ? ["codex", "claude", "cursor"] : [client],
  );
  const valid = new Set<AgentClient>(["codex", "claude", "cursor"]);
  for (const client of expanded) {
    if (!valid.has(client as AgentClient)) {
      throw new Error(`Unknown agent client "${client}".`);
    }
  }
  return Object.freeze([...new Set(expanded as AgentClient[])]);
}

// The option a spelling names, when that option takes no value.
function valueLessOptionFor(spelling: string): string | undefined {
  return valueLessOptions.find((option) => {
    const aliases: readonly string[] = optionAliases[option] ?? [];
    return option === spelling || aliases.includes(spelling);
  });
}

// Declaring a boolean also makes yargs-parser coerce the value attached to it:
// `--dry-run=abc` used to arrive as `dryRun: false`. The attached spelling is
// rejected here, before the parser reads it, while the space form is left alone
// so a flag in any position keeps its meaning.
function assertNoAttachedValue(arguments_: readonly string[]): void {
  for (const argument of arguments_) {
    const attached = /^--?([^=]+)=([\s\S]*)$/.exec(argument);
    if (attached === null) {
      continue;
    }
    const option = valueLessOptionFor(attached[1]);
    if (option !== undefined) {
      // The attached text is a value, which this option does not accept.
      readBooleanFlagValue(option, attached[2]);
    }
  }
}

function parseOptions(arguments_: readonly string[]): ParsedOptions {
  assertNoAttachedValue(arguments_);

  return parseCliArguments([...arguments_], {
    alias: optionAliases,
    boolean: [...valueLessOptions],
    string: [
      "builder",
      "clients",
      "collection",
      "config",
      "cwd",
      "directory",
      "entry",
      "exec",
      "kind",
      "language",
      "module",
      "package-manager",
      "path",
      "prefix",
      "project",
      "scope",
      "spec-file-suffix",
      "tag",
      "test-runner",
      "type",
    ],
    configuration: {
      "camel-case-expansion": false,
      "dot-notation": false,
      "duplicate-arguments-array": false,
      "parse-numbers": false,
      "parse-positional-numbers": false,
      "short-option-groups": false,
      "strip-aliased": true,
    },
  }) as ParsedOptions;
}

function assertKnownOptions(options: ParsedOptions, supportedOptions: readonly string[]): void {
  const supported = new Set(supportedOptions);
  const unknown = Object.keys(options).find((option) => option !== "_" && !supported.has(option));
  if (unknown) {
    throw new Error(`Unknown option "--${unknown}".`);
  }
}

function readBooleanOption(options: ParsedOptions, name: string, fallback: boolean): boolean {
  return readOptionalBooleanOption(options, name) ?? fallback;
}

// An option that takes no value yields a boolean, and any other value is one it
// rejects by name. `assertNoAttachedValue` feeds this the attached spelling and
// `readOptionalBooleanOption` feeds it what the parser produced, so the rule and
// its message live in one place.
function readBooleanFlagValue(option: string, value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Option "--${option}" does not accept a value.`);
  }
  return value;
}

function readOptionalBooleanOption(options: ParsedOptions, name: string): boolean | undefined {
  const value = options[name];
  return value === undefined ? undefined : readBooleanFlagValue(name, value);
}

function readStringOption(options: ParsedOptions, name: string): string | undefined {
  const value = options[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Option "--${name}" requires a value.`);
  }
  return value;
}

function readLibraryKind(options: ParsedOptions): "module" | "plugin" | undefined {
  const value = readStringOption(options, "kind");
  if (value === undefined) {
    return undefined;
  }
  if (value !== "module" && value !== "plugin") {
    throw new Error('The library kind must be "module" or "plugin".');
  }
  return value;
}
