import { pascalCase } from "change-case";
import parseCliArguments from "yargs-parser";
import { generateSchematics } from "./command.constants.ts";
import type {
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

const resourceTransports = new Set<ResourceTransport>([
  "rest",
  "graphql-code-first",
  "graphql-schema-first",
  "microservice",
  "ws",
]);

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
      `Unknown schematic "${schematicName}". Available schematics: ${generateSchematics.join(", ")}.`,
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

function parseOptions(arguments_: readonly string[]): ParsedOptions {
  return parseCliArguments([...arguments_], {
    alias: {
      "dry-run": ["d"],
      project: ["p"],
      "skip-install": ["s"],
    },
    boolean: ["crud", "dry-run", "flat", "skip-import", "skip-install", "spec"],
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

function readOptionalBooleanOption(options: ParsedOptions, name: string): boolean | undefined {
  const value = options[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`Option "--${name}" does not accept a value.`);
  }
  return value;
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
