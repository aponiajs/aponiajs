import type { schematicNames } from "./command.constants.ts";

/** The `aponia new` command: a project name and its creation flags. */
export interface NewCommandOptions {
  /** Always `"new"`. */
  readonly command: "new";
  /** The project directory and package name to generate. */
  readonly name: string;
  /** Plan without writing. */
  readonly dryRun: boolean;
  /** Skip dependency installation after generation. */
  readonly skipInstall: boolean;
}

/** A schematic `aponia generate` accepts, including its short aliases. */
export type GenerateSchematic = (typeof schematicNames)[number];

/** A resource transport: the mounted `rest`/`ws`, or an unconnected scaffold. */
export type ResourceTransport =
  | "rest"
  | "graphql-code-first"
  | "graphql-schema-first"
  | "microservice"
  | "ws";

/** The `aponia generate` command: a schematic, a name, and its flags. */
export interface GenerateCommandOptions {
  /** Always `"generate"`. */
  readonly command: "generate";
  /** The schematic to generate. */
  readonly schematic: GenerateSchematic;
  /** The component name to derive file names from. */
  readonly name: string;
  /** Plan without writing. */
  readonly dryRun: boolean;
  /** Nest the files under their own directory. */
  readonly flat?: boolean;
  /** Write the spec file beside the generated one. */
  readonly spec?: boolean;
  /** Skip registering the component in its module. */
  readonly skipImport: boolean;
  /** The output path, resolved inside the project. */
  readonly path?: string;
  /** The module to register the component in. */
  readonly module?: string;
  /** The named project of a multi-project workspace. */
  readonly project?: string;
  /** Generate the CRUD operations beside the transport. */
  readonly crud: boolean;
  /** The resource transport to scaffold. */
  readonly type: ResourceTransport;
}

/** The `aponia build` command: regeneration flags. */
export interface BuildCommandOptions {
  /** Always `"build"`. */
  readonly command: "build";
  /** Plan without writing. */
  readonly dryRun: boolean;
  /** The named project of a multi-project workspace. */
  readonly project?: string;
}

/** Anything `parseArguments` answers: a command, or the `help`/`version` signals. */
export type CliCommand =
  | NewCommandOptions
  | GenerateCommandOptions
  | BuildCommandOptions
  | { readonly command: "help" }
  | { readonly command: "version" };
