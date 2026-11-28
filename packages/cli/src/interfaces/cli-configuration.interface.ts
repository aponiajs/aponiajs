import type { GenerateSchematic } from "./command.interface.ts";

/** A compiler asset, either a glob or its detailed form. */
export type AponiaAsset = string | AponiaAssetEntry;

/** One asset entry `compilerOptions.assets` accepts. */
export interface AponiaAssetEntry {
  /** The glob the entry copies. */
  readonly glob: string;
  /** The directory the glob is resolved from. */
  readonly include?: string;
  /** Copy the files beside the output rather than preserving their tree. */
  readonly flat?: boolean;
  /** A glob the entry skips. */
  readonly exclude?: string;
  /** The output directory. */
  readonly outDir?: string;
  /** Watch the matched files. */
  readonly watchAssets?: boolean;
  /** Restart the process when a matched file changes. */
  readonly restartOnChange?: boolean;
}

/** One compiler plugin, either a package name or its options. */
export interface AponiaPluginOptions {
  /** The plugin package name. */
  readonly name: string;
  /** The options the plugin receives. */
  readonly options: Readonly<Record<string, unknown>>;
}

/** The `tsc` builder options. */
export interface TscBuilderOptions {
  /** The tsconfig the builder reads. */
  readonly configPath?: string;
}

/** The `swc` builder options. */
export interface SwcBuilderOptions {
  /** The `.swcrc` the builder reads. */
  readonly swcrcPath?: string;
  /** The output directory. */
  readonly outDir?: string;
  /** The files to compile. */
  readonly filenames?: readonly string[];
  /** Compile synchronously. */
  readonly sync?: boolean;
  /** The extensions the builder compiles. */
  readonly extensions?: readonly string[];
  /** Copy files beside the output. */
  readonly copyFiles?: boolean;
  /** Include dotfiles. */
  readonly includeDotfiles?: boolean;
  /** Suppress the builder's own output. */
  readonly quiet?: boolean;
}

/** The deprecated `webpack` builder options. */
export interface WebpackBuilderOptions {
  /** The webpack config the builder would read. */
  readonly configPath?: string;
}

/** The deprecated `rspack` builder options. */
export interface RspackBuilderOptions {
  /** The rspack config the builder would read. */
  readonly configPath?: string;
}

/** The dependencies a bundle leaves out. */
export interface BundleDependenciesOptions {
  /** The packages that stay external. */
  readonly exclude?: readonly string[];
}

/** One builder name. */
export type AponiaBuilderVariant = "tsc" | "webpack" | "swc" | "rspack";

/** A builder, either by name or with its options. */
export type AponiaBuilder =
  | AponiaBuilderVariant
  | { readonly type: "webpack"; readonly options?: WebpackBuilderOptions }
  | { readonly type: "rspack"; readonly options?: RspackBuilderOptions }
  | { readonly type: "swc"; readonly options?: SwcBuilderOptions }
  | { readonly type: "tsc"; readonly options?: TscBuilderOptions };

/** The `compilerOptions` block, shaped like `nest-cli.json`'s. */
export interface AponiaCompilerOptions {
  /** The tsconfig the build reads. */
  readonly tsConfigPath?: string;
  /** @deprecated Use `builder` instead. */
  readonly webpack?: boolean;
  /** @deprecated Use `builder.options.configPath` instead. */
  readonly webpackConfigPath?: string;
  /** Compiler plugins. */
  readonly plugins?: readonly (string | AponiaPluginOptions)[];
  /** Assets the build copies. */
  readonly assets?: readonly AponiaAsset[];
  /** Empty the output directory before writing. */
  readonly deleteOutDir?: boolean;
  /** Allow a project outside the workspace root. */
  readonly allowOutsidePaths?: boolean;
  /** Restart the process manually after a change. */
  readonly manualRestart?: boolean;
  /** The builder a build uses. */
  readonly builder?: AponiaBuilder;
  /** Emit declarations beside the build. */
  readonly emitDeclarations?: boolean;
  /** Bundle `node_modules` into the output instead of leaving them external. */
  readonly bundleDependencies?: boolean | BundleDependenciesOptions;
  /** Library projects whose assets are copied too. */
  readonly includeLibraryAssets?: readonly string[];
}

