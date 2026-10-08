import type {
  ClassToken,
  ExecutionContext,
  HttpArgumentsHost,
  RequestMethod,
  RouteContext,
} from "@aponiajs/common";

const defaultRoute = Object.freeze({
  method: "GET" as RequestMethod,
  path: "/",
});

/**
 * A reusable execution context that eliminates per-request heap allocations
 * by swapping its internal context pointer before invoking route enhancers.
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

  /** Swaps the active request context pointer for the current request turn. */
  swap(context: RouteContext): void {
    this.#rawContext = context;
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

  getType(): "http" {
    return "http";
  }

  getRequest<T = unknown>(): T {
    return this.#rawContext as unknown as T;
  }
}
