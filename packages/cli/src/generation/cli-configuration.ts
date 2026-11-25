import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  configurationFileName,
  legacyConfigurationFileName,
} from "./cli-configuration.constants.ts";
import {
  type AponiaBuilder,
  type AponiaCliConfiguration,
  type AponiaCompilerOptions,
  type AponiaGenerateOptions,
  type ConfigurationSource,
  type LoadedCliConfiguration,
} from "../interfaces/cli-configuration.interface.ts";

/** The default tsconfig a build reads, matching `@nestjs/cli`. */
export const defaultTsconfigPath = "tsconfig.build.json";

/** The fallback tsconfig when a project ships no build configuration. */
export const fallbackTsconfigPath = "tsconfig.json";

/**
 * The defaults verified from `@nestjs/cli/lib/configuration/defaults.js`.
 *
 * `collection` names the Aponia collection, and `exec` names the Bun runtime
 * command; every other value is the upstream default.
 */
export const defaultCliConfiguration: AponiaCliConfiguration = Object.freeze({
  language: "ts",
  sourceRoot: "src",
  collection: "@aponiajs/schematics",
  entryFile: "main",
  exec: "bun",
  projects: Object.freeze({}),
  monorepo: false,
  compilerOptions: Object.freeze({
    builder: Object.freeze({
      type: "tsc",
      options: Object.freeze({ configPath: defaultTsconfigPath }),
    }),
    webpack: false,
    plugins: Object.freeze([]),
    assets: Object.freeze([]),
    manualRestart: false,
  }),
  generateOptions: Object.freeze({}),
});

let legacyWarningEmitted = false;
let languageWarningEmitted = false;

/**
 * Reads `aponia-cli.json`, falling back to `aponia.json` once with a warning.
 *
 * The fallback exists for one release: a project that still calls its
 * configuration `aponia.json` keeps working, and the warning names the rename.
 * A legacy `language: "typescript"` normalizes to `"ts"` with one warning, and
 * a legacy `platform` key is dropped because a generated application is
 * platform-neutral.
 *
 * @param projectRoot - The directory the configuration is read from.
 * @returns The merged configuration and the file it came from.
 * @throws A plain `Error` when the file is unreadable or names a refused builder.
 */
export async function loadCliConfiguration(projectRoot: string): Promise<LoadedCliConfiguration> {
  const modern = Bun.file(join(projectRoot, configurationFileName));
  const legacy = Bun.file(join(projectRoot, legacyConfigurationFileName));

  let raw: Record<string, unknown> = {};
  let source: ConfigurationSource = "defaults";
  if (await modern.exists()) {
    raw = await readJsonObject(modern, configurationFileName);
    source = "aponia-cli.json";
  } else if (await legacy.exists()) {
    raw = await readJsonObject(legacy, legacyConfigurationFileName);
    source = "aponia.json";
    warnOnce(
      () => legacyWarningEmitted,
      () => {
        legacyWarningEmitted = true;
      },
      "aponia.json is deprecated; rename it to aponia-cli.json. Support will be removed in the next minor release.",
    );
  }

  return {
    configuration: withProjectDefaults(mergeConfiguration(raw, source), projectRoot, raw),
    source,
  };
}

/**
 * Applies the one default that depends on the project directory.
 *
 * `@nestjs/cli` resolves its default tsconfig by checking for
 * `tsconfig.build.json` and falling back to `tsconfig.json`; a configuration
 * that names a builder keeps its own choice.
 */
function withProjectDefaults(
  configuration: AponiaCliConfiguration,
  projectRoot: string,
  raw: Readonly<Record<string, unknown>>,
): AponiaCliConfiguration {
  const fileCompiler = isRecord(raw.compilerOptions) ? raw.compilerOptions : {};
  if (fileCompiler.builder !== undefined || fileCompiler.webpack !== undefined) {
    return configuration;
  }
  const configPath = existsSync(join(projectRoot, defaultTsconfigPath))
    ? defaultTsconfigPath
    : fallbackTsconfigPath;
  return {
    ...configuration,
    compilerOptions: {
      ...configuration.compilerOptions,
      builder: { type: "tsc", options: { configPath } },
    },
  };
}

/**
 * Reads the resolved configuration.
 *
 * @param projectRoot - The directory the configuration is read from.
 * @returns The merged configuration, defaults applied.
 */
export async function readConfiguration(projectRoot: string): Promise<AponiaCliConfiguration> {
  return (await loadCliConfiguration(projectRoot)).configuration;
}

/**
 * Merges one file's configuration over the verified defaults.
 *
 * `compilerOptions` and `generateOptions` merge key by key, as
 * `NestConfigurationLoader` does, so a file that sets one field keeps the rest.
 *
 * @param raw - The parsed file contents.
 * @param source - Where the file came from, for the legacy normalization rules.
 * @returns The merged configuration.
 * @throws A plain `Error` when the file names a builder the CLI refuses.
 */
