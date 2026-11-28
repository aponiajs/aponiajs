import { Hono, type Context } from "hono";
import {
  answerStaticAsset,
  buildResponse,
  hasResponseHeaderEntries,
  readCookies,
  readHeaders,
  readQuery,
  RouteContextMask,
  statusCodeOf,
  stripRoutePrefix,
  type GatewayHooks,
  type GatewayPlan,
  type GatewayServerOptions,
  type GatewaySocket,
  type KernelAdapter,
  type MountedRoute,
  type PlatformRouteContext,
  type PlatformCapability,
  type PlatformRouteHandler,
  type PlatformMountOptions,
  type RequestPipeline,
  type ResolvedMiddlewareConfig,
  type StaticAssetsOptions,
} from "@aponiajs/common";
import { compileMiddlewareConfigs, runCompiledMiddlewareChain } from "@aponiajs/core";

/** The native application this platform creates. */
export type HonoApplication = Hono;

interface HonoListener {
  readonly url: string;
  readonly server?: unknown;
  close(force?: boolean): Promise<void>;
}

interface HonoWebSocketSupport {
  readonly upgradeWebSocket: (create: (context: Context) => HonoSocketHooks) => unknown;
  readonly websocket: Record<string, unknown>;
}

interface HonoSocketHooks {
  onOpen?(event: unknown, socket: HonoSocket): unknown;
  onMessage?(event: { readonly data: unknown }, socket: HonoSocket): unknown;
  onClose?(event: unknown, socket: HonoSocket): unknown;
}

interface HonoSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  subscribe?(topic: string): void;
  publish?(topic: string, data: string): void;
}

/** What the Bun adapter module states, as this host reads it. */
interface HonoBunModule {
  readonly createBunWebSocket: () => unknown;
  readonly getConnInfo: (context: Context) => { readonly remote: { readonly address?: string } };
}

/** The loader a case can replace to state an absent adapter. */
export type HonoBunAdapterLoader = () => Promise<HonoBunModule>;

const bunAdapter = await loadBunAdapter();

/**
 * Loads Hono's Bun adapter, or states that this runtime has none.
 *
 * The loader is a parameter so a case can exercise the absent path without a
 * runtime that cannot load the module.
 */
export async function loadBunAdapter(
  loader: HonoBunAdapterLoader = () => import("hono/bun") as unknown as Promise<HonoBunModule>,
): Promise<
  | {
      readonly support: HonoWebSocketSupport;
      readonly peerAddress: (context: Context) => string | undefined;
    }
  | undefined
> {
  try {
    const { createBunWebSocket, getConnInfo } = await loader();
    return {
      support: createBunWebSocket() as unknown as HonoWebSocketSupport,
      peerAddress: (context: Context): string | undefined => {
        if ((context.env as { readonly server?: unknown } | undefined)?.server === undefined) {
          return undefined;
        }
        try {
          return getConnInfo(context).remote.address;
        } catch {
          /* istanbul ignore next -- getConnInfo needs Bun's server; app.request has none */
          return undefined;
        }
      },
    };
  } catch {
    /* istanbul ignore next -- the fallback exists only where hono/bun is absent */
    return undefined;
  }
}

function toGatewaySocket(socket: HonoSocket, request?: Request): GatewaySocket {
  return {
    ...(request === undefined ? {} : { request }),
    emit: (event, data) => socket.send(JSON.stringify({ event, data })),
    send: (data) => socket.send(data),
    close: (code, reason) => socket.close(code, reason),
    subscribe: (topic) => socket.subscribe?.(topic),
    publish: (topic, data) => socket.publish?.(topic, data),
  };
}

/**
 * The Hono binding of an Aponia application.
 *
 * Hono's own router matches every compiled route: the platform registers each
 * one with `app.on` (or `app.all` for `@All()`), mounts the module middleware as
 * a Hono middleware, and lets Hono answer unmatched requests. Aponia's shared
 * route handler runs inside the route Hono matched, so the request contract is
 * the same on every platform while routing, middleware composition, and the
 * listener stay Hono's.
 *
 * WebSocket gateways mount through Hono's Bun adapter; a runtime where that
 * adapter does not load states no gateway support, and the boot refuses a graph
 * that declares one.
 *
 * @returns The host.
 */