/** The `generateOptions` block, shaped like `nest-cli.json`'s. */
export interface AponiaGenerateOptions {
  /** Write spec files; per-schematic when an object. */
  readonly spec?: boolean | Readonly<Partial<Record<GenerateSchematic, boolean>>>;
  /** Nest component files under their own directory. */
  readonly flat?: boolean;
  /** The spec file suffix; defaults to `spec`. */
  readonly specFileSuffix?: string;
  /** The directory generation is resolved from. */
  readonly baseDir?: string;
}

/** Alias kept for the generator's existing imports. */
export type GenerateDefaults = AponiaGenerateOptions;

/** One project entry, shaped like `nest-cli.json`'s `projects` value. */
export interface AponiaProjectConfiguration {
  /** Whether the project is an application or a library. */
  readonly type?: "application" | "library";
  /** The project root, relative to the workspace. */
  readonly root?: string;
  /** The entry file name, `main` for an application and `index` for a library. */
  readonly entryFile?: string;
  /** The command the project starts under. */
  readonly exec?: string;
  /** The source root generation reads and writes. */
  readonly sourceRoot?: string;
  /** The project's compiler settings. */
  readonly compilerOptions?: AponiaCompilerOptions;
  /** The generation defaults of this project. */
  readonly generateOptions?: AponiaGenerateOptions;
}

/** The `aponia-cli.json` configuration, shaped like `nest-cli.json`. */
export interface AponiaCliConfiguration {
  /** The source language; `ts` or `js`. */
  readonly language?: string;
  /** The schematic collection the CLI reads. */
  readonly collection?: string;
  /** The source root generation reads and writes. */
  readonly sourceRoot?: string;
  /** The entry file a project builds and starts. */
  readonly entryFile?: string;
  /** The command a project starts under. */
  readonly exec?: string;
  /** Whether the workspace holds `apps/` and `libs/`. */
  readonly monorepo?: boolean;
  /** Compiler settings every project inherits. */
  readonly compilerOptions?: AponiaCompilerOptions;
  /** The generation defaults of the default project. */
  readonly generateOptions?: AponiaGenerateOptions;
  /** The named projects of a multi-project workspace. */
  readonly projects?: Readonly<Record<string, AponiaProjectConfiguration>>;
  /**
   * Aponia extension: the alias prefix workspace libraries are imported under.
   *
   * `nest-cli.json` has no equivalent; a library's `prefix` option overrides it.
   */
  readonly defaultLibraryPrefix?: string;
}

/** Alias kept for the generator's existing imports. */
export type AponiaConfiguration = AponiaCliConfiguration;

/** Where a loaded configuration came from. */
export type ConfigurationSource = "aponia-cli.json" | "aponia.json" | "defaults";

/** A loaded configuration and the file it came from. */
export interface LoadedCliConfiguration {
  /** The merged configuration, defaults applied. */
  readonly configuration: AponiaCliConfiguration;
  /** The file the configuration came from. */
  readonly source: ConfigurationSource;
}

/** One resolved project: its root, source root, and generation defaults. */
export interface ResolvedProject {
  /** Whether the project is an application or a library. */
  readonly type?: "application" | "library";
  /** The entry file name. */
  readonly entryFile?: string;
  /** The command the project starts under. */
  readonly exec?: string;
  /** The project's tsconfig path. */
  readonly tsConfigPath?: string;
  /** The project root, absent for the default project. */
  readonly root?: string;
  /** The source root generation reads and writes. */
  readonly sourceRoot?: string;
  /** The generation defaults applying to this project. */
  readonly generateOptions?: AponiaGenerateOptions;
}
