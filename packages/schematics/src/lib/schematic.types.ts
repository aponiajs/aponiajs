/**
 * The options a schematic factory reads.
 *
 * These mirror the properties `schema.json` declares for the schematics the
 * collection publishes. A property the schema marks as `required` is validated
 * by the caller before the factory runs.
 */
export interface SchematicOptions {
  /** The declaration name the generated files derive from. */
  readonly name?: string;
  /** The directory the files are written under. */
  readonly path?: string;
  /** The source language; `ts` and `js` are the published values. */
  readonly language?: string;
  /** The project's source root, when the caller resolves it. */
  readonly sourceRoot?: string;
  /** The declaring module a caller may register the declaration in. */
  readonly module?: string;
  /** Skip the module registration. */
  readonly skipImport?: boolean;
  /** Create the files beside their target rather than in a directory. */
  readonly flat?: boolean;
  /** Write the spec file. */
  readonly spec?: boolean;
  /** The spec file suffix; defaults to `spec`. */
  readonly specFileSuffix?: string;
  /** The module system an application template renders for. */
  readonly type?: string;
  /** Whether the target project is ESM; the templates branch on it. */
  readonly isEsm?: boolean;
  /** Generate the CRUD entry points a resource template declares. */
  readonly crud?: boolean;
  /** The library import prefix. */
  readonly prefix?: string;
  /** The libraries root directory. */
  readonly rootDir?: string;
  /** The application author written into the manifest. */
  readonly author?: string;
  /** The application description written into the manifest. */
  readonly description?: string;
  /** The application destination directory. */
  readonly directory?: string;
  /** Enable TypeScript strict mode in a generated application. */
  readonly strict?: boolean;
  /** The generated application version. */
  readonly version?: string;
  /** The package manager the generated application names. */
  readonly packageManager?: string;
  /** The agent-skill targets an application was generated for. */
  readonly skills?: readonly string[];
  /** Generate the single-file starter. */
  readonly minimal?: boolean;
  /** Preconfigure the observability surface. */
  readonly observe?: boolean;
  /** The schematic collection the generated configuration names. */
  readonly collection?: string;
  /** The dependency update dist-tag an upgrade uses. */
  readonly tag?: string;
}

/** One file a factory plans: its path and rendered content. */
export interface SchematicFile {
  /** The path, relative to the caller's working directory. */
  readonly path: string;
  /** The rendered content. */
  readonly content: string;
}

/** What a factory plans for one invocation. */
export interface SchematicPlan {
  /** The files to write. */
  readonly files: readonly SchematicFile[];
}

/**
 * A schematic factory.
 *
 * The Aponia collection contract is deliberately a plain async function rather
 * than an `@angular-devkit/schematics` `Rule`: this workspace has no Angular
 * DevKit dependency, and a function that returns the files it plans is enough
 * for the CLI to run a collection without adopting a second build system.
 */
export type SchematicFactory = (
  options: SchematicOptions,
) => SchematicPlan | Promise<SchematicPlan>;

/** The shape one `collection.json` entry publishes. */
export interface SchematicCollectionEntry {
  /** The factory module, optionally followed by `#export`. */
  readonly factory: string;
  /** A one-line description of what the schematic creates. */
  readonly description: string;
  /** The JSON Schema describing the accepted options. */
  readonly schema?: string;
  /** The short aliases the schematic accepts. */
  readonly aliases?: readonly string[];
}

/** The shape of a `collection.json` file. */
export interface SchematicCollection {
  /** The schematics the collection publishes, keyed by name. */
  readonly schematics: Readonly<Record<string, SchematicCollectionEntry>>;
}
