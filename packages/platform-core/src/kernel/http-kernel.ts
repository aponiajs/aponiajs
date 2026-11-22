import {
  AponiaError,
  applyDeprecationHeaders,
  type ClassToken,
  type LoggerService,
  type RouteParameterMetadata,
} from "@aponiajs/common";
import { compileUnrolledGuards } from "../enhancers/enhancer-pipeline.ts";
import { StaticRouteExecutionContext } from "../enhancers/static-execution-context.ts";
import { HttpError } from "../errors/http-error.ts";
import type { ResolvedPipe } from "../pipes/pipe-resolver.types.ts";
import { buildArguments } from "./parameter-binding.ts";
import { readBody, readCookies, readHeaders, readQuery } from "./request-decoding.ts";
import { buildResponse } from "./response-building.ts";
import { createRouteMatcher } from "./route-matcher.ts";
import type {
  HostRequestInfo,
  HttpKernel,
  HttpKernelOptions,
  MountedRoute,
  PlatformRouteContext,
  RouteMatch,
} from "./kernel.types.ts";
import { validateSlot } from "./validation.ts";

/**
 * What one request through the shared pipeline runs with.
 *
 * A platform supplies its own native route, request, and response objects; this
 * runtime states only what the pipeline itself needs, which is what lets every
 * platform execute the same enhancer, pipe, and filter semantics.
 */
export interface RouteExecutionRuntime {
  /** Application state handed to every request as `store`. */
  readonly store: Record<string, unknown>;
  /** Application pipes, which run before a route's own. */
  readonly globalPipes: readonly ResolvedPipe[];
  /** The largest request body to read, in bytes. */
  readonly maxBodyBytes: number | undefined;
  /** Renders a `@Render()` route's view. */
  readonly renderView: HttpKernelOptions["renderView"];
  /** The logger failures are reported through. */
  readonly logger: LoggerService | undefined;
}

/** Builds the runtime one platform's routes execute with. */
export function createRouteExecutionRuntime(options: HttpKernelOptions): RouteExecutionRuntime {
  return {
    store: options.store ?? {},
    globalPipes: options.globalPipes ?? [],
    maxBodyBytes: options.maxBodyBytes,
    renderView: options.renderView,
    logger: options.logger,
  };
}

/**
 * Builds the kernel a host dispatches requests into.
 *
 * The kernel owns routing only when a host wants one shared matcher. A platform
 * with its own router mounts each route through {@link createRouteHandler} and
 * keeps its native matching, middleware, and response objects.
 *
 * @param options - The mounts, logger, state, and policies to run with.
 * @returns The kernel.
 */
export function createHttpKernel(options: HttpKernelOptions): HttpKernel {
  const matcher = createRouteMatcher(options.routes);
  const runtime = createRouteExecutionRuntime(options);

  async function tryHandle(
    request: Request,
    info?: HostRequestInfo,
  ): Promise<Response | undefined> {
    const url = new URL(request.url);
    const pathname = info?.path ?? url.pathname;
    const match = matcher.match(request.method, pathname);
    if (match === undefined) {
      return undefined;
    }

    const context = createContext(request, url, match, runtime.store, info);
    try {
      const respond = async (): Promise<Response> =>
        buildRouteResponse(await executeMountedRoute(match.mount, context, runtime), context);
      const result =
        options.middleware === undefined
          ? await respond()
          : await options.middleware(context, respond);

      return result instanceof Response ? result : buildRouteResponse(result, context);
    } catch (error) {
      return await answerRouteFailure(error, match.mount, context, runtime);
    }
  }

  return Object.freeze({
    match: (method: string, pathname: string) => matcher.match(method, pathname),
    tryHandle,
    async handle(request: Request, info?: HostRequestInfo): Promise<Response> {
      const answered = await tryHandle(request, info);
      if (answered !== undefined) {
        return answered;
      }
      return new HttpError("Not Found", {
        code: "ROUTE_NOT_FOUND",
        detail: `No route answers ${request.method} ${new URL(request.url).pathname}.`,
      }).toResponse();
    },
  });
}

/**
 * Creates the handler one mounted route runs on a platform's own router.
 *
 * The platform builds a {@link PlatformRouteContext} from its native request and
 * response objects and calls this handler; everything that defines the request
 * contract — decoding, validation, guards, interceptors, pipes, the handler,
 * serialization, views, SSE, and the filter chain — runs here, so every platform
 * executes the same semantics without sharing a router.
 *
 * @param mount - The route the platform mounted.
 * @param options - The logger, state, pipes, and policies the boot resolved.
 * @returns A handler that answers one request with a `Response`.
 */
export function createRouteHandler(
  mount: MountedRoute,
  options: HttpKernelOptions,
): (context: PlatformRouteContext) => Promise<Response> {
  const runtime = createRouteExecutionRuntime(options);
  return async (context: PlatformRouteContext): Promise<Response> => {
    try {
      return buildRouteResponse(await executeMountedRoute(mount, context, runtime), context);
    } catch (error) {
      return await answerRouteFailure(error, mount, context, runtime);
    }
  };
}

