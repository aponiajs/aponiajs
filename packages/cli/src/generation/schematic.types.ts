import type { GenerateCommandOptions, GenerateSchematic } from "../commands/command.types.ts";
import type { ModuleRegistrationKind } from "./module-registration.types.ts";

/** The generator options plus the working directory the command runs from. */
export interface GenerateSchematicOptions extends GenerateCommandOptions {
  /** The project root; defaults to the process working directory. */
  readonly cwd?: string;
}

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

/** One file the generator writes: its path, content, and change kind. */
export interface PendingFile {
  /** The absolute path to write. */
  readonly path: string;
  /** The formatted source to write. */
  readonly content: string;
  /** `CREATE` for a new file, `UPDATE` for a rewritten one. */
  readonly kind: "CREATE" | "UPDATE";
}

/** The `generateOptions` an `aponia.json` declares: flat and spec defaults. */
export interface GenerateDefaults {
  /** Nest component files under their own directory. */
  readonly flat?: boolean;
  /** Write spec files; per-schematic when an object. */
  readonly spec?: boolean | Readonly<Partial<Record<GenerateSchematic, boolean>>>;
}

/** The `aponia.json` configuration: source roots and per-project generation defaults. */
export interface AponiaConfiguration {
  /** The source root generation reads and writes. */
  readonly sourceRoot?: string;
  /** The generation defaults of the default project. */
  readonly generateOptions?: GenerateDefaults;
  /** The named projects of a multi-project workspace. */
  readonly projects?: Readonly<
    Record<
      string,
      {
        readonly root?: string;
        readonly sourceRoot?: string;
        readonly generateOptions?: GenerateDefaults;
      }
    >
  >;
}

/** One resolved project: its root, source root, and generation defaults. */
export interface ResolvedProject {
  /** The project root, absent for the default project. */
  readonly root?: string;
  /** The source root generation reads and writes. */
  readonly sourceRoot?: string;
  /** The generation defaults applying to this project. */
  readonly generateOptions?: GenerateDefaults;
}

/** A single-file component schematic: everything but app, library, and resource. */
export type ComponentSchematic = Exclude<GenerateSchematic, "app" | "library" | "resource">;

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
