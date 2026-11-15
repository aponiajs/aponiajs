import {
  AponiaError,
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

/** What every request through one kernel runs with. */
interface KernelRuntime {
  readonly store: Record<string, unknown>;
  readonly globalPipes: readonly ResolvedPipe[];
  readonly maxBodyBytes: number | undefined;
  readonly renderView: HttpKernelOptions["renderView"];
  readonly logger: LoggerService | undefined;
}

/**
 * Builds the kernel a host dispatches requests into.
 *
 * The kernel owns the request pipeline once a route matches: decode and
 * validate, apply the declared headers and status, run guards and interceptors,
 * call the handler, serialize, and answer. A failure is offered to the route's
 * filters first and answered as Problem Details last.
 *
 * @param options - The mounts, logger, state, and policies to run with.
 * @returns The kernel.
 */
export function createHttpKernel(options: HttpKernelOptions): HttpKernel {
  const matcher = createRouteMatcher(options.routes);
  const runtime: KernelRuntime = {
    store: options.store ?? {},
    globalPipes: options.globalPipes ?? [],
    maxBodyBytes: options.maxBodyBytes,
    renderView: options.renderView,
    logger: options.logger,
  };

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
        buildResponse(await execute(match, context, runtime), context.set, request.method);
      const result =
        options.middleware === undefined
          ? await respond()
          : await options.middleware(context, respond);

      return result instanceof Response
        ? result
        : buildResponse(result, context.set, request.method);
    } catch (error) {
      return await answerFailure(error, match, context, runtime);
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
    status: (status, body) => {
      set.status = status;
      return buildResponse(body, set, request.method);
    },
    ...(info?.ip === undefined ? {} : { server: { requestIP: () => ({ address: info.ip }) } }),
    ...(info?.native === undefined ? {} : { native: info.native }),
  } as PlatformRouteContext;
}

async function execute(
  match: RouteMatch,
  context: PlatformRouteContext,
  runtime: KernelRuntime,
): Promise<unknown> {
  const { mount } = match;
  const { route } = mount;

  await decodeAndValidate(mount, context, runtime);
  applyDeclaredSettings(route, context);

  const instance = mount.resolveInstance?.() ?? mount.instance;
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

async function decodeAndValidate(
  mount: MountedRoute,
  context: PlatformRouteContext,
  runtime: KernelRuntime,
): Promise<void> {
  const { schema } = mount.route;
  if (schema === undefined) {
    return;
  }

  const state = context as unknown as Record<string, unknown>;
  if (schema.body !== undefined) {
    const body = await readBody(context.request, runtime.maxBodyBytes);
    state.body = await validateSlot(schema.body, body, "body", false);
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

function applyDeclaredSettings(route: MountedRoute["route"], context: PlatformRouteContext): void {
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
}

function toEventStream(value: unknown, context: PlatformRouteContext): Response {
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

async function answerFailure(
  error: unknown,
  match: RouteMatch,
  context: PlatformRouteContext,
  runtime: KernelRuntime,
): Promise<Response> {
  if (error instanceof HttpError) {
    return error.toResponse();
  }

  const host = new StaticRouteExecutionContext(match.mount.instance, () => undefined, {
    method: match.mount.route.method,
    path: match.mount.route.path,
  }).fork(context);

  for (const filter of match.mount.filters) {
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
      return problemResponse(filterFailure);
    }
  }

  reportFailure(runtime.logger, error);
  return problemResponse(error);
}

function matchesFilter(exceptions: readonly ClassToken<unknown>[], error: unknown): boolean {
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
