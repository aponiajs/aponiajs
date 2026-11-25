import type { GenerateCommandOptions, GenerateSchematic } from "./command.interface.ts";
import type { ModuleRegistrationKind } from "./module-registration.interface.ts";

/** The generator options plus the working directory the command runs from. */
export interface GenerateSchematicOptions extends GenerateCommandOptions {
  /** The project root; defaults to the process working directory. */
  readonly cwd?: string;
  /** Write a standalone library at the project root instead of `libs/`. */
  readonly standalone?: boolean;
}

export type {
  AponiaCliConfiguration,
  AponiaConfiguration,
  AponiaGenerateOptions,
  AponiaProjectConfiguration,
  GenerateDefaults,
  ResolvedProject,
} from "./cli-configuration.interface.ts";

/** One reported file change: its kind and its project-relative path. */
export interface SchematicChange {
  /** `CREATE` for a new file, `UPDATE` for a rewritten one. */
  readonly kind: "CREATE" | "UPDATE";
  /** The project-relative path. */
  readonly path: string;
}

/** What a schematic run reports: its change lines and whether it wrote. */
export interface GenerateSchematicResult {
  /** The change lines `runCli` prints. */
  readonly changes: readonly SchematicChange[];
  /** `true` when nothing was written. */
  readonly dryRun: boolean;
}

/** The fields every pending file carries. */
interface PendingFileBase {
  /** The absolute path to write. */
  readonly path: string;
  /** `CREATE` for a new file, `UPDATE` for a rewritten one. */
  readonly kind: "CREATE" | "UPDATE";
}

/** A pending file whose bytes the generator writes. */
export interface PendingContentFile extends PendingFileBase {
  /** Distinguishes a written file from a symlink. */
  readonly type: "content";
  /** The formatted source to write. */
  readonly content: string;
}

/** A pending relative symlink, used for agent-guide aliases. */
export interface PendingLinkFile extends PendingFileBase {
  /** Distinguishes a symlink from a written file. */
  readonly type: "link";
  /** The relative target the symlink points at. */
  readonly link: string;
}

/** One file the generator writes: either content or a relative symlink. */
export type PendingFile = PendingContentFile | PendingLinkFile;

/** A single-file component schematic: a component, not a package, resource, configuration, or upgrade. */
export type ComponentSchematic = Exclude<
  GenerateSchematic,
  "app" | "application" | "library" | "plugin" | "resource" | "configuration" | "upgrade"
>;

/** One schematic's file layout and module registration. */
export interface SchematicDefinition {
  /** Nest files under their own directory unless `--flat` says otherwise. */
  readonly defaultFlat: boolean;
  /** Whether this schematic writes a spec file. */
  readonly spec: boolean;
  /** The file suffix generated files carry. */
  readonly suffix: string;
  /** The module collection the component registers in, if any. */
  readonly registration?: ModuleRegistrationKind;
}

/** The module lookup a registration performs after generation. */
export interface FindModuleFileOptions {
  /** The source root the lookup stays inside. */
  readonly sourceRoot: string;
  /** The directory the generated file was written to. */
  readonly fromDirectory: string;
  /** The module the caller named, if any. */
  readonly requestedModule?: string;
  /** A file the lookup must not answer with. */
  readonly excludedFile?: string;
}