export function createHonoHost(
  adapterOption: typeof bunAdapter | null = bunAdapter,
): KernelAdapter<HonoApplication, Context> {
  const adapter = adapterOption ?? undefined;
  let gatewayOptions: GatewayServerOptions = {};

  return Object.freeze({
    kind: "host" as const,
    name: "hono",
    capabilities: Object.freeze<PlatformCapability[]>([
      "http",
      "streaming",
      "multipart",
      ...(adapter === undefined ? [] : ["websockets" as PlatformCapability]),
    ]),
    createApplication(): HonoApplication {
      return new Hono();
    },
    mountRoute(
      application: HonoApplication,
      mount: MountedRoute,
      handler: PlatformRouteHandler,
      options: PlatformMountOptions = {},
    ): void {
      const run = createHandler(mount, handler, options.store ?? {}, adapter);
      const method = mount.route.method;
      if (method === "ALL") {
        application.all(mount.route.path, run);
        return;
      }
      application.on(method, mount.route.path, run);
    },
    mountMiddleware(
      application: HonoApplication,
      configs: readonly ResolvedMiddlewareConfig[],
      options: PlatformMountOptions = {},
    ): void {
      if (configs.length === 0) {
        return;
      }
      const compiledConfigs = compileMiddlewareConfigs(configs);
      const prefix = options.prefix ?? "";
      const store = options.store ?? {};
      application.use("*", async (context, next) => {
        const pathname = stripRoutePrefix(context.req.path, prefix) ?? context.req.path;
        const middlewareContext = new LazyHonoRouteContext(
          context,
          pathname,
          store,
          adapter,
          false,
        );
        const result = await runCompiledMiddlewareChain(
          compiledConfigs,
          middlewareContext,
          pathname,
          context.req.method,
          async () => {
            await next();
            return undefined;
          },
        );
        if (result instanceof Response) {
          return middlewareContext.hasMutatedSettings
            ? applySettings(result, middlewareContext.set)
            : result;
        }
        if (middlewareContext.hasMutatedSettings) {
          applyHeaders(context, middlewareContext.set.headers);
        }
        return undefined;
      });
    },
    mountStaticAssets(application: HonoApplication, options: StaticAssetsOptions): void {
      application.use("*", async (context, next) => {
        const response = await answerStaticAsset(context.req.path, options, (path) => {
          const file = Bun.file(path);
          return { body: file, exists: file.exists(), lastModified: file.lastModified };
        });
        if (response === undefined) {
          await next();
          return undefined;
        }
        return response;
      });
    },
    fetch(application: HonoApplication, request: Request): Response | Promise<Response> {
      return application.fetch(request);
    },
    async listen(
      application: HonoApplication,
      port: number,
      pipeline?: RequestPipeline,
      staticRoutes?: Readonly<
        Record<string, Response | ((request: Request) => Response | Promise<Response>)>
      >,
    ): Promise<HonoListener> {
      const server = (
        Bun.serve as unknown as (options: Record<string, unknown>) => {
          readonly port: number;
          stop(force?: boolean): Promise<void>;
        }
      )({
        port,
        ...(staticRoutes === undefined || pipeline !== undefined ? {} : { routes: staticRoutes }),
        // Hono's Bun adapter resolves the server through the context's `env`;
        // the listener hands it the same instance Bun handed the listener.
        fetch: (request: Request, server: unknown) => {
          return pipeline === undefined
            ? application.fetch(request, { server } as never)
            : pipeline(request, (current: Request) =>
                application.fetch(current, { server } as never),
              );
        },
        ...webSocketConfig(adapter, gatewayOptions),
      });
      return {
        url: `http://localhost:${server.port}`,
        server,
        close: async (force) => {
          await (force === true ? server.stop(true) : server.stop());
        },
      };
    },
    configureGatewayOptions(_application: HonoApplication, options: GatewayServerOptions): void {
      gatewayOptions = options;
    },
    ...(adapter === undefined
      ? /* istanbul ignore next -- the Bun adapter is absent only off Bun */ {}
      : {
          mountGateway(application: HonoApplication, plan: GatewayPlan, hooks: GatewayHooks): void {
            const support = adapter.support;
            const route = support.upgradeWebSocket((context) => {
              const request = context.req.raw;
              let socket: GatewaySocket | undefined;
              return {
                async onOpen(_event: unknown, native: HonoSocket) {
                  socket = toGatewaySocket(native, request);
                  await hooks.open(socket);
                },
                async onMessage(event: { readonly data: unknown }, native: HonoSocket) {
                  await hooks.message(socket ?? toGatewaySocket(native, request), event.data);
                },
                async onClose(_event: unknown, native: HonoSocket) {
                  await hooks.close(socket ?? toGatewaySocket(native, request));
                },
              };
            });
            application.use(plan.path, async (context, next) => {
              const refusal = refuseOrigin(context, plan);
              if (refusal !== undefined) {
                return refusal;
              }
              await next();
              return undefined;
            });
            application.get(plan.path, route as never);
          },
        }),
  });
}

