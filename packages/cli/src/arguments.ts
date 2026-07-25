export interface NewCommandOptions {
  readonly command: "new";
  readonly name: string;
  readonly dryRun: boolean;
  readonly skipInstall: boolean;
}

export const generateSchematics = [
  "app",
  "library",
  "class",
  "controller",
  "decorator",
  "filter",
  "gateway",
  "guard",
  "interface",
  "interceptor",
  "middleware",
  "module",
  "pipe",
  "provider",
  "resolver",
  "resource",
  "service",
] as const;

export type GenerateSchematic = (typeof generateSchematics)[number];

export type ResourceTransport =
  | "rest"
  | "graphql-code-first"
  | "graphql-schema-first"
  | "microservice"
  | "ws";

export interface GenerateCommandOptions {
  readonly command: "generate";
  readonly schematic: GenerateSchematic;
  readonly name: string;
  readonly dryRun: boolean;
  readonly flat?: boolean;
  readonly spec?: boolean;
  readonly skipImport: boolean;
  readonly path?: string;
  readonly module?: string;
  readonly project?: string;
  readonly crud: boolean;
  readonly type: ResourceTransport;
}

export type CliCommand =
  | NewCommandOptions
  | GenerateCommandOptions
  | { readonly command: "help" }
  | { readonly command: "version" };

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
  const { options, positionals } = tokenize(arguments_);
  const [name, ...extraPositionals] = positionals;
  if (!name) {
    throw new Error("Project name is required.");
  }
  if (extraPositionals.length > 0) {
    throw new Error(`Unexpected argument "${extraPositionals[0]}".`);
  }

  assertKnownOptions(options, ["dry-run", "skip-install"]);

  return {
    command: "new",
    name,
    dryRun: readBooleanOption(options, "dry-run", false),
    skipInstall: readBooleanOption(options, "skip-install", false),
  };
}

function parseGenerateCommand(arguments_: readonly string[]): GenerateCommandOptions {
  const { options, positionals } = tokenize(arguments_);
  const [schematicName, name, ...extraPositionals] = positionals;
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
    throw new Error(`${titleCase(schematic)} name is required.`);
  }
  if (extraPositionals.length > 0) {
    throw new Error(`Unexpected argument "${extraPositionals[0]}".`);
  }

  assertKnownOptions(options, [
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

  const type = readStringOption(options, "type") ?? "rest";
  if (!resourceTransports.has(type as ResourceTransport)) {
    throw new Error(`Unknown resource transport "${type}".`);
  }

  return {
    command: "generate",
    schematic,
    name,
    dryRun: readBooleanOption(options, "dry-run", false),
    flat: readOptionalBooleanOption(options, "flat"),
    spec: readOptionalBooleanOption(options, "spec"),
    skipImport: readBooleanOption(options, "skip-import", false),
    path: readStringOption(options, "path"),
    module: readStringOption(options, "module"),
    project: readStringOption(options, "project"),
    crud: readBooleanOption(options, "crud", true),
    type: type as ResourceTransport,
  };
}

interface TokenizedArguments {
  readonly options: ReadonlyMap<string, string | boolean>;
  readonly positionals: readonly string[];
}

function tokenize(arguments_: readonly string[]): TokenizedArguments {
  const options = new Map<string, string | boolean>();
  const positionals: string[] = [];

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (!argument?.startsWith("-")) {
      if (argument) {
        positionals.push(argument);
      }
      continue;
    }

    const normalized = normalizeOption(argument);
    if (normalized.inlineValue !== undefined) {
      options.set(normalized.name, normalized.inlineValue);
      continue;
    }

    if (normalized.negated) {
      options.set(normalized.name, false);
      continue;
    }

    const next = arguments_[index + 1];
    if (isValueOption(normalized.name) && next && !next.startsWith("-")) {
      options.set(normalized.name, next);
      index += 1;
      continue;
    }

    options.set(normalized.name, true);
  }

  return { options, positionals };
}

function normalizeOption(argument: string): {
  readonly name: string;
  readonly negated: boolean;
  readonly inlineValue?: string;
} {
  const aliases: Readonly<Record<string, string>> = {
    "-d": "dry-run",
    "-p": "project",
    "-s": "skip-install",
  };
  const [rawName, inlineValue] = argument.split("=", 2);
  const withoutPrefix = aliases[rawName ?? ""] ?? rawName?.replace(/^--/, "");
  const negated = withoutPrefix?.startsWith("no-") ?? false;

  return {
    name: negated ? withoutPrefix!.slice(3) : (withoutPrefix ?? ""),
    negated,
    inlineValue,
  };
}

function isValueOption(name: string): boolean {
  return name === "module" || name === "path" || name === "project" || name === "type";
}

function assertKnownOptions(
  options: ReadonlyMap<string, string | boolean>,
  supportedOptions: readonly string[],
): void {
  const supported = new Set(supportedOptions);
  const unknown = [...options.keys()].find((option) => !supported.has(option));
  if (unknown) {
    throw new Error(`Unknown option "--${unknown}".`);
  }
}

function readBooleanOption(
  options: ReadonlyMap<string, string | boolean>,
  name: string,
  fallback: boolean,
): boolean {
  return readOptionalBooleanOption(options, name) ?? fallback;
}

function readOptionalBooleanOption(
  options: ReadonlyMap<string, string | boolean>,
  name: string,
): boolean | undefined {
  const value = options.get(name);
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`Option "--${name}" does not accept a value.`);
  }
  return value;
}

function readStringOption(
  options: ReadonlyMap<string, string | boolean>,
  name: string,
): string | undefined {
  const value = options.get(name);
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Option "--${name}" requires a value.`);
  }
  return value;
}

function titleCase(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
