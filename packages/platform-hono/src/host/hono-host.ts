import { Hono, type Context } from "hono";
import type {
  GatewayHooks,
  GatewayPlan,
  GatewaySocket,
  HostDispatcher,
  PlatformHost,
} from "@aponiajs/platform-core";

/** The native application this platform creates. */
export type HonoApplication = Hono;

interface HonoListener {
  readonly url: string;
  close(force?: boolean): Promise<void>;
}

interface HonoWebSocketSupport {
  readonly upgradeWebSocket: (create: () => HonoSocketHooks) => unknown;
  readonly websocket: unknown;
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

const bunAdapter = await loadBunAdapter();

async function loadBunAdapter(): Promise<
  | {
      readonly support: HonoWebSocketSupport;
      readonly peerAddress: (context: Context) => string | undefined;
    }
  | undefined
> {
  try {
    const { createBunWebSocket, getConnInfo } = await import("hono/bun");
    return {
      support: createBunWebSocket() as HonoWebSocketSupport,
      peerAddress: (context: Context): string | undefined => {
        try {
          return getConnInfo(context).remote.address;
        } catch {
          return undefined;
        }
      },
    };
  } catch {
    return undefined;
  }
}

function toGatewaySocket(socket: HonoSocket): GatewaySocket {
  return {
    send: (data) => socket.send(data),
    close: (code, reason) => socket.close(code, reason),
    subscribe: (topic) => socket.subscribe?.(topic),
    publish: (topic, data) => socket.publish?.(topic, data),
  };
}

/**
 * The Hono binding of the Aponia kernel.
 *
 * The dispatcher is middleware, so a request the kernel does not answer
 * continues to whatever the application registered next. WebSocket gateways
 * mount through Hono's Bun adapter; on a runtime that adapter does not load,
 * the host states no gateway support and the boot refuses a graph that declares
 * one.
 *
 * @returns The host.
 */
export function createHonoHost(): PlatformHost<HonoApplication, Context> {
  return Object.freeze({
    name: "hono",
    createApplication(): HonoApplication {
      return new Hono();
    },
    mount(application: HonoApplication, dispatch: HostDispatcher<Context>): void {
      application.use("*", async (context, next) => {
        const address = bunAdapter?.peerAddress(context);
        const response = await dispatch(context.req.raw, {
          path: context.req.path,
          ...(address === undefined ? {} : { ip: address }),
          native: context,
        });
        if (response !== undefined) {
          return response;
        }
        await next();
      });
    },
    fetch(application: HonoApplication, request: Request): Response | Promise<Response> {
      return application.fetch(request);
    },
    async listen(application: HonoApplication, port: number): Promise<HonoListener> {
      const server = (
        Bun.serve as unknown as (options: Record<string, unknown>) => {
          readonly port: number;
          stop(force?: boolean): Promise<void>;
        }
      )({
        port,
        // Hono's Bun adapter resolves the server through the context's `env`;
        // the listener hands it the same instance Bun handed the listener.
        fetch: (request: Request, server: unknown) =>
          application.fetch(request, { server } as never),
        ...(bunAdapter === undefined ? {} : { websocket: bunAdapter.support.websocket }),
      });
      return {
        url: `http://localhost:${server.port}`,
        close: async () => {
          await server.stop();
        },
      };
    },
    ...(bunAdapter === undefined
      ? {}
      : {
          mountGateway(application: HonoApplication, plan: GatewayPlan, hooks: GatewayHooks): void {
            const support = bunAdapter.support;
            const route = support.upgradeWebSocket(() => {
              let socket: GatewaySocket | undefined;
              return {
                async onOpen(_event: unknown, native: HonoSocket) {
                  socket = toGatewaySocket(native);
                  await hooks.open(socket);
                },
                async onMessage(event: { readonly data: unknown }, native: HonoSocket) {
                  await hooks.message(socket ?? toGatewaySocket(native), event.data);
                },
                async onClose(_event: unknown, native: HonoSocket) {
                  await hooks.close(socket ?? toGatewaySocket(native));
                },
              };
            });
            application.get(plan.path, route as never);
          },
        }),
  });
}
