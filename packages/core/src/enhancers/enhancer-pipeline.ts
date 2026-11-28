import type { CanActivate, RouteContext } from "@aponiajs/common";
import type { StaticRouteExecutionContext } from "./static-execution-context.ts";

function applyForbiddenStatus(context: RouteContext): void {
  if (context.set) {
    context.set.status = 403;
    if (
      context.set.headers &&
      typeof context.set.headers === "object" &&
      !context.set.headers["content-type"]
    ) {
      context.set.headers["content-type"] = "application/problem+json";
    }
  }
}

function extractForbiddenResponse(context: RouteContext, forbiddenResponse: unknown): unknown {
  applyForbiddenStatus(context);
  return forbiddenResponse instanceof Response ? forbiddenResponse.clone() : forbiddenResponse;
}

function runRemainingGuards(
  guards: readonly CanActivate[],
  startIndex: number,
  execContext: StaticRouteExecutionContext,
  context: RouteContext,
  forbiddenResponse: unknown,
  promise: Promise<boolean>,
): Promise<unknown> {
  return promise.then((allowed) => {
    if (!allowed) {
      return extractForbiddenResponse(context, forbiddenResponse);
    }
    for (let i = startIndex; i < guards.length; i++) {
      const result = guards[i]!.canActivate(execContext);
      if (result === false) {
        return extractForbiddenResponse(context, forbiddenResponse);
      }
      if (result instanceof Promise) {
        return runRemainingGuards(guards, i + 1, execContext, context, forbiddenResponse, result);
      }
    }
    return undefined;
  });
}

/**
 * Compiles a list of guards into an inlined, unrolled lifecycle hook that swaps
 * the execution context pointer without allocating per-request objects, and
 * fast-aborts on rejection without throwing or unwinding the call stack.
 */
function isZeroArgGuard(guard: CanActivate): boolean {
  if (guard.canActivate.length !== 0) {
    return false;
  }
  return !/\barguments\b/.test(Function.prototype.toString.call(guard.canActivate));
}

/**
 * Compiles route guards into an unrolled synchronous-capable hook when possible.
 */
export function compileUnrolledGuards(
  guards: readonly CanActivate[],
  execContext: StaticRouteExecutionContext,
  forbiddenResponse: unknown,
): ((context: RouteContext) => unknown) | undefined {
  if (guards.length === 0) {
    return undefined;
  }

  if (guards.length === 1) {
    const g0 = guards[0]!;
    if (isZeroArgGuard(g0)) {
      return function zeroArgSingleGuardHook(context: RouteContext) {
        const result = (g0.canActivate as () => boolean | Promise<boolean>)();
        if (result === false) {
          return extractForbiddenResponse(context, forbiddenResponse);
        }
        if (result instanceof Promise) {
          return result.then((allowed) => {
            if (!allowed) {
              return extractForbiddenResponse(context, forbiddenResponse);
            }
            return undefined;
          });
        }
        return undefined;
      };
    }
    return function singleGuardHook(context: RouteContext) {
      const requestContext = execContext.fork(context);
      const result = g0.canActivate(requestContext);
      if (result === false) {
        return extractForbiddenResponse(context, forbiddenResponse);
      }
      if (result instanceof Promise) {
        return result.then((allowed) => {
          if (!allowed) {
            return extractForbiddenResponse(context, forbiddenResponse);
          }
          return undefined;
        });
      }
      return undefined;
    };
  }

  if (guards.length === 2) {
    const g0 = guards[0]!;
    const g1 = guards[1]!;
    return function twoGuardsHook(context: RouteContext) {
      const requestContext = execContext.fork(context);
      const res0 = g0.canActivate(requestContext);
      if (res0 === false) {
        return extractForbiddenResponse(context, forbiddenResponse);
      }
      if (res0 instanceof Promise) {
        return res0.then((allowed0) => {
          if (!allowed0) {
            return extractForbiddenResponse(context, forbiddenResponse);
          }
          const res1 = g1.canActivate(requestContext);
          if (res1 === false) {
            return extractForbiddenResponse(context, forbiddenResponse);
          }
          if (res1 instanceof Promise) {
            return res1.then((allowed1) => {
              if (!allowed1) {
                return extractForbiddenResponse(context, forbiddenResponse);
              }
              return undefined;
            });
          }
          return undefined;
        });
      }

      const res1 = g1.canActivate(requestContext);
      if (res1 === false) {
        return extractForbiddenResponse(context, forbiddenResponse);
      }
      if (res1 instanceof Promise) {
        return res1.then((allowed1) => {
          if (!allowed1) {
            return extractForbiddenResponse(context, forbiddenResponse);
          }
          return undefined;
        });
      }
      return undefined;
    };
  }

  return function multiGuardHook(context: RouteContext) {
    const requestContext = execContext.fork(context);
    for (let i = 0; i < guards.length; i++) {
      const result = guards[i]!.canActivate(requestContext);
      if (result === false) {
        return extractForbiddenResponse(context, forbiddenResponse);
      }
      if (result instanceof Promise) {
        return runRemainingGuards(
          guards,
          i + 1,
          requestContext,
          context,
          forbiddenResponse,
          result,
        );
      }
    }
    return undefined;
  };
}

/**
 * Alias for compileUnrolledGuards matching alternative naming in specifications.
 */
export const compileGuardsHook = compileUnrolledGuards;
