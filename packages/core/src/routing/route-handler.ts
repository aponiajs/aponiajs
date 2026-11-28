import {
  applyDeprecationHeaders,
  compileSlotValidator,
  hasResponseHeaderEntries,
  RouteContextMask,
  type CompiledSlotValidator,
  type LoggerService,
} from "@aponiajs/common";
import { compileUnrolledGuards } from "../enhancers/enhancer-pipeline.ts";
import { StaticRouteExecutionContext } from "../enhancers/static-execution-context.ts";
import { HttpError, matchesFilter } from "@aponiajs/common";
import type { ResolvedPipe } from "@aponiajs/common";
import {
  buildCompiledArguments,
  compileParameterPlan,
  type CompiledArgumentPlan,
} from "../kernel/parameter-binding.ts";
import {
  AponiaError,
  readBody,
  stripDangerousKeys,
  type RouteParameterMetadata,
} from "@aponiajs/common";
import { buildResponse } from "@aponiajs/common";
import { notifyRequestError, type RequestLifecycleHook } from "@aponiajs/common";
import { rememberMatchedRoute } from "@aponiajs/common";
import type { HttpKernelOptions, MountedRoute, PlatformRouteContext } from "@aponiajs/common";

const sharedTextEncoder = new TextEncoder();

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

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
  /** The neutral lifecycle hooks the graph's packages contributed. */
  readonly requestHooks: readonly RequestLifecycleHook[];
}

/** Default maximum request body size (1 MiB) when `maxBodyBytes` is omitted. */
const DEFAULT_MAX_BODY_BYTES = 1_048_576;