export function mergeConfiguration(
  raw: Readonly<Record<string, unknown>>,
  source: ConfigurationSource,
): AponiaCliConfiguration {
  const file = { ...raw };
  delete file.platform;
  const language = normalizeLanguage(file.language, source);
  const compilerOptions = mergeCompilerOptions(file.compilerOptions);
  assertSupportedBuilder(compilerOptions);

  return Object.freeze({
    ...defaultCliConfiguration,
    ...file,
    ...(language === undefined ? {} : { language }),
    compilerOptions,
    generateOptions: mergeGenerateOptions(file.generateOptions),
    projects: isRecord(file.projects) ? Object.freeze({ ...file.projects }) : Object.freeze({}),
  }) as AponiaCliConfiguration;
}

function mergeCompilerOptions(value: unknown): AponiaCompilerOptions {
  const file = isRecord(value) ? value : {};
  return Object.freeze({
    ...defaultCliConfiguration.compilerOptions,
    ...file,
  }) as AponiaCompilerOptions;
}

function mergeGenerateOptions(value: unknown): AponiaGenerateOptions {
  return Object.freeze({
    ...defaultCliConfiguration.generateOptions,
    ...(isRecord(value) ? value : {}),
  }) as AponiaGenerateOptions;
}

function normalizeLanguage(value: unknown, source: ConfigurationSource): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (value === "ts" || value === "js") {
    return value;
  }
  const normalized = value === "typescript" ? "ts" : value === "javascript" ? "js" : undefined;
  if (normalized === undefined) {
    throw new Error(`Unrecognized language "${value}" in ${sourceName(source)}. Use "ts" or "js".`);
  }
  warnOnce(
    () => languageWarningEmitted,
    () => {
      languageWarningEmitted = true;
    },
    `Language "${value}" is deprecated in ${sourceName(source)}; use "${normalized}".`,
  );
  return normalized;
}

function sourceName(source: ConfigurationSource): string {
  return source === "defaults" ? configurationFileName : source;
}

/**
 * Refuses a builder the Aponia CLI does not run, naming the supported pair.
 *
 * The build maps both supported builders onto the workspace's own Bun/Vite+
 * build; `webpack` and `rspack` have no equivalent here, so a configuration
 * that requests one fails when it loads rather than silently building another
 * way.
 *
 * @param compilerOptions - The merged compiler options.
 * @throws A plain `Error` naming the refused builder.
 */
export function assertSupportedBuilder(compilerOptions: AponiaCompilerOptions): void {
  if (compilerOptions.webpack === true) {
    throw refusedBuilder("webpack");
  }
  const builder = compilerOptions.builder;
  if (builder === undefined) {
    return;
  }
  const type = typeof builder === "string" ? builder : builder.type;
  if (type === "webpack" || type === "rspack") {
    throw refusedBuilder(type);
  }
  if (type !== "tsc" && type !== "swc") {
    throw new Error(`Unknown builder "${String(type)}". Use "tsc" or "swc".`);
  }
}

function refusedBuilder(builder: "webpack" | "rspack"): Error {
  return new Error(
    `The "${builder}" builder is not supported by the Aponia CLI. Use "tsc" or "swc": both map to the workspace's Bun/Vite+ build.`,
  );
}

/**
 * The builder a configuration resolves to, refusing an unsupported one.
 *
 * @param compilerOptions - The compiler options to read.
 * @returns `tsc` or `swc`.
 */
export function resolveBuilder(compilerOptions: AponiaCompilerOptions): "tsc" | "swc" {
  assertSupportedBuilder(compilerOptions);
  const builder: AponiaBuilder = compilerOptions.builder ?? "tsc";
  return (typeof builder === "string" ? builder : builder.type) as "tsc" | "swc";
}

/**
 * Resets the one-time warnings. Test-only.
 *
 * @internal
 */
export function resetConfigurationWarnings(): void {
  legacyWarningEmitted = false;
  languageWarningEmitted = false;
}

async function readJsonObject(file: Bun.BunFile, name: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await file.json();
    if (!isRecord(parsed)) {
      throw new Error("the file must contain a JSON object");
    }
    return parsed;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const message = `Could not parse "${name}". Ensure it contains valid JSON. Reason: ${reason}`;
    if (error instanceof SyntaxError) {
      throw new SyntaxError(message);
    }
    throw new Error(message);
  }
}

function warnOnce(hasWarned: () => boolean, markWarned: () => void, message: string): void {
  if (hasWarned()) {
    return;
  }
  markWarned();
  console.warn(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
