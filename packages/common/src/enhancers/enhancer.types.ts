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
 * code calls it on nearly every guard.
 */
export interface ArgumentsHost {
  getContext(): RouteContext;
  switchToHttp(): HttpArgumentsHost;
}

/** What a guard and an interceptor are given. */
export interface ExecutionContext extends ArgumentsHost {
  getClass<T>(): ClassToken<T>;
  getHandler(): (...arguments_: never[]) => unknown;
  getRoute(): Readonly<{ readonly method: RequestMethod; readonly path: string }>;
}

export interface CanActivate {
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

export interface ExceptionFilter {
  /**
   * Answers the exception, or returns `undefined` or `null` to decline it,
   * leaving the decision to whatever answers next. A returned Promise is
   * awaited, so an asynchronous filter is supported.
   */
  catch(exception: unknown, host: ArgumentsHost): unknown;
}
