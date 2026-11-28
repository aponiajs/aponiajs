import {
  HttpError,
  slicePathname,
  type CanActivate,
  type LoggerService,
  type MountedRoute,
} from "@aponiajs/common";

/** O(1) static route fast-dispatch table compiled at boot for eligible static routes. */
export interface StaticDispatchTable {
  /** Dispatches by O(1) method->path lookup; returns `undefined` on miss. */
  dispatch(request: Request): Response | Promise<Response> | undefined;
  /** Pre-built handlers keyed by path for `Bun.serve({ routes })` registration. */
  readonly bunRoutes: Readonly<
    Record<string, Response | ((request: Request) => Response | Promise<Response>)>
  >;
}

/**
 * Options controlling whether and how `compileStaticDispatchTable` builds the O(1) table.
 */
export interface StaticDispatchCompileOptions {
  readonly enabled?: boolean | undefined;
  readonly hasNativePlugins?: boolean | undefined;
  readonly hasMiddleware?: boolean | undefined;
  readonly hasHttpPolicies?: boolean | undefined;
  readonly hasRequestHooks?: boolean | undefined;
  readonly hasVersioning?: boolean | undefined;
  readonly hasRequestContext?: boolean | undefined;
  readonly hasStaticAssets?: boolean | undefined;
  readonly globalPipesCount?: number | undefined;
  readonly logger?: LoggerService | undefined;
  readonly onError?: ((error: unknown, request: Request) => Response | undefined) | undefined;
}

type StaticRouteFn = (request: Request) => Response | Promise<Response>;

const STATIC_FORBIDDEN_BODY = JSON.stringify({
  type: "about:blank",
  title: "Forbidden",
  status: 403,
  detail: "A guard refused this request.",
  code: "FORBIDDEN",
});

const STATIC_500_BODY = JSON.stringify({
  type: "about:blank",
  title: "Internal Server Error",
  status: 500,
  detail: "The request could not be completed.",
  code: "INTERNAL_SERVER_ERROR",
});

const PROBLEM_FORBIDDEN_INIT = {
  status: 403,
  headers: { "content-type": "application/problem+json" },
} as const;

const PROBLEM_500_INIT = {
  status: 500,
  headers: { "content-type": "application/problem+json" },
} as const;

function isZeroArgSyncEligibleGuard(guard: CanActivate): boolean {
  return (
    guard.canActivate.length === 0 &&
    !/\barguments\b/.test(Function.prototype.toString.call(guard.canActivate))
  );
}

function isStaticEligibleRoute(mount: MountedRoute): boolean {
  const { route } = mount;
  if (
    route.method === "ALL" ||
    route.path.includes(":") ||
    route.path.includes("*") ||
    mount.resolveInstance !== undefined ||
    mount.interceptors.length > 0 ||
    mount.filters.length > 0 ||
    mount.pipes.length > 0 ||
    route.sse === true ||
    route.view !== undefined ||
    route.serializer !== undefined ||
    route.schema !== undefined ||
    route.httpCode !== undefined ||
    route.responseHeaders !== undefined ||
    route.deprecation !== undefined
  ) {
    return false;
  }

  if (route.parameters.length > 0) {
    return false;
  }

  const handler = (mount.instance as Record<PropertyKey, unknown>)[route.propertyKey];
  if (typeof handler !== "function") {
    return false;
  }
  if ((route.declaredParameterCount ?? 0) > 0 || handler.length > 0) {
    return false;
  }

  for (let i = 0; i < mount.guards.length; i += 1) {
    if (!isZeroArgSyncEligibleGuard(mount.guards[i]!)) {
      return false;
    }
  }

  return true;
}

function answerStaticError(
  error: unknown,
  logger: LoggerService | undefined,
  onError: ((error: unknown, request: Request) => Response | undefined) | undefined,
  request: Request,
): Response {
  if (error instanceof HttpError) {
    return error.toResponse();
  }
  if (
    error !== null &&
    typeof error === "object" &&
    typeof (error as { readonly toResponse?: unknown }).toResponse === "function"
  ) {
    return (error as { toResponse(): Response }).toResponse();
  }
  if (onError !== undefined) {
    const handled = onError(error, request);
    if (handled !== undefined) {
      return handled;
    }
  }
  if (logger !== undefined) {
    try {
      logger.error(
        error instanceof Error ? error.message : "An unhandled request failure occurred.",
        "ExceptionsHandler",
      );
    } catch {
      // A throwing logger must not mask the HTTP error response.
    }
  }
  return new Response(STATIC_500_BODY, PROBLEM_500_INIT);
}

