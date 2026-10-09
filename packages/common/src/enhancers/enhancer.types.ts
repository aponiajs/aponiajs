import type { RequestMethod } from "../decorators/decorators.types.ts";
import type { RouteContext } from "../routing/route-schema.types.ts";
import type { ClassToken } from "../tokens/token.types.ts";

/**
 * What a guard, an interceptor, and a filter are given about the route they
 * are running for.
 *
 * The request accessor returns `RouteContext`, the platform-neutral description
 * this framework already publishes, rather than a platform type: `common` may
 * not reference Elysia.
 */
export interface HttpArgumentsHost {
  getRequest(): RouteContext;
}

/**
 * What a filter is given. One transport exists, so the per-transport dispatch
 * Nest's `ArgumentsHost` performs is not carried: `switchToHttp()` is the only
 * switch, and it is a thin alias over `getContext()` kept because migrated Nest
 * code calls it on nearly every guard. `getType()` answers the constant
 * `"http"` for the same reason — a second transport must force an explicit
 * decision here rather than arriving as another string nobody matched on.
 */
export interface ArgumentsHost {
  getContext(): RouteContext;
  switchToHttp(): HttpArgumentsHost;
  getType(): "http";
}

/** What a guard and an interceptor are given: the host plus the route's class, handler, and mounted path. */
export interface ExecutionContext extends ArgumentsHost {
  /**
   * The controller class the route belongs to.
   *
   * @returns The controller token the route was mounted from.
   */
  getClass<T>(): ClassToken<T>;
  /**
   * The controller's own method, not the platform's invoker.
   *
   * @returns The handler the guard protects.
   */
  getHandler(): (...arguments_: never[]) => unknown;
  /**
   * The mounted route, with the fully joined path.
   *
   * @returns The method and path the request was handled by.
   */
  getRoute(): Readonly<{ readonly method: RequestMethod; readonly path: string }>;
}

/**
 * A guard: answers whether the request reaches the handler.
 *
 * Returning `false` refuses with `403`; throwing an `HttpError` answers any
 * other status (notably `401`). A guard that throws anything else is a
 * failure, and reaches the exception filters.
 */
export interface CanActivate {
  /**
   * Decides whether the request proceeds.
   *
   * @param context - The route, handler, and request the guard protects.
   * @returns `true` to proceed, `false` to refuse with `403`.
   */
  canActivate(context: ExecutionContext): boolean | Promise<boolean>;
}

/**
 * An interceptor's two halves.
 *
 * Nest's `intercept(context, next)` with `next.handle()` is deliberately not
 * carried: a callable `next` requires owning the handler invocation, which
 * forfeits Elysia's source-static handler compilation for every route carrying
 * an enhancer. See the design document.
 */
export interface Interceptor {
  interceptBefore?(context: ExecutionContext): void | Promise<void>;

  /**
   * Receives the handler's result and returns what the response should carry,
   * including `undefined` to leave it unchanged. A returned Promise is awaited,
   * so an asynchronous interceptor is supported.
   */
  interceptAfter?(context: ExecutionContext, response: unknown): unknown;
}

/**
 * A filter: answers an exception the route threw, or declines it.
 *
 * Filters run most-specific-first; the first entry that answers wins, and the
 * default Problem Details mapping answers last what every filter declined.
 */
export interface ExceptionFilter {
  /**
   * Answers the exception, or returns `undefined` or `null` to decline it,
   * leaving the decision to whatever answers next. A returned Promise is
   * awaited, so an asynchronous filter is supported.
   *
   * @param exception - The thrown value to answer.
   * @param host - The request the exception escaped from.
   * @returns The response, or `undefined`/`null` to decline.
   */
  catch(exception: unknown, host: ArgumentsHost): unknown;
}
