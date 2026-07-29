import type { GenerateCommandOptions, GenerateSchematic } from "../commands/command.types.ts";
import type { ModuleRegistrationKind } from "./module-registration.types.ts";

export interface GenerateSchematicOptions extends GenerateCommandOptions {
  readonly cwd?: string;
}

export interface SchematicChange {
  readonly kind: "CREATE" | "UPDATE";
  readonly path: string;
}

export interface GenerateSchematicResult {
  readonly changes: readonly SchematicChange[];
  readonly dryRun: boolean;
}

export interface PendingFile {
  readonly path: string;
  readonly content: string;
  readonly kind: "CREATE" | "UPDATE";
}

export interface GenerateDefaults {
  readonly flat?: boolean;
  readonly spec?: boolean | Readonly<Partial<Record<GenerateSchematic, boolean>>>;
}

export interface AponiaConfiguration {
  readonly sourceRoot?: string;
  readonly generateOptions?: GenerateDefaults;
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

export interface ResolvedProject {
  readonly root?: string;
  readonly sourceRoot?: string;
  readonly generateOptions?: GenerateDefaults;
}

export type ComponentSchematic = Exclude<GenerateSchematic, "app" | "library" | "resource">;

export interface SchematicDefinition {
  readonly defaultFlat: boolean;
  readonly spec: boolean;
  readonly suffix: string;
  readonly registration?: ModuleRegistrationKind;
}

export interface FindModuleFileOptions {
  readonly sourceRoot: string;
  readonly fromDirectory: string;
  readonly requestedModule?: string;
  readonly excludedFile?: string;
}