const emptyFrozenParams: Record<string, string> = Object.freeze({});

class LazyHonoRouteContext {
  body: unknown = undefined;
  readonly request: Request;
  readonly path: string;
  readonly store: Record<string, unknown>;
  readonly native: Context;

  readonly #adapter: typeof bunAdapter;
  readonly #hasParams: boolean;
  #url: URL | undefined;
  #query: Readonly<Record<string, string | string[]>> | undefined;
  #params: Record<string, string> | undefined;
  #headers: Readonly<Record<string, string>> | undefined;
  #cookie: Readonly<Record<string, { readonly value: string }>> | undefined;
  #ip: string | undefined | null = null;
  #set:
    | {
        status?: number | string;
        headers: Record<string, string | number | string[] | undefined>;
      }
    | undefined;
  #server: { readonly requestIP?: () => { readonly address?: string } | undefined } | undefined;

  constructor(
    native: Context,
    path: string,
    store: Record<string, unknown>,
    adapter: typeof bunAdapter,
    hasParams: boolean,
  ) {
    this.native = native;
    this.request = native.req.raw;
    this.path = path;
    this.store = store;
    this.#adapter = adapter;
    this.#hasParams = hasParams;
  }

  get hasMutatedSettings(): boolean {
    if (this.#set === undefined) {
      return false;
    }
    return this.#set.status !== undefined || hasResponseHeaderEntries(this.#set.headers);
  }

