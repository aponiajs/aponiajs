import type { InjectionToken, ModuleMetadata } from "@aponiajs/common";

/** Options for a single static-asset mount in `ServeStaticModule`. */
export interface ServeStaticModuleOptions {
  /** Filesystem directory containing static files. */
  readonly rootPath: string;
  /** URL prefix where static files are served (default: `"/"`). */
  readonly serveRoot?: string;
  /** Route prefixes or wildcard patterns (e.g. `"/api*"`) excluded from static serving. */
  readonly exclude?: readonly string[];
  /** Index filename for directory requests, or `false` to disable directory index (default: `"index.html"`). */
  readonly index?: string | false;
  /** Optional SPA fallback path (e.g. `"*"` serves `index.html` when no file matches). */
  readonly renderPath?: string | RegExp;
}

/** Async options accepted by `ServeStaticModule.forRootAsync()`. */
export interface ServeStaticModuleAsyncOptions extends Pick<ModuleMetadata, "imports"> {
  readonly useFactory: (
    ...args: readonly never[]
  ) =>
    | ServeStaticModuleOptions
    | readonly ServeStaticModuleOptions[]
    | Promise<ServeStaticModuleOptions | readonly ServeStaticModuleOptions[]>;
  readonly inject?: readonly InjectionToken<unknown>[];
}