/** Builds the runtime one platform's routes execute with. */
export function createRouteExecutionRuntime(options: HttpKernelOptions): RouteExecutionRuntime {
  return {
    store: options.store ?? {},
    globalPipes: options.globalPipes ?? [],
    maxBodyBytes: options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
    renderView: options.renderView,
    logger: options.logger,
    requestHooks: options.requestHooks ?? [],
  };
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
interface CompiledRouteExecution {
  readonly contextMask: number;
  readonly hasBodyDecoding: boolean;
  readonly hasSchemaSlots: boolean;
  readonly hasRouteSettings: boolean;
  readonly flattenedResponseHeaders: readonly (readonly [string, string | readonly string[]])[];
  readonly forbiddenResponse: Response;
  readonly compiledGuardHook: ((context: PlatformRouteContext) => unknown) | undefined;
  readonly compiledBodyValidator: CompiledSlotValidator | undefined;
  readonly compiledQueryValidator: CompiledSlotValidator | undefined;
  readonly compiledParamsValidator: CompiledSlotValidator | undefined;
  readonly compiledHeadersValidator: CompiledSlotValidator | undefined;
  readonly compiledCookieValidator: CompiledSlotValidator | undefined;
  readonly compiledArgPlan: CompiledArgumentPlan | undefined;
  readonly reversedInterceptors: readonly MountedRoute["interceptors"][number][];
  readonly baseExecutionContext: StaticRouteExecutionContext | undefined;
  readonly syncCapable: boolean;
}

function computeRouteContextMask(mount: MountedRoute, handlerLength: number): number {
  const { route } = mount;
  let mask = RouteContextMask.NONE;
  for (let i = 0; i < route.parameters.length; i += 1) {
    const kind = route.parameters[i]!.kind;
    switch (kind) {
      case "params":
        mask |= RouteContextMask.PARAMS;
        break;
      case "query":
        mask |= RouteContextMask.QUERY;
        break;
      case "headers":
        mask |= RouteContextMask.HEADERS;
        break;
      case "cookie":
        mask |= RouteContextMask.COOKIE;
        break;
      case "body":
        mask |= RouteContextMask.BODY;
        break;
      case "ip":
        mask |= RouteContextMask.IP;
        break;
      case "host":
        mask |= RouteContextMask.HOST;
        break;
      case "store":
        mask |= RouteContextMask.STORE;
        break;
      case "set":
      case "status":
        mask |= RouteContextMask.SET_STATUS;
        break;
      default:
        mask |= RouteContextMask.FULL_CONTEXT;
        break;
    }
  }
  if (
    route.parameters.length === 0 &&
    ((route.declaredParameterCount ?? 0) > 0 || handlerLength > 0)
  ) {
    mask |= RouteContextMask.FULL_CONTEXT;
  }
  if (route.schema?.query !== undefined) mask |= RouteContextMask.QUERY;
  if (route.schema?.params !== undefined) mask |= RouteContextMask.PARAMS;
  if (route.schema?.headers !== undefined) mask |= RouteContextMask.HEADERS;
  if (route.schema?.cookie !== undefined) mask |= RouteContextMask.COOKIE;
  if (route.schema?.body !== undefined) mask |= RouteContextMask.BODY;
  if (mount.interceptors.length > 0 || mount.filters.length > 0) {
    mask |= RouteContextMask.FULL_CONTEXT;
  } else {
    for (let i = 0; i < mount.guards.length; i += 1) {
      if (mount.guards[i]!.canActivate.length > 0) {
        mask |= RouteContextMask.FULL_CONTEXT;
        break;
      }
    }
  }
  return mask;
}

function compileRouteExecution(
  mount: MountedRoute,
  runtime: RouteExecutionRuntime,
): CompiledRouteExecution {
  const { route } = mount;
  const staticHandler =
    mount.resolveInstance === undefined
      ? ((mount.instance as Record<PropertyKey, unknown>)[route.propertyKey] as
          | ((...arguments_: unknown[]) => unknown)
          | undefined)
      : undefined;
  const baseExecutionContext =
    typeof staticHandler === "function"
      ? new StaticRouteExecutionContext(mount.instance, staticHandler, {
          method: route.method,
          path: route.path,
        })
      : undefined;
  const forbiddenResponse = new HttpError("Forbidden", { code: "FORBIDDEN" }).toResponse();
  const compiledGuardHook =
    mount.guards.length > 0 && baseExecutionContext !== undefined
      ? compileUnrolledGuards(mount.guards, baseExecutionContext, forbiddenResponse)
      : undefined;

  const schema = route.schema;
  const hasBodyParam = route.parameters.some((entry) => entry.kind === "body");
  const hasBodyDecoding = schema?.body !== undefined || hasBodyParam;
  const hasSchemaSlots =
    schema !== undefined &&
    (schema.query !== undefined ||
      schema.params !== undefined ||
      schema.headers !== undefined ||
      schema.cookie !== undefined);

  const flattenedResponseHeaders = Object.freeze(
    Object.entries(route.responseHeaders ?? {}).map(
      ([name, value]) =>
        [
          name,
          typeof value === "string" || typeof value === "number" ? String(value) : value,
        ] as const,
    ),
  );
  const hasRouteSettings =
    route.httpCode !== undefined ||
    flattenedResponseHeaders.length > 0 ||
    route.sse === true ||
    route.deprecation !== undefined;

  const compiledArgPlan =
    typeof staticHandler === "function"
      ? compileParameterPlan(
          route.parameters as readonly RouteParameterMetadata[],
          mount.pipes,
          runtime.globalPipes,
          route.declaredParameterCount,
          staticHandler.length,
        )
      : undefined;

  const handlerLength = typeof staticHandler === "function" ? staticHandler.length : 0;
  const syncCapable =
    typeof staticHandler === "function" &&
    !hasBodyDecoding &&
    mount.interceptors.length === 0 &&
    route.serializer === undefined &&
    route.view === undefined &&
    route.sse !== true &&
    mount.filters.length === 0 &&
    runtime.requestHooks.length === 0;

  return {
    contextMask: computeRouteContextMask(mount, handlerLength),
    hasBodyDecoding,
    hasSchemaSlots,
    hasRouteSettings,
    flattenedResponseHeaders,
    forbiddenResponse,
    compiledGuardHook,
    compiledBodyValidator: compileSlotValidator(schema?.body, "body", false),
    compiledQueryValidator: compileSlotValidator(schema?.query, "query", true),
    compiledParamsValidator: compileSlotValidator(schema?.params, "params", true),
    compiledHeadersValidator: compileSlotValidator(schema?.headers, "headers", true),
    compiledCookieValidator: compileSlotValidator(schema?.cookie, "cookie", true),
    compiledArgPlan,
    reversedInterceptors:
      mount.interceptors.length > 0 ? [...mount.interceptors].reverse() : mount.interceptors,
    baseExecutionContext,
    syncCapable,
  };
}

/**
 * Creates the handler one mounted route runs on a platform's own router.
 *
 * @param mount - The route the platform mounted.
 * @param options - The logger, state, pipes, and policies the boot resolved.
 * @returns A handler that answers one request with a `Response`.
 */
export function createRouteHandler(
  mount: MountedRoute,
  options: HttpKernelOptions,
): (context: PlatformRouteContext) => Response | Promise<Response> {
  const runtime = createRouteExecutionRuntime(options);
  const compiled = compileRouteExecution(mount, runtime);
  const hasHooks = runtime.requestHooks.length > 0;

  if (compiled.syncCapable) {
    const instance = mount.instance;
    const handler = (instance as Record<PropertyKey, unknown>)[mount.route.propertyKey] as (
      ...arguments_: unknown[]
    ) => unknown;
    const argPlan = compiled.compiledArgPlan!;
    const guardHook = compiled.compiledGuardHook;

    const invokeAndRespond = (context: PlatformRouteContext): Response | Promise<Response> => {
      const invokeWithArgs = (args: unknown[]): Response | Promise<Response> => {
        const result = args.length === 0 ? handler.call(instance) : handler.call(instance, ...args);
        if (isPromiseLike(result)) {
          return (result as Promise<unknown>).then(
            (resolved) => buildRouteResponse(resolved, context),
            (error) => answerRouteFailure(error, mount, context, runtime),
          );
        }
        return buildRouteResponse(result, context);
      };

      const argsOrPromise = buildCompiledArguments(argPlan, context);
      if (isPromiseLike(argsOrPromise)) {
        return argsOrPromise.then(
          (args) => invokeWithArgs(args),
          (error) => answerRouteFailure(error, mount, context, runtime),
        );
      }
      return invokeWithArgs(argsOrPromise);
    };

    const runGuardsAndHandler = (context: PlatformRouteContext): Response | Promise<Response> => {
      if (guardHook !== undefined) {
        const refusal = guardHook(context);
        if (isPromiseLike(refusal)) {
          return (refusal as Promise<unknown>).then(
            (settled) =>
              settled !== undefined
                ? buildRouteResponse(settled, context)
                : invokeAndRespond(context),
            (error) => answerRouteFailure(error, mount, context, runtime),
          );
        }
        if (refusal !== undefined) {
          return buildRouteResponse(refusal, context);
        }
      }
      return invokeAndRespond(context);
    };

    return (context: PlatformRouteContext): Response | Promise<Response> => {
      try {
        if (compiled.hasRouteSettings) {
          applyCompiledRouteSettings(mount.route, compiled, context);
        }
        if (compiled.hasSchemaSlots) {
          const decoded = decodeSyncSchemaSlots(context, compiled);
          if (isPromiseLike(decoded)) {
            return decoded.then(
              () => runGuardsAndHandler(context),
              (error) => answerRouteFailure(error, mount, context, runtime),
            );
          }
        }
        return runGuardsAndHandler(context);
      } catch (error) {
        return answerRouteFailure(error, mount, context, runtime);
      }
    };
  }

  return async (context: PlatformRouteContext): Promise<Response> => {
    if (hasHooks) {
      rememberMatchedRoute(context.request, mount.route.path);
    }
    try {
      return buildRouteResponse(
        await executeMountedRoute(mount, context, runtime, compiled),
        context,
      );
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
 * @param compiled - Optional boot-compiled route state.
 * @returns The handler's value, after interceptors, serialization, render, or SSE.
 */
export async function executeMountedRoute(
  mount: MountedRoute,
  context: PlatformRouteContext,
  runtime: RouteExecutionRuntime,
  compiled?: CompiledRouteExecution,
): Promise<unknown> {
  const { route } = mount;

  await decodeRouteRequest(mount, context, runtime, compiled);
  if (compiled === undefined || compiled.hasRouteSettings) {
    applyRouteSettings(route, context);
  }

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

  const baseExecContext =
    compiled?.baseExecutionContext ??
    new StaticRouteExecutionContext(instance, handler, {
      method: route.method,
      path: route.path,
    });
  const executionContext = baseExecContext.fork(context);

  if (mount.guards.length > 0 && compiled?.compiledGuardHook !== undefined) {
    const refusal = compiled.compiledGuardHook(context);
    const settledRefusal = isPromiseLike(refusal) ? await refusal : refusal;
    if (settledRefusal !== undefined) {
      return settledRefusal;
    }
  }

  for (const interceptor of mount.interceptors) {
    const before = interceptor.interceptBefore?.(executionContext);
    if (isPromiseLike(before)) {
      await before;
    }
  }

  const argPlan =
    compiled?.compiledArgPlan ??
    compileParameterPlan(
      route.parameters as readonly RouteParameterMetadata[],
      mount.pipes,
      runtime.globalPipes,
      route.declaredParameterCount,
      handler.length,
    );
  const rawArgs = buildCompiledArguments(argPlan, context);
  const arguments_ = isPromiseLike(rawArgs) ? await rawArgs : rawArgs;

  const rawResult =
    arguments_.length === 0 ? handler.call(instance) : handler.call(instance, ...arguments_);
  let value = isPromiseLike(rawResult) ? await rawResult : rawResult;

  const afterInterceptors = compiled?.reversedInterceptors ?? [...mount.interceptors].reverse();
  for (const interceptor of afterInterceptors) {
    const after = interceptor.interceptAfter?.(executionContext, value);
    const settledAfter = isPromiseLike(after) ? await after : after;
    if (settledAfter !== undefined) {
      value = settledAfter;
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
function decodeSyncSchemaSlots(
  context: PlatformRouteContext,
  compiled: CompiledRouteExecution,
): void | Promise<void> {
  const state = context as unknown as Record<string, unknown>;
  const pending: Promise<void>[] = [];

  if (compiled.compiledQueryValidator !== undefined) {
    const res = compiled.compiledQueryValidator(context.query);
    if (isPromiseLike(res)) {
      pending.push(
        res.then((v) => {
          state.query = v;
        }) as Promise<void>,
      );
    } else {
      state.query = res;
    }
  }
  if (compiled.compiledParamsValidator !== undefined) {
    const res = compiled.compiledParamsValidator(context.params);
    if (isPromiseLike(res)) {
      pending.push(
        res.then((v) => {
          state.params = v;
        }) as Promise<void>,
      );
    } else {
      state.params = res;
    }
  }
  if (compiled.compiledHeadersValidator !== undefined) {
    const res = compiled.compiledHeadersValidator(context.headers);
    if (isPromiseLike(res)) {
      pending.push(
        res.then((v) => {
          state.headers = v;
        }) as Promise<void>,
      );
    } else {
      state.headers = res;
    }
  }
  if (compiled.compiledCookieValidator !== undefined) {
    const raw: Record<string, string> = {};
    for (const name in context.cookie) {
      if (Object.hasOwn(context.cookie, name)) {
        raw[name] = context.cookie[name]!.value as string;
      }
    }
    const res = compiled.compiledCookieValidator(raw);
    const wrapCookie = (validated: unknown): void => {
      if (typeof validated === "object" && validated !== null) {
        const mapped: Record<string, { readonly value: unknown }> = {};
        for (const [name, value] of Object.entries(validated as Record<string, unknown>)) {
          mapped[name] = { value };
        }
        state.cookie = mapped;
      } else {
        state.cookie = validated;
      }
    };
    if (isPromiseLike(res)) {
      pending.push(res.then(wrapCookie) as Promise<void>);
    } else {
      wrapCookie(res);
    }
  }

  if (pending.length > 0) {
    return Promise.all(pending).then(() => undefined);
  }
}

/**
 * Decodes and validates a route's incoming request slots into a `RouteContext`.
 */
export async function decodeRouteRequest(
  mount: MountedRoute,
  context: PlatformRouteContext,
  runtime: RouteExecutionRuntime,
  compiled?: CompiledRouteExecution,
): Promise<void> {
  const effective = compiled ?? compileRouteExecution(mount, runtime);
  if (effective.hasBodyDecoding) {
    const body = stripDangerousKeys(await readBody(context.request, runtime.maxBodyBytes));
    if (effective.compiledBodyValidator === undefined) {
      (context as unknown as Record<string, unknown>).body = body;
    } else {
      const validated = effective.compiledBodyValidator(body);
      (context as unknown as Record<string, unknown>).body = isPromiseLike(validated)
        ? await validated
        : validated;
    }
  }
  const slots = decodeSyncSchemaSlots(context, effective);
  if (isPromiseLike(slots)) {
    await slots;
  }
}

function applyCompiledRouteSettings(
  route: MountedRoute["route"],
  compiled: CompiledRouteExecution,
  context: PlatformRouteContext,
): void {
  if (route.httpCode !== undefined) {
    context.set.status = route.httpCode;
  }
  for (let i = 0; i < compiled.flattenedResponseHeaders.length; i += 1) {
    const [name, value] = compiled.flattenedResponseHeaders[i]!;
    context.set.headers[name] = typeof value === "string" ? value : [...value];
  }
  if (route.sse === true) {
    context.set.headers["content-type"] = "text/event-stream";
    context.set.headers["cache-control"] = "no-cache";
    context.set.headers["connection"] = "keep-alive";
  }
  if (route.deprecation !== undefined) {
    applyDeprecationHeaders(context.set.headers, route.deprecation);
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
    // A declared array (two `set-cookie` values) stays an array so the response
    // builders emit each entry as its own header; joining would merge the cookies.
    context.set.headers[name] =
      typeof value === "string" || typeof value === "number" ? value : [...value];
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
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done === true) {
        controller.close();
        return;
      }
      controller.enqueue(sharedTextEncoder.encode(`data: ${JSON.stringify(next.value)}\n\n`));
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
  if (runtime.requestHooks.length > 0) {
    await notifyRequestError(runtime.requestHooks, context.request, error);
  }

  if (error instanceof HttpError) {
    return withSettingsHeaders(error.toResponse(), context);
  }

  let host: StaticRouteExecutionContext | undefined;

  for (const filter of mount.filters) {
    if (!matchesFilter(filter.exceptions, error)) {
      continue;
    }
    try {
      host ??= new StaticRouteExecutionContext(mount.instance, () => undefined, {
        method: mount.route.method,
        path: mount.route.path,
      }).fork(context);
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

function withSettingsHeaders(response: Response, context: PlatformRouteContext): Response {
  const setHeaders = context.set.headers;
  if (!hasResponseHeaderEntries(setHeaders)) {
    return response;
  }

  const applyTo = (headers: Headers): void => {
    for (const name in setHeaders) {
      if (!Object.hasOwn(setHeaders, name)) {
        continue;
      }
      const value = setHeaders[name];
      if (value === undefined) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          headers.append(name, String(item));
        }
        continue;
      }
      if (!headers.has(name)) {
        headers.set(name, String(value));
      }
    }
  };

  try {
    applyTo(response.headers);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    applyTo(headers);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
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
