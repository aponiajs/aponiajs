import type { ClassToken, LoggerService, LogLevel, PipeType } from "@aponiajs/common";
import type { AponiaHealthOptions } from "./health.interface.ts";
import type { HttpKernelOptions } from "./kernel.interface.ts";
import type { AponiaVersioningOptions } from "./version-negotiation.interface.ts";
import type { StaticAssetsOptions } from "./static-assets.interface.ts";
import type {
  CompressionOptions,
  CorsOptions,
  EtagOptions,
  SecurityHeadersOptions,
} from "./http-policy.interface.ts";

/** What an application on a runtime platform is built with. */
export interface AponiaHttpApplicationOptions {
  /** The logger failures are reported through; `false` silences reporting. */
  readonly logger?: false | LoggerService | readonly LogLevel[];
  /** A prefix every Aponia route mounts under. */
  readonly prefix?: string;
  /** Mounts liveness and readiness probes; `true` uses the conventional pair. */
  readonly health?: boolean | AponiaHealthOptions;
  /** Application state, handed to every request as `store`. */
  readonly state?: Record<string, unknown>;
  /** The largest request body the kernel reads, in bytes. */
  readonly maxBodyBytes?: number;
  /** The Aponia middleware chain, run before a route's guards. */
  readonly middleware?: HttpKernelOptions["middleware"];
  /** Renders a `@Render()` route's view. */
  readonly renderView?: HttpKernelOptions["renderView"];
  /** Adjusts the native application before anything is mounted on it. */
  readonly configureNative?: (application: never) => unknown;
  /** Guards every compiled route runs, before the route's own. */
  readonly guards?: readonly ClassToken<unknown>[];
  /** Interceptors every compiled route runs, before the route's own. */
  readonly interceptors?: readonly ClassToken<unknown>[];
  /** Filters every compiled route consults, after the route's own. */
  readonly filters?: readonly ClassToken<unknown>[];
  /** Pipes every route runs before its controller, method, and parameter pipes. */
  readonly pipes?: readonly PipeType[];
  /**
   * Routes a header or media-type request to its versioned mount.
   *
   * `uri` (the default) leaves routing alone: `@Version()` is already part of
   * the route path. `header` and `media-type` compile one table from the
   * booted routes and rewrite the request before the router sees it.
   */
  readonly versioning?: AponiaVersioningOptions;
  /**
   * Directories served beside the routes.
   *
   * Files are answered before the routes and carry no guard, interceptor, or
   * filter, which is what a static asset needs: an orchestrator or a browser
   * may fetch one without the application's credentials.
   */
  readonly staticAssets?: StaticAssetsOptions | readonly StaticAssetsOptions[];
  /** Cross-origin policy; `true` allows every origin. */
  readonly cors?: CorsOptions | boolean;
  /** Security headers; `true` selects the framework defaults. */
  readonly securityHeaders?: SecurityHeadersOptions | boolean;
  /** Entity tags and `304` answers; `true` emits a weak tag. */
  readonly etag?: EtagOptions | boolean;
  /** Response compression; `true` selects the defaults. */
  readonly compression?: CompressionOptions | boolean;
}

/**
 * What `listen` may be asked for beyond the port.
 *
 * Opt-in because taking a process's stop signals is a decision about the host
 * process rather than about one application.
 */
export interface AponiaListenOptions {
  /** Runs `close()` on `SIGTERM`/`SIGINT` instead of letting the default action end the process. */
  readonly shutdownSignals?: boolean;
}

/**
 * A surface configuration stated after `AponiaFactory.create` and applied by
 * `init()`.
 *
 * The arrays are mutable working state: a surface method appends, and the merge
 * in `init()` reads them once. The object never escapes the wrapper.
 *
 * @internal
 */
export interface AponiaApplicationSurfaceConfig {
  readonly guards: ClassToken<unknown>[];
  readonly interceptors: ClassToken<unknown>[];
  readonly pipes: PipeType[];
  readonly filters: ClassToken<unknown>[];
  cors?: CorsOptions | boolean;
  securityHeaders?: SecurityHeadersOptions | boolean;
  prefix?: string;
  versioning?: AponiaVersioningOptions;
  logger?: LoggerService;
  enabled: boolean;
}
