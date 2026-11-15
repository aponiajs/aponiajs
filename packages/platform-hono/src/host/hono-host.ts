import { Hono, type Context } from "hono";
import type { HostDispatcher, PlatformHost } from "@aponiajs/platform-core";

/** The native application this platform creates. */
export type HonoApplication = Hono;

interface HonoListener {
  readonly url: string;
  close(force?: boolean): Promise<void>;
}

/**
 * Reads the peer address, when the runtime can state one.
 *
 * Hono exposes connection information through its Bun adapter, which only loads
 * on Bun; a conformance lane on Node asks for no address instead of failing to
 * import. The helper also throws outside a served request, which a `handle`-only
 * test is, so both cases answer `undefined`.
 */
const peerAddress: (context: Context) => string | undefined = await (async () => {
  try {
    const { getConnInfo } = await import("hono/bun");
    return (context: Context): string | undefined => {
      try {
        return getConnInfo(context).remote.address;
      } catch {
        return undefined;
      }
    };
  } catch {
    return () => undefined;
  }
})();

/**
 * The Hono binding of the Aponia kernel.
 *
 * The dispatcher is mounted as middleware, so a request the kernel does not
 * answer continues to whatever the application registered next; middleware
 * registered before this one runs first. `listen` serves through Bun's own
 * server, which is the runtime this repository targets.
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
        const address = peerAddress(context);
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
      const server = Bun.serve({ port, fetch: (request) => application.fetch(request) });
      return {
        url: `http://localhost:${server.port}`,
        close: async () => {
          await server.stop();
        },
      };
    },
  });
}
