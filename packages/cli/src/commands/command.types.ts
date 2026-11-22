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
  /** Generate a Nest-style workspace with `apps/*` and `libs/*`. */
  readonly workspace: boolean;
  /** The HTTP platform the generated application boots on. */
  readonly platform: "elysia" | "hono" | "h3";
  /** The coding-agent clients whose skills are installed. */
  readonly skills: readonly AgentClient[];
  /** Skip installing coding-agent skills. */
  readonly skipSkills: boolean;
  /** Skip initializing a Git repository. */
  readonly skipGit: boolean;
}

/** The `aponia start` command. */
export interface StartCommandOptions {
  /** Always `"start"`. */
  readonly command: "start";
  /** The project root; defaults to the working directory. */
  readonly cwd?: string;
  /** The entry file, relative to the project root. */
  readonly entry?: string;
  /** An explicit file to run. */
  readonly path?: string;
  /** Run under Bun's watcher. */
  readonly watch: boolean;
  /** Run with Bun's inspector. */
  readonly debug: boolean;
  /** Run the built entry from `dist`. */
  readonly prod: boolean;
}

/** The `aponia info` command. */
export interface InfoCommandOptions {
  /** Always `"info"`. */
  readonly command: "info";
  /** Print one JSON object instead of a table. */
  readonly json: boolean;
  /** The project root; defaults to the working directory. */
  readonly cwd?: string;
}

/** A schematic `aponia generate` accepts, including its short aliases. */
export type GenerateSchematic = (typeof schematicNames)[number];

/** A resource transport: the mounted `rest`/`ws`, or an unconnected scaffold. */
export type ResourceTransport =
  | "rest"
  | "mvc"
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
  /** Generate a publishable library package instead of a private workspace package. */
  readonly publish?: boolean;
  /** The npm scope for a publishable library, with or without `@`. */
  readonly scope?: string;
  /** Skip dependency installation after a library is written. */
  readonly skipInstall?: boolean;
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

/** The `aponia library check` command. */
export interface LibraryCommandOptions {
  /** Always `"library"`. */
  readonly command: "library";
  /** Always `"check"`. */
  readonly action: "check" | "new" | "publish" | "search";
  /** The library directory, relative to the working directory. */
  readonly path?: string;
  /** Print the result as JSON. */
  readonly json: boolean;
  /** Require a publishable package rather than a private workspace package. */
  readonly publish: boolean;
  /** The search query for the `search` action. */
  readonly query?: string;
  /** The library name for the `new` action. */
  readonly name?: string;
  /** The package kind the `new` action writes; defaults to a module library. */
  readonly kind?: "module" | "plugin";
  /** The npm scope for the `new` action. */
  readonly scope?: string;
  /** Skip install for the `new` action. */
  readonly skipInstall?: boolean;
  /** Publish without stopping for confirmation. */
  readonly yes?: boolean;
  /** The npm dist-tag for the publish action. */
  readonly tag?: string;
  /** Include npm community results in a library search. */
  readonly remote?: boolean;
}

/** The `aponia dev` command: run one entrypoint under Bun's watcher. */
export interface DevCommandOptions {
  /** Always `"dev"`. */
  readonly command: "dev";
  /** The entrypoint to run; defaults to `src/main.ts`. */
  readonly entry: string;
}

/** The `aponia manifest` command. */
export interface ManifestCommandOptions {
  /** Always `"manifest"`. */
  readonly command: "manifest";
}

/** The agent clients `aponia agent init` can install guidance for. */
export type AgentClient = "codex" | "claude" | "cursor";

/** The `aponia agent init` command. */
export interface AgentCommandOptions {
  /** Always `"agent"`. */
  readonly command: "agent";
  /** Always `"init"`. */
  readonly action: "init";
  /** The clients to write guidance for. */
  readonly clients: readonly AgentClient[];
  /** Plan without writing. */
  readonly dryRun: boolean;
  /** The project root. */
  readonly cwd?: string;
}

/** Anything `parseArguments` answers: a command, or the `help`/`version` signals. */
export type CliCommand =
  | NewCommandOptions
  | GenerateCommandOptions
  | BuildCommandOptions
  | DevCommandOptions
  | LibraryCommandOptions
  | ManifestCommandOptions
  | StartCommandOptions
  | InfoCommandOptions
  | AgentCommandOptions
  | { readonly command: "help" }
  | { readonly command: "version" };