/**
 * Executes one mounted route against a context the platform built.
 *
 * @param mount - The mounted route.
 * @param context - The request context.
 * @param runtime - What the pipeline runs with.
 * @returns The handler's value, after interceptors, serialization, render, or SSE.
 */
export async function executeMountedRoute(
  mount: MountedRoute,
  context: PlatformRouteContext,
  runtime: RouteExecutionRuntime,
): Promise<unknown> {
  const { route } = mount;

  await decodeRouteRequest(mount, context, runtime);
  applyRouteSettings(route, context);

  const instance = mount.resolveInstance?.(context) ?? mount.instance;
  const handler = (instance as Record<PropertyKey, unknown>)[route.propertyKey] as
    | ((...arguments_: unknown[]) => unknown)
    | undefined;
  if (typeof handler !== "function") {
    throw new HttpError("Internal Server Error", {
      code: "INVALID_CONTROLLER",
      detail: `The handler "${String(route.propertyKey)}" is missing from its controller.`,
    });
  }

  const executionContext = new StaticRouteExecutionContext(instance, handler, {
    method: route.method,
    path: route.path,
  }).fork(context);

  if (mount.guards.length > 0) {
    const guard = compileUnrolledGuards(
      mount.guards,
      executionContext,
      new HttpError("Forbidden", { code: "FORBIDDEN" }).toResponse(),
    );
    if (guard !== undefined) {
      const refusal = await guard(context);
      if (refusal !== undefined) {
        return refusal;
      }
    }
  }

  for (const interceptor of mount.interceptors) {
    await interceptor.interceptBefore?.(executionContext);
  }

  const arguments_ = await buildArguments(
    route.parameters as readonly RouteParameterMetadata[],
    context,
    route.declaredParameterCount,
    handler.length,
    mount.pipes,
    runtime.globalPipes,
  );

  let value = await handler.call(instance, ...arguments_);

  for (const interceptor of [...mount.interceptors].reverse()) {
    const after = await interceptor.interceptAfter?.(executionContext, value);
    if (after !== undefined) {
      value = after;
    }
  }

  if (route.serializer !== undefined) {
    value = await route.serializer(value, context);
  }

  if (route.view !== undefined) {
    if (runtime.renderView === undefined) {
      throw new HttpError("Internal Server Error", {
        code: "VIEW_ENGINE_MISSING",
        detail: "The route renders a view, but the platform mounted no view renderer.",
      });
    }
    const html = await runtime.renderView(route.view.template, value, route.view.options);
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  if (route.sse === true) {
    return toEventStream(value, context);
  }

  return value;
}

/**
 * Decodes and validates the slots one route declares.
 *
 * A body is read when the route declares a body slot or binds `@Body()`;
 * query, params, headers, and cookies are validated only when the schema names
 * them. The decoded values replace the raw context fields, so a handler reads
 * exactly what the validator produced.
 */
export async function decodeRouteRequest(
  mount: MountedRoute,
  context: PlatformRouteContext,
  runtime: RouteExecutionRuntime,
): Promise<void> {
  const { schema } = mount.route;
  if (schema === undefined && !mount.route.parameters.some((entry) => entry.kind === "body")) {
    return;
  }

  const state = context as unknown as Record<string, unknown>;
  if (schema?.body !== undefined || mount.route.parameters.some((entry) => entry.kind === "body")) {
    const body = await readBody(context.request, runtime.maxBodyBytes);
    state.body =
      schema?.body === undefined ? body : await validateSlot(schema.body, body, "body", false);
  }
  if (schema === undefined) {
    return;
  }
  if (schema.query !== undefined) {
    state.query = await validateSlot(schema.query, context.query, "query", true);
  }
  if (schema.params !== undefined) {
    state.params = await validateSlot(schema.params, context.params, "params", true);
  }
  if (schema.headers !== undefined) {
    state.headers = await validateSlot(schema.headers, context.headers, "headers", true);
  }
  if (schema.cookie !== undefined) {
    // A cookie slot declares plain values; the context keeps `{ value }` records.
    const raw = Object.fromEntries(
      Object.entries(context.cookie).map(([name, cookie]) => [name, cookie.value]),
    );
    const validated = await validateSlot(schema.cookie, raw, "cookie", true);
    state.cookie =
      typeof validated === "object" && validated !== null
        ? Object.fromEntries(
            Object.entries(validated as Record<string, unknown>).map(([name, value]) => [
              name,
              { value },
            ]),
          )
        : validated;
  }
}

/** Applies the headers, status, and SSE settings one route declares. */
export function applyRouteSettings(
  route: MountedRoute["route"],
  context: PlatformRouteContext,
): void {
  if (route.httpCode !== undefined) {
    context.set.status = route.httpCode;
  }
  for (const [name, value] of Object.entries(route.responseHeaders ?? {})) {
    context.set.headers[name] =
      typeof value === "string" || typeof value === "number" ? value : value.join(", ");
  }
  if (route.sse === true) {
    context.set.headers["content-type"] = "text/event-stream";
    context.set.headers["cache-control"] = "no-cache";
    context.set.headers["connection"] = "keep-alive";
  }
  // Before the guards, so a refusal carries the policy too.
  if (route.deprecation !== undefined) {
    applyDeprecationHeaders(context.set.headers, route.deprecation);
  }
}

/** Builds the response one route's value and settings answer with. */
export function buildRouteResponse(value: unknown, context: PlatformRouteContext): Response {
  // A `Response` the pipeline built keeps its own status and body, and gains the
  // headers the route declared — which is what makes `@Header()` and
  // `@Deprecated()` observable on a guard refusal too.
  return value instanceof Response
    ? withSettingsHeaders(value, context)
    : buildResponse(value, context.set, context.request.method);
}

/** Streams an async iterable as Server-Sent Events. */
export function toEventStream(value: unknown, context: PlatformRouteContext): Response {
  const iterable = value as Partial<AsyncIterable<unknown>> | null;
  if (iterable === null || typeof iterable?.[Symbol.asyncIterator] !== "function") {
    return buildResponse(value, context.set, "GET");
  }

  const iterator = (iterable as AsyncIterable<unknown>)[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done === true) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(next.value)}\n\n`));
    },
    async cancel() {
      await iterator.return?.();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

/**
 * Answers a failure through the route's filters and the default mapping.
 *
 * A filter answers with a value or a `Response`; a `null` or `undefined` answer
 * declines it. A throwing filter is reported and declines, because one filter's
 * failure may not replace the answer the remaining chain would give.
 */
export async function answerRouteFailure(
  error: unknown,
  mount: MountedRoute,
  context: PlatformRouteContext,
  runtime: RouteExecutionRuntime,
): Promise<Response> {
  if (error instanceof HttpError) {
    return withSettingsHeaders(error.toResponse(), context);
  }

  const host = new StaticRouteExecutionContext(mount.instance, () => undefined, {
    method: mount.route.method,
    path: mount.route.path,
  }).fork(context);

  for (const filter of mount.filters) {
    if (!matchesFilter(filter.exceptions, error)) {
      continue;
    }
    try {
      const answered = await filter.instance.catch(error, host);
      if (answered !== undefined && answered !== null) {
        return answered instanceof Response
          ? answered
          : buildResponse(answered, context.set, context.request.method);
      }
    } catch (filterFailure) {
      reportFailure(runtime.logger, filterFailure);
    }
  }

  reportFailure(runtime.logger, error);
  return withSettingsHeaders(problemResponse(error), context);
}

/**
 * Carries the route's declared settings onto a failure answer.
 *
 * A filter's answer already runs through `buildResponse`, which applies them;
 * the two paths here — an `HttpError`'s own response and the default problem
 * document — build their responses without the context. A permission refusal
 * still has to carry the headers the route declared, which is what makes
 * `@Deprecated()` and `@Header()` observable on the refusal as well.
 */
function withSettingsHeaders(response: Response, context: PlatformRouteContext): Response {
  const entries = Object.entries(context.set.headers);
  if (entries.length === 0) {
    return response;
  }

  const headers = new Headers(response.headers);
  for (const [name, value] of entries) {
    if (value === undefined || headers.has(name)) {
      continue;
    }
    headers.set(name, Array.isArray(value) ? value.join(", ") : String(value));
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function createContext(
  request: Request,
  url: URL,
  match: RouteMatch,
  store: Record<string, unknown>,
  info: HostRequestInfo | undefined,
): PlatformRouteContext {
  const set: {
    status?: number | string;
    headers: Record<string, string | number | string[] | undefined>;
  } = {
    headers: {},
  };
  return {
    body: undefined,
    query: readQuery(url),
    params: match.params,
    headers: readHeaders(request),
    cookie: readCookies(request),
    request,
    path: match.mount.route.path,
    set,
    store,
    ip: info?.ip,
    host: url.host,
    status: (status, body) => {
      set.status = status;
      return buildResponse(body, set, request.method);
    },
    ...(info?.ip === undefined ? {} : { server: { requestIP: () => ({ address: info.ip }) } }),
    ...(info?.native === undefined ? {} : { native: info.native }),
  } as PlatformRouteContext;
}

/** Reports whether a filter's `@Catch()` list covers an exception, empty meaning all. */
export function matchesFilter(exceptions: readonly ClassToken<unknown>[], error: unknown): boolean {
  if (exceptions.length === 0) {
    return true;
  }
  return exceptions.some(
    (type) => error instanceof (type as unknown as new (...arguments_: never[]) => unknown),
  );
}

function reportFailure(logger: LoggerService | undefined, error: unknown): void {
  if (logger === undefined) {
    return;
  }
  try {
    logger.error(
      error instanceof Error ? error.message : "An unhandled request failure occurred.",
      "ExceptionsHandler",
    );
  } catch {
    // A logger that throws may not turn one failure into two.
  }
}

function problemResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return error.toResponse();
  }
  if (error instanceof AponiaError) {
    return new HttpError("Internal Server Error", {
      code: error.code,
      detail: "The request could not be completed.",
    }).toResponse();
  }
  return new HttpError("Internal Server Error", {
    code: "INTERNAL_SERVER_ERROR",
    detail: "The request could not be completed.",
  }).toResponse();
}
