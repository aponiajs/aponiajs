import { H3, defineWebSocketHandler, getRequestIP, type H3Event } from "h3";
import {
  answerStaticAsset,
  buildResponse,
  readCookies,
  readHeaders,
  readQuery,
  runMiddlewareChain,
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
} from "@aponiajs/platform-core";

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
      const run = async (event: H3Event): Promise<Response> => {
        const context = createRouteContext(event, mount, options.store ?? {});
        const response = await handler(context);
        return applySettings(response, context.set);
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
      application.use(async (event, next) => {
        const prefix = options.prefix ?? "";
        const path = event.url.pathname;
        const pathname = stripRoutePrefix(path, prefix) ?? path;
        const context = createMiddlewareContext(event, pathname, options.store ?? {});
        const result = await runMiddlewareChain(
          configs,
          context,
          pathname,
          event.req.method,
          async () => {
            await next();
            return undefined;
          },
        );
        if (result instanceof Response) {
          return applySettings(result, context.set);
        }
        if (typeof event.res.headers === "object") {
          for (const [name, value] of Object.entries(context.set.headers)) {
            if (value === undefined) {
              continue;
            }
            // Two cookies are two headers: joining them would make the browser
            // read one malformed cookie.
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
    ): Promise<H3Listener> {
      const sockets = crosswsAdapter();
      const server = (
        Bun.serve as unknown as (options: Record<string, unknown>) => {
          readonly port: number;
          stop(force?: boolean): Promise<void>;
        }
      )({
        port,
        fetch: (request: Request, bunServer: unknown) => {
          const path = new URL(request.url).pathname;
          if (
            sockets !== undefined &&
            gateways.has(path) &&
            request.headers.get("upgrade")?.toLowerCase() === "websocket"
          ) {
            return sockets.handleUpgrade(request, bunServer);
          }
          const dispatch = (current: Request) =>
            (application.fetch as unknown as (request: Request, env: unknown) => Response)(
              current,
              { server: bunServer },
            );
          return pipeline === undefined ? dispatch(request) : pipeline(request, dispatch);
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

function createRouteContext(
  event: H3Event,
  mount: MountedRoute,
  store: Record<string, unknown>,
): PlatformRouteContext {
  const params = (event.context as { readonly params?: Record<string, string> }).params ?? {};
  return createContextValues(event, mount.route.path, store, { ...params });
}

function createMiddlewareContext(
  event: H3Event,
  pathname: string,
  store: Record<string, unknown>,
): PlatformRouteContext {
  return createContextValues(event, pathname, store, {});
}

function createContextValues(
  event: H3Event,
  path: string,
  store: Record<string, unknown>,
  params: Record<string, string>,
): PlatformRouteContext {
  const request = event.req as unknown as Request;
  const url = event.url;
  const set: {
    status?: number | string;
    headers: Record<string, string | number | string[] | undefined>;
  } = { headers: {} };
  const address = peerAddress(event);
  return {
    body: undefined,
    query: readQuery(url),
    params,
    headers: readHeaders(request),
    cookie: readCookies(request),
    request,
    path,
    set,
    store,
    ip: address,
    host: url.host,
    status: (status, body) => {
      set.status = status;
      return buildResponse(body, set, request.method);
    },
    ...(address === undefined ? {} : { server: { requestIP: () => ({ address }) } }),
    native: event,
  } as PlatformRouteContext;
}

function applySettings(
  response: Response,
  set: {
    readonly status?: number | string;
    readonly headers: Record<string, string | number | string[] | undefined>;
  },
): Response {
  const headers = new Headers(response.headers);
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

/**
 * The H3 binding the unified factory accepts.
 *
 * @returns The adapter.
 */
export function h3Adapter(): KernelAdapter<H3Application, H3Event> {
  return createH3Host();
}
