import type { Token } from "@aponiajs/common";
import type { HostRequestInfo } from "../kernel/kernel.types.ts";
import type { GatewayHooks, GatewayPlan } from "../websockets/gateway.types.ts";
import type { AponiaRootModule } from "../modules/module-compiler.types.ts";
import type { AponiaHttpApplicationOptions } from "../application/application.types.ts";

/** What a host must state for the kernel to serve requests through it. */
export interface PlatformHost<TApplication, TNative = unknown> {
  /** The runtime's name, for logs and diagnostics. */
  readonly name: string;
  /** Creates the native application the kernel is mounted on. */
  createApplication(name: string): TApplication;
  /**
   * Mounts the dispatcher on the native application.
   *
   * The dispatcher answers when the kernel matched a route and answers
   * `undefined` when it did not, so the host may continue its own chain.
   */
  mount(application: TApplication, dispatch: HostDispatcher<TNative>): void;
  /** Answers a request through the native application, when the host can. */
  fetch?(application: TApplication, request: Request): Response | Promise<Response>;
  /** Starts a listener, when the runtime can. */
  listen?(
    application: TApplication,
    port: number,
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
}

/** A request handed to the kernel, with what the host knows about it. */
export type HostDispatcher<TNative = unknown> = (
  request: Request,
  info: HostRequestInfo<TNative>,
) => Promise<Response | undefined>;

/**
 * A runtime binding the unified factory can boot through the kernel.
 *
 * A host states how its native application is created and mounted; the kernel
 * owns routing, validation, and enhancers.
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
 * lowering it into the kernel. An application adapter and a kernel host are the
 * two shapes the unified `AponiaFactory.create` accepts.
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
  /** Answers one request through the application's kernel or native router. */
  handle(request: Request, info?: HostRequestInfo): Response | Promise<Response>;
  /** Answers a request the application owns, or declines it. */
  tryHandle?(request: Request, info?: HostRequestInfo): Promise<Response | undefined>;
  /** Binds a port and resolves with the application itself. */
  listen(port: number): Promise<AponiaApplicationContract<TNative>>;
  /** The address the application is listening on. */
  getUrl(): string;
  /** Resolves a token the graph provides. */
  get<T>(token: Token<T>): T;
  /** The runtime's own application object. */
  getHttpAdapter(): TNative;
  /** Runs the shutdown plan. */
  close(force?: boolean, signal?: string): Promise<void>;
}