  get set(): {
    status?: number | string;
    headers: Record<string, string | number | string[] | undefined>;
  } {
    return (this.#set ??= { headers: {} });
  }

  get params(): Record<string, string> {
    if (this.#params === undefined) {
      this.#params = this.#hasParams ? { ...this.native.req.param() } : emptyFrozenParams;
    }
    return this.#params;
  }

  set params(value: Record<string, string>) {
    this.#params = value;
  }

  get query(): Readonly<Record<string, string | string[]>> {
    return (this.#query ??= readQuery((this.#url ??= new URL(this.request.url))));
  }

  set query(value: Readonly<Record<string, string | string[]>>) {
    this.#query = value;
  }

  get headers(): Readonly<Record<string, string>> {
    return (this.#headers ??= readHeaders(this.request));
  }

  set headers(value: Readonly<Record<string, string>>) {
    this.#headers = value;
  }

  get cookie(): Readonly<Record<string, { readonly value: string }>> {
    return (this.#cookie ??= readCookies(this.request));
  }

  set cookie(value: Readonly<Record<string, { readonly value: string }>>) {
    this.#cookie = value;
  }

  get host(): string {
    return (this.#url ??= new URL(this.request.url)).host;
  }

  get ip(): string | undefined {
    if (this.#ip === null) {
      this.#ip = this.#adapter?.peerAddress(this.native);
    }
    return this.#ip;
  }

  get server():
    | { readonly requestIP?: () => { readonly address?: string } | undefined }
    | undefined {
    if (this.#server === undefined) {
      const address = this.ip;
      if (address !== undefined) {
        this.#server = { requestIP: () => ({ address }) };
      }
    }
    return this.#server;
  }

  status = (status: number | string, body?: unknown): Response => {
    const s = this.set;
    s.status = status;
    return buildResponse(body, s, this.native.req.method);
  };
}

function createHandler(
  mount: MountedRoute,
  handler: PlatformRouteHandler,
  store: Record<string, unknown>,
  adapter: typeof bunAdapter,
): (context: Context) => Response | Promise<Response> {
  const path = mount.route.path;
  const mask = mount.contextMask;
  const hasParams =
    mask === undefined
      ? path.includes(":") || path.includes("*")
      : (mask & (RouteContextMask.PARAMS | RouteContextMask.FULL_CONTEXT)) !== 0;

  return (context: Context): Response | Promise<Response> => {
    const routeContext = new LazyHonoRouteContext(context, path, store, adapter, hasParams);
    const response = handler(routeContext as unknown as PlatformRouteContext);
    if (response instanceof Response) {
      return routeContext.hasMutatedSettings ? applySettings(response, routeContext.set) : response;
    }
    return response.then((settled) =>
      routeContext.hasMutatedSettings ? applySettings(settled, routeContext.set) : settled,
    );
  };
}

function applyHeaders(
  context: Context,
  headers: Record<string, string | number | string[] | undefined>,
): void {
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        context.header(name, String(item), { append: true });
      }
      continue;
    }
    context.header(name, String(value));
  }
}

function applySettings(
  response: Response,
  set: {
    readonly status?: number | string;
    readonly headers: Record<string, string | number | string[] | undefined>;
  },
): Response {
  const hasHeaders = hasResponseHeaderEntries(set.headers);
  if (!hasHeaders && set.status === undefined) {
    return response;
  }

  const headers = new Headers(response.headers);
  if (hasHeaders) {
    for (const [name, value] of Object.entries(set.headers)) {
      if (value === undefined) {
        continue;
      }
      if (Array.isArray(value)) {
        headers.delete(name);
        for (const item of value) {
          headers.append(name, String(item));
        }
        continue;
      }
      headers.set(name, String(value));
    }
  }

  const requested =
    typeof set.status === "number"
      ? set.status
      : typeof set.status === "string"
        ? statusCodeOf(set.status as never)
        : undefined;
  const status = requested !== undefined && response.status === 200 ? requested : response.status;
  const body = status === 204 || status === 205 || status === 304 ? null : response.body;
  return new Response(body, {
    status,
    statusText: response.statusText,
    headers,
  });
}

function webSocketConfig(
  adapter: typeof bunAdapter,
  options: GatewayServerOptions,
): Record<string, unknown> {
  if (adapter === undefined) {
    /* istanbul ignore next -- the Bun adapter is absent only off Bun */
    return {};
  }
  return {
    websocket: {
      ...adapter.support.websocket,
      ...toBunWebSocketOptions(options),
    },
  };
}

function toBunWebSocketOptions(options: GatewayServerOptions): Record<string, unknown> {
  return {
    ...(options.maxPayloadLength === undefined
      ? {}
      : { maxPayloadLength: options.maxPayloadLength }),
    ...(options.idleTimeoutSeconds === undefined
      ? {}
      : { idleTimeout: options.idleTimeoutSeconds }),
    ...(options.sendPings === undefined ? {} : { sendPings: options.sendPings }),
  };
}

function refuseOrigin(context: Context, plan: GatewayPlan): Response | undefined {
  if (plan.origins === undefined) {
    return undefined;
  }
  const origin = context.req.header("origin");
  if (origin === undefined || !plan.origins.includes(origin)) {
    return context.text("Forbidden", 403);
  }
  return undefined;
}
