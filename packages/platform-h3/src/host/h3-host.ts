import { H3, defineWebSocketHandler, getRequestIP, type H3Event } from "h3";
import {
  answerStaticAsset,
  buildResponse,
  hasResponseHeaderEntries,
  readCookies,
  readHeaders,
  readQuery,
  RouteContextMask,
  slicePathname,
  statusCodeOf,
  stripRoutePrefix,
  type GatewayHooks,
  type GatewayPlan,
  type GatewayServerOptions,
  type GatewaySocket,
  type KernelAdapter,
  type MountedRoute,
  type PlatformMountOptions,
  type PlatformRouteContext,
  type PlatformCapability,
  type PlatformRouteHandler,
  type RequestPipeline,
  type ResolvedMiddlewareConfig,
  type StaticAssetsOptions,
} from "@aponiajs/common";
import { compileMiddlewareConfigs, runCompiledMiddlewareChain } from "@aponiajs/core";

/** The native application this platform creates. */
export type H3Application = H3;

interface H3Listener {
  readonly url: string;
  readonly server?: unknown;
  close(force?: boolean): Promise<void>;
}

interface CrosswsPeer {
  readonly id: string;
  readonly request: Request;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  subscribe(topic: string): void;
  publish(topic: string, data: string): void;
}

interface CrosswsMessage {
  text(): string;
}

interface CrosswsHooks {
  upgrade?(request: Request): unknown;
  open?(peer: CrosswsPeer): unknown;
  message?(peer: CrosswsPeer, message: CrosswsMessage): unknown;
  close?(peer: CrosswsPeer): unknown;
}

interface CrosswsBunAdapter {
  readonly websocket: Record<string, unknown>;
  handleUpgrade(request: Request, server: unknown): Promise<Response | undefined>;
}

interface CrosswsBunFactory {
  (options: {
    readonly resolve: (request: Request) => CrosswsHooks | undefined;
  }): CrosswsBunAdapter;
}

/** The loader a case can replace to state an absent crossws adapter. */
export type CrosswsAdapterLoader = () => Promise<{ readonly default: CrosswsBunFactory }>;

const crossws = await loadCrossws();

/**
 * Loads the crossws Bun adapter, or states that this runtime has none.
 *
 * The loader is a parameter so a case can exercise the absent path without a
 * runtime that cannot load the module.
 */
export async function loadCrossws(
  loader: CrosswsAdapterLoader = () =>
    import("crossws/adapters/bun") as unknown as Promise<{
      readonly default: CrosswsBunFactory;
    }>,
): Promise<CrosswsBunFactory | undefined> {
  try {
    const module = await loader();
    return module.default;
  } catch {
    return undefined;
  }
}

function peerAddress(event: H3Event): string | undefined {
  try {
    return getRequestIP(event);
  } catch {
    return undefined;
  }
}

function toGatewaySocket(peer: CrosswsPeer): GatewaySocket {
  return {
    id: peer.id,
    request: peer.request,
    emit: (event, data) => peer.send(JSON.stringify({ event, data })),
    send: (data) => peer.send(data),
    close: (code, reason) => peer.close(code, reason),
    subscribe: (topic) => peer.subscribe(topic),
    publish: (topic, data) => peer.publish(topic, data),
  };
}

/**
 * The H3 binding of an Aponia application.
 *
 * H3's own router matches every compiled route: the platform registers each one
 * with `app.on` (or `app.all`), mounts module middleware with `app.use`, and
 * builds the request context from the H3 event. Aponia's shared route handler
 * runs inside the route H3 matched, so the request contract is the same on every
 * platform while routing, middleware composition, and the listener stay H3's.
 *
 * Gateways mount twice: an H3 route built with `defineWebSocketHandler`, which a
 * server that integrates crossws (Nitro does) upgrades, and a path the Bun
 * listener hands to crossws itself.
 *
 * @returns The host.
 */
