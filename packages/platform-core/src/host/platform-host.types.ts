import type { Token } from "@aponiajs/common";
import type {
  HostRequestInfo,
  MountedRoute,
  PlatformRouteContext,
} from "../kernel/kernel.types.ts";
import type { ResolvedMiddlewareConfig } from "../middleware/middleware-consumer.types.ts";
import type { GatewayHooks, GatewayPlan } from "../websockets/gateway.types.ts";
import type { AponiaRootModule } from "../modules/module-compiler.types.ts";
import type { AponiaHttpApplicationOptions } from "../application/application.types.ts";
import type { StaticAssetsOptions } from "../routing/static-assets.types.ts";

/** What a platform needs when it mounts routes or middleware. */
export interface PlatformMountOptions {
  /** The application state every request context is seeded with. */
  readonly store?: Record<string, unknown> | undefined;
  /** The normalized route prefix, stripped before middleware matching. */
  readonly prefix?: string | undefined;
}

/** Answers one mounted route on a platform's own router. */
export type PlatformRouteHandler = (context: PlatformRouteContext) => Promise<Response>;

/**
 * Wraps one request around the runtime's own dispatch.
 *
 * The boot installs the version negotiator and the response policies here, so
 * `handle` and `listen` run the same contract: a host that serves through the
 * native fetch would otherwise answer unversioned and unpolicied requests.
 */
export type RequestPipeline = (
  request: Request,
  next: (request: Request) => Response | Promise<Response>,
) => Promise<Response>;

/** What a host must state to serve the graph through its runtime. */
export interface PlatformHost<TApplication, _TNative = unknown> {
  /** The runtime's name, for logs and diagnostics. */
  readonly name: string;
  /** Creates the native application the routes are mounted on. */
  createApplication(name: string): TApplication;
  /**
   * Registers one route on the runtime's own router.
   *
   * The host builds the route's context from its native request object and
   * calls the handler from that route's own handler; routing, matching, and
   * precedence stay the runtime's.
   */
  mountRoute(
    application: TApplication,
    mount: MountedRoute,
    handler: PlatformRouteHandler,
    options?: PlatformMountOptions,
  ): void;
  /**
   * Mounts one directory of static files beside the routes.
   *
   * A host that cannot serve files states none, and a boot that declares
   * static assets is refused rather than mounted without them.
   */
  mountStaticAssets?(application: TApplication, options: StaticAssetsOptions): void;
  /** Mounts the module-configured middleware chain on the native application. */
  mountMiddleware?(
    application: TApplication,
    configs: readonly ResolvedMiddlewareConfig[],
    options?: PlatformMountOptions,
  ): void;
  /** Answers a request through the native application, when the host can. */
  fetch?(
    application: TApplication,
    request: Request,
    info?: HostRequestInfo,
  ): Response | Promise<Response>;
  /** Starts a listener, when the runtime can. */
  listen?(
    application: TApplication,
    port: number,
    pipeline?: RequestPipeline,
  ): Promise<{ readonly url: string; close(force?: boolean): Promise<void> }>;
  /** Releases what the native application holds. */
  close?(application: TApplication): Promise<void>;
  /**
   * Mounts a WebSocket gateway.
   *
   * A host without WebSocket support states none, and the boot refuses a graph
   * that declares a gateway rather than mounting a route that never upgrades.
   */
  mountGateway?(application: TApplication, plan: GatewayPlan, hooks: GatewayHooks): void;
  /**
   * Applies the gateway options the runtime states server-wide.
   *
   * Bun's server and crossws configure payload, idle, and ping policy for the
   * listener rather than per socket, so a host receives the merged policy once.
   */
  configureGatewayOptions?(application: TApplication, options: GatewayServerOptions): void;
}

/** The server-wide WebSocket options one application's gateways ask for. */
export interface GatewayServerOptions {
  readonly maxPayloadLength?: number | undefined;
  readonly idleTimeoutSeconds?: number | undefined;
  readonly sendPings?: boolean | undefined;
}

/** Kept for the kernel factory: a host that answers through a dispatcher. */
export type HostDispatcher<TNative = unknown> = (
  request: Request,
  info: HostRequestInfo<TNative>,
) => Promise<Response | undefined>;

/**
 * A runtime binding the unified factory can boot through the kernel.
 *
 * A host states how its native application is created and how each compiled
 * route is mounted; the shared route handler owns the request contract and the
 * runtime owns routing, middleware, and the transport.
 */
export interface KernelAdapter<TApplication = unknown, TNative = unknown> extends PlatformHost<
  TApplication,
  TNative
> {
  /** Discriminates a kernel host from an application adapter. */
  readonly kind: "host";
}

/**
 * A runtime binding that boots through its own factory.
 *
 * The Elysia platform keeps its native executor — plugins, `HandlerContext`,
 * and Eden types — so its adapter hands the root to that factory rather than
 * lowering it into the shared route handler. An application adapter and a host
 * are the two shapes the unified `AponiaFactory.create` accepts.
 */
export interface ApplicationAdapter<TNative = unknown> {
  /** Discriminates this from a kernel host. */
  readonly kind: "application";
  /** The runtime's name, for logs and diagnostics. */
  readonly name: string;
  /** Boots the application on this runtime. */
  create(
    rootModule: AponiaRootModule,
    options?: AponiaHttpApplicationOptions,
  ): Promise<AponiaApplicationContract<TNative>>;
}

/** Any runtime binding the unified factory accepts. */
export type AponiaAdapter<TNative = unknown> =
  | KernelAdapter<unknown, TNative>
  | ApplicationAdapter<TNative>;

/** The application surface every platform returns. */
export interface AponiaApplicationContract<TNative = unknown> {
  /** Answers one request through the application's native router. */
  handle(request: Request, info?: HostRequestInfo): Response | Promise<Response>;
  /** Answers a request the application owns, or declines it. */
  tryHandle?(request: Request, info?: HostRequestInfo): Promise<Response | undefined>;
  /** Binds a port and resolves with the application itself. */
  listen(
    port: number,
    options?: { readonly shutdownSignals?: boolean },
  ): Promise<AponiaApplicationContract<TNative>>;
  /** The address the application is listening on. */
  getUrl(): string;
  /** Resolves a token the graph provides. */
  get<T>(token: Token<T>): T;
  /** The runtime's own application object. */
  getHttpAdapter(): TNative;
  /** Runs the shutdown plan. */
  close(force?: boolean, signal?: string): Promise<void>;
}
