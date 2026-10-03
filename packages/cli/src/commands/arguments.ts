import { pascalCase } from "change-case";
import parseCliArguments from "yargs-parser";
import { schematicNames } from "./command.constants.ts";
import type {
  BuildCommandOptions,
  CliCommand,
  GenerateCommandOptions,
  GenerateSchematic,
  NewCommandOptions,
  ResourceTransport,
} from "./command.types.ts";

const schematicAliases: Readonly<Record<string, GenerateSchematic>> = {
  app: "app",
  application: "app",
  lib: "library",
  library: "library",
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
  mo: "module",
  module: "module",
  pr: "provider",
  provider: "provider",
  r: "resolver",
  resolver: "resolver",
  res: "resource",
  resource: "resource",
  s: "service",
  service: "service",
};

const resourceTransports = new Set<ResourceTransport>([
  "rest",
  "graphql-code-first",
  "graphql-schema-first",
  "microservice",
  "ws",
]);

/**
 * Parses raw CLI arguments into a typed command.
 *
 * Driven by `yargs-parser` rather than hand-rolled parsing; flags that take
 * no value reject an attached value instead of ignoring it.
 *
 * @param arguments_ - The raw command-line arguments, without the binary name.
 * @returns The parsed command: `new`, `generate`, `build`, `help`, or `version`.
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

  if (command === "build") {
    return parseBuildCommand(rest);
  }

  throw new Error(`Unknown command "${command}".`);
}

function parseBuildCommand(arguments_: readonly string[]): BuildCommandOptions {
  const parsed = parseOptions(arguments_);
  const [extraPositional] = parsed._;
  if (extraPositional !== undefined) {
    throw new Error(`Unexpected argument "${extraPositional}".`);
  }

  assertKnownOptions(parsed, ["dry-run", "project"]);

  return {
    command: "build",
    dryRun: readBooleanOption(parsed, "dry-run", false),
    project: readStringOption(parsed, "project"),
  };
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

  assertKnownOptions(parsed, ["dry-run", "skip-install"]);

  return {
    command: "new",
    name,
    dryRun: readBooleanOption(parsed, "dry-run", false),
    skipInstall: readBooleanOption(parsed, "skip-install", false),
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
  if (!name) {
    throw new Error(`${pascalCase(schematic)} name is required.`);
  }
  if (extraPositionals.length > 0) {
    throw new Error(`Unexpected argument "${extraPositionals[0]}".`);
  }

  assertKnownOptions(parsed, [
    "crud",
    "dry-run",
    "flat",
    "module",
    "path",
    "project",
    "skip-import",
    "spec",
    "type",
  ]);

  const type = readStringOption(parsed, "type") ?? "rest";
  if (!resourceTransports.has(type as ResourceTransport)) {
    throw new Error(`Unknown resource transport "${type}".`);
  }

  return {
    command: "generate",
    schematic,
    name,
    dryRun: readBooleanOption(parsed, "dry-run", false),
    flat: readOptionalBooleanOption(parsed, "flat"),
    spec: readOptionalBooleanOption(parsed, "spec"),
    skipImport: readBooleanOption(parsed, "skip-import", false),
    path: readStringOption(parsed, "path"),
    module: readStringOption(parsed, "module"),
    project: readStringOption(parsed, "project"),
    crud: readBooleanOption(parsed, "crud", true),
    type: type as ResourceTransport,
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
  "crud",
  "dry-run",
  "flat",
  "skip-import",
  "skip-install",
  "spec",
] as const;

const optionAliases: Readonly<Record<string, string[]>> = {
  "dry-run": ["d"],
  project: ["p"],
  "skip-install": ["s"],
};

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
    string: ["module", "path", "project", "type"],
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
