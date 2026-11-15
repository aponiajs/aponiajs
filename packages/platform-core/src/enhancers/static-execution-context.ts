import type {
  ClassToken,
  ExecutionContext,
  HttpArgumentsHost,
  RequestMethod,
  RouteContext,
  RpcArgumentsHost,
  WsArgumentsHost,
} from "@aponiajs/common";

const defaultRoute = Object.freeze({
  method: "GET" as RequestMethod,
  path: "/",
});

/**
 * A route's immutable identity plus one request's context.
 *
 * A route compiles one prototype at mount time and forks it per request, so
 * concurrent requests never share the mutable raw-context pointer. The
 * prototype itself carries no request; `fork` is how production hooks obtain
 * the instance a guard or interceptor reads.
 */
export class StaticRouteExecutionContext implements ExecutionContext, HttpArgumentsHost {
  #rawContext: RouteContext | null = null;
  readonly #targetClass: unknown;
  readonly #handlerRef: (...arguments_: never[]) => unknown;
  readonly #route: Readonly<{ readonly method: RequestMethod; readonly path: string }>;

  constructor(
    controllerInstance: unknown,
    handlerRef: Function,
    route?: Readonly<{ readonly method: RequestMethod; readonly path: string }>,
  ) {
    this.#targetClass =
      typeof controllerInstance === "function"
        ? controllerInstance
        : (controllerInstance as Record<PropertyKey, unknown> | null | undefined)?.constructor;
    this.#handlerRef = handlerRef as (...arguments_: never[]) => unknown;
    this.#route = route ?? defaultRoute;
  }

  /**
   * Sets the context on this instance.
   *
   * Production hooks call {@link fork} instead; `swap` remains the direct
   * initializer a fork uses and the seam the context unit test exercises.
   */
  swap(context: RouteContext): void {
    this.#rawContext = context;
  }

  /**
   * Creates a per-request instance carrying the given context.
   *
   * The route identity (`getClass`, `getHandler`, `getRoute`) is immutable and
   * shared by construction; only the raw request context is per request.
   */
  fork(context: RouteContext): StaticRouteExecutionContext {
    const forked = new StaticRouteExecutionContext(
      this.#targetClass,
      this.#handlerRef,
      this.#route,
    );
    forked.swap(context);
    return forked;
  }

  getClass<T = unknown>(): ClassToken<T> {
    return this.#targetClass as ClassToken<T>;
  }

  getHandler(): (...arguments_: never[]) => unknown {
    return this.#handlerRef;
  }

  getRoute(): Readonly<{ readonly method: RequestMethod; readonly path: string }> {
    return this.#route;
  }

  getContext<T = RouteContext>(): T {
    return this.#rawContext as unknown as T;
  }

  switchToHttp(): this {
    return this;
  }

  switchToRpc(): RpcArgumentsHost {
    const context = this.#rawContext;
    return Object.freeze({
      getData: <T = unknown>(): T => (context as unknown as { readonly body?: T }).body as T,
      getContext: <T = unknown>(): T => context as unknown as T,
    });
  }

  switchToWs(): WsArgumentsHost {
    const context = this.#rawContext;
    return Object.freeze({
      getClient: <T = unknown>(): T => undefined as unknown as T,
      getData: <T = unknown>(): T => (context as unknown as { readonly body?: T }).body as T,
      getPattern: (): string => "",
    });
  }

  getType(): "http" {
    return "http";
  }

  getRequest<T = unknown>(): T {
    return this.#rawContext as unknown as T;
  }
}