export function createH3Host(
  crosswsOption: typeof crossws | null = crossws,
): KernelAdapter<H3Application, H3Event> {
  const crosswsFactory = crosswsOption ?? undefined;
  const gateways = new Map<string, CrosswsHooks>();
  let adapter: CrosswsBunAdapter | undefined;
  let gatewayOptions: GatewayServerOptions = {};

  function crosswsAdapter(): CrosswsBunAdapter | undefined {
    if (crosswsFactory === undefined) {
      return undefined;
    }
    adapter ??= crosswsFactory({
      resolve: (request: Request) => gateways.get(new URL(request.url).pathname),
    });
    return adapter;
  }

  return Object.freeze({
    kind: "host" as const,
    name: "h3",
    capabilities: Object.freeze<PlatformCapability[]>([
      "http",
      "streaming",
      "multipart",
      ...(crosswsFactory === undefined ? [] : ["websockets" as PlatformCapability]),
    ]),
    createApplication(): H3Application {
      return new H3();
    },
    mountRoute(
      application: H3Application,
      mount: MountedRoute,
      handler: PlatformRouteHandler,
      options: PlatformMountOptions = {},
    ): void {
      const path = mount.route.path;
      const store = options.store ?? {};
      const mask = mount.contextMask;
      const hasParams =
        mask === undefined
          ? path.includes(":") || path.includes("*")
          : (mask & (RouteContextMask.PARAMS | RouteContextMask.FULL_CONTEXT)) !== 0;

      const run = (event: H3Event): Response | Promise<Response> => {
        const context = new LazyH3RouteContext(event, path, store, hasParams);
        const response = handler(context as unknown as PlatformRouteContext);
        if (response instanceof Response) {
          return context.hasMutatedSettings ? applySettings(response, context.set) : response;
        }
        return response.then((settled) =>
          context.hasMutatedSettings ? applySettings(settled, context.set) : settled,
        );
      };
      if (mount.route.method === "ALL") {
        application.all(mount.route.path, run as never);
        return;
      }
      application.on(mount.route.method as never, mount.route.path, run as never);
    },
    mountMiddleware(
      application: H3Application,
      configs: readonly ResolvedMiddlewareConfig[],
      options: PlatformMountOptions = {},
    ): void {
      if (configs.length === 0) {
        return;
      }
      const compiledConfigs = compileMiddlewareConfigs(configs);
      const prefix = options.prefix ?? "";
      const store = options.store ?? {};
      application.use(async (event, next) => {
        const path = event.url.pathname;
        const pathname = stripRoutePrefix(path, prefix) ?? path;
        const context = new LazyH3RouteContext(event, pathname, store, false);
        const result = await runCompiledMiddlewareChain(
          compiledConfigs,
          context,
          pathname,
          event.req.method,
          async () => {
            await next();
            return undefined;
          },
        );
        if (result instanceof Response) {
          return context.hasMutatedSettings ? applySettings(result, context.set) : result;
        }
        if (
          context.hasMutatedSettings &&
          hasResponseHeaderEntries(context.set.headers) &&
          typeof event.res.headers === "object"
        ) {
          for (const [name, value] of Object.entries(context.set.headers)) {
            if (value === undefined) {
              continue;
            }
            if (Array.isArray(value)) {
              for (const item of value) {
                event.res.headers.append(name, String(item));
              }
              continue;
            }
            event.res.headers.set(name, String(value));
          }
        }
        return undefined;
      });
    },
    mountStaticAssets(application: H3Application, options: StaticAssetsOptions): void {
      application.use(async (event, next) => {
        const response = await answerStaticAsset(event.url.pathname, options, (path) => {
          const file = Bun.file(path);
          return { body: file, exists: file.exists(), lastModified: file.lastModified };
        });
        if (response === undefined) {
          return await next();
        }
        return response;
      });
    },
    fetch(application: H3Application, request: Request): Response | Promise<Response> {
      return application.fetch(request);
    },
    configureGatewayOptions(_application: H3Application, options: GatewayServerOptions): void {
      gatewayOptions = options;
    },
    async listen(
      application: H3Application,
      port: number,
      pipeline?: RequestPipeline,
      staticRoutes?: Readonly<
        Record<string, Response | ((request: Request) => Response | Promise<Response>)>
      >,
    ): Promise<H3Listener> {
      const sockets = crosswsAdapter();
      const server = (
        Bun.serve as unknown as (options: Record<string, unknown>) => {
          readonly port: number;
          stop(force?: boolean): Promise<void>;
        }
      )({
        port,
        ...(staticRoutes === undefined || pipeline !== undefined ? {} : { routes: staticRoutes }),
        fetch: (request: Request, bunServer: unknown) => {
          if (
            sockets !== undefined &&
            gateways.size > 0 &&
            request.headers.get("upgrade")?.toLowerCase() === "websocket"
          ) {
            const path = slicePathname(request.url);
            if (gateways.has(path)) {
              return sockets.handleUpgrade(request, bunServer);
            }
          }
          return pipeline === undefined
            ? (application.fetch as unknown as (request: Request, env: unknown) => Response)(
                request,
                { server: bunServer },
              )
            : pipeline(request, (current: Request) =>
                (application.fetch as unknown as (request: Request, env: unknown) => Response)(
                  current,
                  { server: bunServer },
                ),
              );
        },
        ...(sockets === undefined
          ? {}
          : { websocket: { ...sockets.websocket, ...toBunWebSocketOptions(gatewayOptions) } }),
      });
      return {
        url: `http://localhost:${server.port}`,
        server,
        close: async (force) => {
          await (force === false ? server.stop() : server.stop(true));
        },
      };
    },
    ...(crosswsFactory === undefined
      ? {}
      : {
          mountGateway(application: H3Application, plan: GatewayPlan, hooks: GatewayHooks): void {
            const peers = new WeakMap<CrosswsPeer, GatewaySocket>();
            const socketFor = (peer: CrosswsPeer): GatewaySocket => {
              const existing = peers.get(peer);
              if (existing !== undefined) {
                return existing;
              }
              const socket = toGatewaySocket(peer);
              peers.set(peer, socket);
              return socket;
            };

            const refuseOrigin = (request: Request): Response | undefined => {
              if (plan.origins === undefined) {
                return undefined;
              }
              const origin = request.headers.get("origin");
              if (origin === null || !plan.origins.includes(origin)) {
                return new Response("Forbidden", { status: 403 });
              }
              return undefined;
            };

            gateways.set(plan.path, {
              upgrade(request: Request) {
                return refuseOrigin(request);
              },
              async open(peer: CrosswsPeer) {
                await hooks.open(socketFor(peer));
              },
              async message(peer: CrosswsPeer, message: CrosswsMessage) {
                await hooks.message(socketFor(peer), message.text());
              },
              async close(peer: CrosswsPeer) {
                await hooks.close(socketFor(peer));
              },
            });

            application.get(
              plan.path,
              defineWebSocketHandler({
                upgrade(request: Request) {
                  return refuseOrigin(request);
                },
                open(peer: CrosswsPeer) {
                  void hooks.open(socketFor(peer));
                },
                message(peer: CrosswsPeer, message: CrosswsMessage) {
                  void hooks.message(socketFor(peer), message.text());
                },
                close(peer: CrosswsPeer) {
                  void hooks.close(socketFor(peer));
                },
              } as never),
            );
          },
        }),
  });
}

const emptyFrozenParams: Record<string, string> = Object.freeze({});

class LazyH3RouteContext {
  body: unknown = undefined;
  readonly request: Request;
  readonly path: string;
  readonly store: Record<string, unknown>;
  readonly native: H3Event;

  readonly #hasParams: boolean;
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

  constructor(native: H3Event, path: string, store: Record<string, unknown>, hasParams: boolean) {
    this.native = native;
    this.request = native.req as unknown as Request;
    this.path = path;
    this.store = store;
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
      if (!this.#hasParams) {
        this.#params = emptyFrozenParams;
      } else {
        const raw = (this.native.context as { readonly params?: Record<string, string> }).params;
        this.#params = raw === undefined ? emptyFrozenParams : { ...raw };
      }
    }
    return this.#params;
  }

  set params(value: Record<string, string>) {
    this.#params = value;
  }

  get query(): Readonly<Record<string, string | string[]>> {
    return (this.#query ??= readQuery(this.native.url));
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
    return this.native.url.host;
  }

  get ip(): string | undefined {
    if (this.#ip === null) {
      this.#ip = peerAddress(this.native);
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
    return buildResponse(body, s, this.request.method);
  };
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
