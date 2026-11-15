import { H3, defineWebSocketHandler, getRequestIP, type H3Event } from "h3";
import type {
  GatewayHooks,
  KernelAdapter,
  GatewayPlan,
  GatewaySocket,
  HostDispatcher,
} from "@aponiajs/platform-core";

/** The native application this platform creates. */
export type H3Application = H3;

interface H3Listener {
  readonly url: string;
  close(force?: boolean): Promise<void>;
}

interface CrosswsPeer {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  subscribe(topic: string): void;
  publish(topic: string, data: string): void;
}

interface CrosswsMessage {
  text(): string;
}

interface CrosswsHooks {
  open?(peer: CrosswsPeer): unknown;
  message?(peer: CrosswsPeer, message: CrosswsMessage): unknown;
  close?(peer: CrosswsPeer): unknown;
}

interface CrosswsBunAdapter {
  readonly websocket: unknown;
  handleUpgrade(request: Request, server: unknown): Promise<Response | undefined>;
}

interface CrosswsBunFactory {
  (options: {
    readonly resolve: (request: Request) => CrosswsHooks | undefined;
  }): CrosswsBunAdapter;
}

const crossws = await loadCrossws();

async function loadCrossws(): Promise<CrosswsBunFactory | undefined> {
  try {
    const module = (await import("crossws/adapters/bun")) as {
      readonly default: CrosswsBunFactory;
    };
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
    send: (data) => peer.send(data),
    close: (code, reason) => peer.close(code, reason),
    subscribe: (topic) => peer.subscribe(topic),
    publish: (topic, data) => peer.publish(topic, data),
  };
}

/**
 * The H3 binding of the Aponia kernel.
 *
 * The HTTP dispatcher is middleware, so a request the kernel does not answer
 * continues down the application's own chain. Gateways mount twice: an H3 route
 * built with `defineWebSocketHandler`, which is what a server that integrates
 * crossws (Nitro does) upgrades, and a path the Bun listener hands to crossws
 * itself, so `listen` upgrades without a second server.
 *
 * @returns The host.
 */
export function createH3Host(): KernelAdapter<H3Application, H3Event> {
  const gateways = new Map<string, CrosswsHooks>();
  let adapter: CrosswsBunAdapter | undefined;

  function crosswsAdapter(): CrosswsBunAdapter | undefined {
    if (crossws === undefined) {
      return undefined;
    }
    adapter ??= crossws({
      resolve: (request: Request) => gateways.get(new URL(request.url).pathname),
    });
    return adapter;
  }

  return Object.freeze({
    kind: "host" as const,
    name: "h3",
    createApplication(): H3Application {
      return new H3();
    },
    mount(application: H3Application, dispatch: HostDispatcher<H3Event>): void {
      application.use(async (event, next) => {
        const address = peerAddress(event);
        const response = await dispatch(event.req as Request, {
          path: event.url.pathname,
          ...(address === undefined ? {} : { ip: address }),
          native: event,
        });
        if (response !== undefined) {
          return response;
        }
        await next();
      });
    },
    fetch(application: H3Application, request: Request): Response | Promise<Response> {
      return application.fetch(request);
    },
    async listen(application: H3Application, port: number): Promise<H3Listener> {
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
          return (application.fetch as unknown as (request: Request, env: unknown) => Response)(
            request,
            { server: bunServer },
          );
        },
        ...(sockets === undefined ? {} : { websocket: sockets.websocket }),
      });
      return {
        url: `http://localhost:${server.port}`,
        close: async () => {
          await server.stop(true);
        },
      };
    },
    ...(crossws === undefined
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

            gateways.set(plan.path, {
              async open(peer) {
                await hooks.open(socketFor(peer));
              },
              async message(peer, message) {
                await hooks.message(socketFor(peer), message.text());
              },
              async close(peer) {
                await hooks.close(socketFor(peer));
              },
            });

            application.get(
              plan.path,
              defineWebSocketHandler({
                open(peer) {
                  void hooks.open(toGatewaySocket(peer as CrosswsPeer));
                },
                message(peer, message) {
                  void hooks.message(toGatewaySocket(peer as CrosswsPeer), message.text());
                },
                close(peer) {
                  void hooks.close(toGatewaySocket(peer as CrosswsPeer));
                },
              }),
            );
          },
        }),
  });
}

/**
 * The H3 binding the unified factory accepts.
 *
 * @returns The adapter.
 */
export function h3Adapter(): KernelAdapter<H3Application, H3Event> {
  return createH3Host();
}