function toFastResponse(value: unknown, method: string): Response {
  if (value instanceof Response) {
    return value;
  }
  if (value === undefined || value === null) {
    return new Response(null);
  }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer || value instanceof Blob) {
    return new Response(value);
  }
  if (typeof value === "string") {
    return new Response(method === "HEAD" ? null : value, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  if (method === "HEAD") {
    return new Response(null, { headers: { "content-type": "application/json; charset=utf-8" } });
  }
  return Response.json(value);
}

function compileSingleStaticHandler(
  mount: MountedRoute,
  logger: LoggerService | undefined,
  onError: ((error: unknown, request: Request) => Response | undefined) | undefined,
): StaticRouteFn {
  const { instance, guards, route } = mount;
  const handler = (instance as Record<PropertyKey, unknown>)[route.propertyKey] as () => unknown;
  const method = route.method;

  const invokeHandler = (request: Request): Response | Promise<Response> => {
    try {
      const value = handler.call(instance);
      if (
        value !== null &&
        (typeof value === "object" || typeof value === "function") &&
        typeof (value as Promise<unknown>).then === "function"
      ) {
        return (value as Promise<unknown>).then(
          (resolved) => toFastResponse(resolved, method),
          (error) => answerStaticError(error, logger, onError, request),
        );
      }
      return toFastResponse(value, method);
    } catch (error) {
      return answerStaticError(error, logger, onError, request);
    }
  };

  if (guards.length === 0) {
    return (request) => invokeHandler(request);
  }

  if (guards.length === 1) {
    const g0 = guards[0]!.canActivate as () => boolean | Promise<boolean>;
    const g0This = guards[0]!;
    return (request) => {
      try {
        const allowed = g0.call(g0This);
        if (allowed === false) {
          return new Response(STATIC_FORBIDDEN_BODY, PROBLEM_FORBIDDEN_INIT);
        }
        if (allowed !== true && typeof (allowed as Promise<boolean>)?.then === "function") {
          return (allowed as Promise<boolean>).then(
            (ok) =>
              ok
                ? invokeHandler(request)
                : new Response(STATIC_FORBIDDEN_BODY, PROBLEM_FORBIDDEN_INIT),
            (error) => answerStaticError(error, logger, onError, request),
          );
        }
        return invokeHandler(request);
      } catch (error) {
        return answerStaticError(error, logger, onError, request);
      }
    };
  }

  return (request) => {
    const runFrom = (index: number): Response | Promise<Response> => {
      for (let i = index; i < guards.length; i += 1) {
        const guard = guards[i]!;
        const allowed = (guard.canActivate as () => boolean | Promise<boolean>)();
        if (allowed === false) {
          return new Response(STATIC_FORBIDDEN_BODY, PROBLEM_FORBIDDEN_INIT);
        }
        if (allowed !== true && typeof (allowed as Promise<boolean>)?.then === "function") {
          return (allowed as Promise<boolean>).then(
            (ok) =>
              ok ? runFrom(i + 1) : new Response(STATIC_FORBIDDEN_BODY, PROBLEM_FORBIDDEN_INIT),
            (error) => answerStaticError(error, logger, onError, request),
          );
        }
      }
      return invokeHandler(request);
    };
    try {
      return runFrom(0);
    } catch (error) {
      return answerStaticError(error, logger, onError, request);
    }
  };
}

/**
 * Compiles an O(1) static route lookup table when the application has no
 * interfering middleware, native plugins, HTTP policies, or request hooks.
 *
 * @internal
 */
export function compileStaticDispatchTable(
  routes: readonly MountedRoute[],
  options: StaticDispatchCompileOptions,
): StaticDispatchTable | undefined {
  if (
    options.enabled === false ||
    options.hasNativePlugins === true ||
    options.hasMiddleware === true ||
    options.hasHttpPolicies === true ||
    options.hasRequestHooks === true ||
    options.hasVersioning === true ||
    options.hasRequestContext === true ||
    options.hasStaticAssets === true ||
    (options.globalPipesCount ?? 0) > 0
  ) {
    return undefined;
  }

  const byMethod = new Map<string, Map<string, StaticRouteFn>>();
  const methodPaths = new Map<string, Map<string, StaticRouteFn>>();
  const totalRoutesOnPath = new Map<string, number>();

  for (let i = 0; i < routes.length; i += 1) {
    const p = routes[i]!.route.path;
    totalRoutesOnPath.set(p, (totalRoutesOnPath.get(p) ?? 0) + 1);
  }

  for (let i = 0; i < routes.length; i += 1) {
    const mount = routes[i]!;
    if (!isStaticEligibleRoute(mount)) {
      continue;
    }
    const method = mount.route.method.toUpperCase();
    const path = mount.route.path;
    const fn = compileSingleStaticHandler(mount, options.logger, options.onError);

    let map = byMethod.get(method);
    if (map === undefined) {
      map = new Map<string, StaticRouteFn>();
      byMethod.set(method, map);
    }
    map.set(path, fn);

    let perPath = methodPaths.get(path);
    if (perPath === undefined) {
      perPath = new Map<string, StaticRouteFn>();
      methodPaths.set(path, perPath);
    }
    perPath.set(method, fn);
  }

  if (byMethod.size === 0) {
    return undefined;
  }

  const getMap = byMethod.get("GET");
  const bunRoutes: Record<string, StaticRouteFn> = {};
  for (const [path, methods] of methodPaths) {
    if (methods.size === 1 && methods.has("GET") && totalRoutesOnPath.get(path) === 1) {
      const getFn = methods.get("GET")!;
      bunRoutes[path] = (request: Request) =>
        request.method === "GET" ? getFn(request) : new Response(null, { status: 404 });
    }
  }

  return Object.freeze({
    dispatch(request: Request): Response | Promise<Response> | undefined {
      const method = request.method;
      const map = method === "GET" ? getMap : byMethod.get(method);
      if (map === undefined) {
        return undefined;
      }
      const pathname = slicePathname(request.url);
      const fn = map.get(pathname);
      if (fn !== undefined) {
        return fn(request);
      }
      if (pathname.length > 1 && pathname.charCodeAt(pathname.length - 1) === 47) {
        const trimmed = map.get(pathname.slice(0, -1));
        if (trimmed !== undefined) {
          return trimmed(request);
        }
      }
      return undefined;
    },
    bunRoutes: Object.freeze(bunRoutes),
  });
}
