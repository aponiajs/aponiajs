import { H3, getRequestIP, type H3Event } from "h3";
import type { HostDispatcher, PlatformHost } from "@aponiajs/platform-core";

/** The native application this platform creates. */
export type H3Application = H3;

interface H3Listener {
  readonly url: string;
  close(force?: boolean): Promise<void>;
}

function peerAddress(event: H3Event): string | undefined {
  try {
    return getRequestIP(event);
  } catch {
    return undefined;
  }
}

/**
 * The H3 binding of the Aponia kernel.
 *
 * The dispatcher is middleware, so a request the kernel does not answer
 * continues down the application's own chain; H3 middleware registered before
 * it runs first. `listen` serves through Bun's own server.
 *
 * @returns The host.
 */
export function createH3Host(): PlatformHost<H3Application, H3Event> {
  return Object.freeze({
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
