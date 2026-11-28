import type { schematicNames } from "../commands/command.constants.ts";

/** The module system a generated application targets. */
export type ApplicationType = "bun" | "esm" | "cjs";

/** The test runner a generated application names. */
export type TestRunner = "bun" | "vitest" | "jest";

/** The `aponia new` command: a project name and its creation flags. */
export interface NewCommandOptions {
  /** Always `"new"`. */
  readonly command: "new";
  /** The project directory and package name to generate. */
  readonly name: string;
  /** The destination directory; defaults to the project name. */
  readonly directory?: string;
  /** Plan without writing. */
  readonly dryRun: boolean;
  /** The module system and template set; Bun is the default. */
  readonly type: ApplicationType;
  /** The test runner the generated scripts name. */
  readonly testRunner: TestRunner;
  /** Generate the single-file starter. */
  readonly minimal: boolean;
  /** Skip dependency installation after generation. */
  readonly skipInstall: boolean;
  /** Skip initializing a Git repository. */
  readonly skipGit: boolean;
  /** The package manager the generated manifest names. */
  readonly packageManager?: string;
  /** The source language; `ts` is the only supported value. */
  readonly language?: string;
  /** Enable TypeScript strict mode; defaults to true. */
  readonly strict: boolean;
  /** The schematic collection the generated configuration names. */
  readonly collection?: string;
  /** Preconfigure the observability surface. */
  readonly observe?: boolean;
  /** The coding-agent clients whose skills are installed. */
  readonly skills: readonly AgentClient[];
  /** Skip installing coding-agent skills. */
  readonly skipSkills: boolean;
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
  /** The named project of a multi-project workspace. */
  readonly project?: string;
  /** The executable the entry runs under; defaults to the configured `exec`. */
  readonly exec?: string;
  /** The configuration file to read; defaults to `aponia-cli.json`. */
  readonly config?: string;
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
  /** The component name to derive file names from; `upgrade` takes none. */
  readonly name?: string;
  /** Plan without writing. */
  readonly dryRun: boolean;
  /** Nest the files under their own directory. */
  readonly flat?: boolean;
  /** Write the spec file beside the generated one. */
  readonly spec?: boolean;
  /** The spec file suffix; defaults to `spec`. */
  readonly specFileSuffix?: string;
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
  /** The module system the `application` schematic targets. */
  readonly applicationType?: ApplicationType;
  /** Generate a publishable library package instead of a private workspace package. */
  readonly publish?: boolean;
  /** The npm scope for a publishable library, with or without `@`. */
  readonly scope?: string;
  /** The library import prefix. */
  readonly prefix?: string;
  /** Skip dependency installation after a library is written. */
  readonly skipInstall?: boolean;
  /** The source language; `ts` is the only supported value. */
  readonly language?: string;
  /** Enable TypeScript strict mode in a generated application. */
  readonly strict?: boolean;
  /** The schematic collection the CLI resolves. */
  readonly collection?: string;
  /** Prompt for missing values; the Aponia CLI only accepts `false`. */
  readonly interactive?: boolean;
  /** The dependency update dist-tag an upgrade uses. */
  readonly tag?: string;
}

/** The `aponia build` command: regeneration flags. */
export interface BuildCommandOptions {
  /** Always `"build"`. */
  readonly command: "build";
  /** Plan without writing. */
  readonly dryRun: boolean;
  /** The named project of a multi-project workspace. */
  readonly project?: string;
  /** The project directory to build; defaults to the configuration root. */
  readonly path?: string;
  /** Rebuild on change. */
  readonly watch: boolean;
  /** The builder a build uses; `tsc` and `swc` are supported. */
  readonly builder?: string;
  /** Build every configured project. */
  readonly all: boolean;
  /** The configuration file to read. */
  readonly config?: string;
  /** Type-check the build; `--no-type-check` skips it. */
  readonly typeCheck?: boolean;
  /** Emit declarations beside the build. */
  readonly emitDeclarations: boolean;
}

/** The `aponia add <library>` command. */
export interface AddCommandOptions {
  /** Always `"add"`. */
  readonly command: "add";
  /** The package whose collection is added. */
  readonly library: string;
  /** Plan without writing. */
  readonly dryRun: boolean;
  /** Skip dependency installation. */
  readonly skipInstall: boolean;
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
  /** Whether to check npm and OSV for updates/advisories; defaults to `true`. */
  readonly updateCheck?: boolean;
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
  | AddCommandOptions
  | DevCommandOptions
  | LibraryCommandOptions
  | ManifestCommandOptions
  | StartCommandOptions
  | InfoCommandOptions
  | AgentCommandOptions
  | { readonly command: "help" }
  | { readonly command: "version" };
