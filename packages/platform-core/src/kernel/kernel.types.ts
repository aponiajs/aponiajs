import type {
  CanActivate,
  ClassToken,
  ExceptionFilter,
  Interceptor,
  LoggerService,
  RouteContext,
  RouteSchema,
} from "@aponiajs/common";
import type { ResolvedPipe } from "../pipes/pipe-resolver.types.ts";
import type { CompiledRoute } from "../routing/compiled-route.types.ts";

/** A filter class resolved to the instance that answers, with the types it catches. */
export interface ResolvedFilter {
  /** The filter instance. */
  readonly instance: ExceptionFilter;
  /** The exception classes `@Catch()` named, empty when it named none. */
  readonly exceptions: readonly ClassToken<unknown>[];
}

/** One route a platform mounted, with everything a request through it needs. */
export interface MountedRoute {
  /** The lowered route this mount serves. */
  readonly route: CompiledRoute;
  /** The controller class the route belongs to. */
  readonly controller: ClassToken<unknown>;
  /** The controller instance, or the request-scoped factory below. */
  readonly instance: unknown;
  /** Resolves the instance for a request-scoped controller, in this request's context. */
  readonly resolveInstance?: (context: object) => unknown;
  /** Guard instances in run order. */
  readonly guards: readonly CanActivate[];
  /** Interceptor instances in run order. */
  readonly interceptors: readonly Interceptor[];
  /** Filter instances, most specific first. */
  readonly filters: readonly ResolvedFilter[];
  /** Route-level pipes, controller pipes first. */
  readonly pipes: readonly ResolvedPipe[];
}

/** What the host knows about the request that a `Request` does not state. */
export interface HostRequestInfo<TNative = unknown> {
  /** The host-relative path, when the host mounts the kernel under a prefix. */
  readonly path?: string;
  /** The peer address, when the host can state one. */
  readonly ip?: string;
  /** The host's own request object, for an escape hatch. */
  readonly native?: TNative;
  /** Keeps work alive after the response on a runtime that supports it. */
  readonly waitUntil?: (work: Promise<unknown>) => void;
}

/** The route one request matched, with the parameters the matcher read. */
export interface RouteMatch {
  /** The mount that serves the request. */
  readonly mount: MountedRoute;
  /** The decoded path parameters. */
  readonly params: Readonly<Record<string, string>>;
}

/** The request context this kernel hands a handler. */
export interface PlatformRouteContext<
  TSchema extends RouteSchema = RouteSchema,
> extends RouteContext<TSchema> {
  /** Application state, shared by every request. */
  readonly store: Record<string, unknown>;
  /** Sets the answer's status and returns the response to return or throw. */
  readonly status: (status: number | string, body?: unknown) => Response;
  /** The peer address, when the host states one. */
  readonly server?: { readonly requestIP?: () => { readonly address?: string } | undefined };
  /** The host's own request object, when the platform forwarded one. */
  readonly native?: unknown;
}

/** What one kernel is built with. */
export interface HttpKernelOptions {
  /** The routes to serve, in mount order. */
  readonly routes: readonly MountedRoute[];
  /** The logger failures are reported through. */
  readonly logger?: LoggerService;
  /** Application state handed to every request as `store`. */
  readonly store?: Record<string, unknown>;
  /** The largest request body the kernel reads, in bytes; defaults to 1 MiB. */
  readonly maxBodyBytes?: number;
  /** Application pipes, which run before a route's own. */
  readonly globalPipes?: readonly ResolvedPipe[];
  /** The Aponia middleware chain, run before the route's guards. */
  readonly middleware?: (
    context: PlatformRouteContext,
    next: () => Promise<unknown>,
  ) => Promise<unknown>;
  /** Renders a `@Render()` route's view. */
  readonly renderView?: (
    template: string,
    data: unknown,
    options?: { readonly layout?: string; readonly fragment?: boolean },
  ) => Promise<string> | string;
}

/** The kernel a host dispatches requests into. */
export interface HttpKernel {
  /** The route this method and path resolve to, if any. */
  match(method: string, pathname: string): RouteMatch | undefined;
  /** Answers the request, or a `404` problem document when no route matches. */
  handle(request: Request, info?: HostRequestInfo): Promise<Response>;
  /** Answers the request, or `undefined` so the host may answer it. */
  tryHandle(request: Request, info?: HostRequestInfo): Promise<Response | undefined>;
}
