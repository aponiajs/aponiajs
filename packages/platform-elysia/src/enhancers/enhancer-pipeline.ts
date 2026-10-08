import type { CanActivate } from "@aponiajs/common";
import type { StaticRouteExecutionContext } from "./static-execution-context.ts";

interface StatusMutableContext {
  set?: {
    status?: number | string;
    headers?: Record<string, string>;
  };
}

function applyForbiddenStatus(context: StatusMutableContext): void {
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

function extractForbiddenResponse(
  context: StatusMutableContext,
  forbiddenResponse: unknown,
): unknown {
  applyForbiddenStatus(context);
  return forbiddenResponse instanceof Response ? forbiddenResponse.clone() : forbiddenResponse;
}

function runRemainingGuards(
  guards: readonly CanActivate[],
  startIndex: number,
  execContext: StaticRouteExecutionContext,
  context: StatusMutableContext,
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
export function compileUnrolledGuards(
  guards: readonly CanActivate[],
  execContext: StaticRouteExecutionContext,
  forbiddenResponse: unknown,
): ((context: any) => unknown) | undefined {
  if (guards.length === 0) {
    return undefined;
  }

  if (guards.length === 1) {
    const g0 = guards[0]!;
    return function singleGuardHook(context: any) {
      execContext.swap(context);
      const result = g0.canActivate(execContext);
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
    return function twoGuardsHook(context: any) {
      execContext.swap(context);
      const res0 = g0.canActivate(execContext);
      if (res0 === false) {
        return extractForbiddenResponse(context, forbiddenResponse);
      }
      if (res0 instanceof Promise) {
        return res0.then((allowed0) => {
          if (!allowed0) {
            return extractForbiddenResponse(context, forbiddenResponse);
          }
          const res1 = g1.canActivate(execContext);
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

      const res1 = g1.canActivate(execContext);
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

  return function multiGuardHook(context: any) {
    execContext.swap(context);
    for (let i = 0; i < guards.length; i++) {
      const result = guards[i]!.canActivate(execContext);
      if (result === false) {
        return extractForbiddenResponse(context, forbiddenResponse);
      }
      if (result instanceof Promise) {
        return runRemainingGuards(guards, i + 1, execContext, context, forbiddenResponse, result);
      }
    }
    return undefined;
  };
}

/**
 * Alias for compileUnrolledGuards matching alternative naming in specifications.
 */
export const compileGuardsHook = compileUnrolledGuards;
