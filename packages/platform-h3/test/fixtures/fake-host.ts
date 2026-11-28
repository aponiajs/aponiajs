import {
  buildResponse,
  readCookies,
  readHeaders,
  readQuery,
  type MountedRoute,
  type PlatformHost,
  type PlatformRouteContext,
  type PlatformRouteHandler,
} from "@aponiajs/common";

/** A native application a test can inspect. */
export interface FakeApp {
  readonly name: string;
  readonly routes: {
    readonly mount: MountedRoute;
    readonly handler: PlatformRouteHandler;
  }[];
  store?: Record<string, unknown>;
}

/**
 * A host that matches routes the way a native router would, without importing
 * a runtime: it keeps every mount and answers through the shared route handler.
 */
export function fakeHost(): PlatformHost<FakeApp> {
  return {
    name: "fake",
    createApplication(name) {
      return { name, routes: [] };
    },
    mountRoute(application, mount, handler, options) {
      application.routes.push({ mount, handler });
      application.store = options?.store;
    },
    async fetch(application, request) {
      const url = new URL(request.url);
      const reqParts = url.pathname.split("/").filter(Boolean);
      let matchedEntry: FakeApp["routes"][number] | undefined;
      let matchedParams: Record<string, string> = {};
      for (const candidate of application.routes) {
        if (
          candidate.mount.route.method !== request.method &&
          candidate.mount.route.method !== "ALL"
        ) {
          continue;
        }
        const routeParts = candidate.mount.route.path.split("/").filter(Boolean);
        if (routeParts.length !== reqParts.length) continue;
        const params: Record<string, string> = {};
        let ok = true;
        for (let i = 0; i < routeParts.length; i++) {
          if (routeParts[i]!.startsWith(":")) {
            params[routeParts[i]!.slice(1)] = reqParts[i]!;
          } else if (routeParts[i] !== reqParts[i]) {
            ok = false;
            break;
          }
        }
        if (ok) {
          matchedEntry = candidate;
          matchedParams = params;
          break;
        }
      }
      if (matchedEntry === undefined) {
        return new Response("host 404", { status: 404 });
      }
      return await matchedEntry.handler(
        createContext(
          request,
          url,
          { mount: matchedEntry.mount, params: matchedParams },
          application.store ?? {},
        ),
      );
    },
    async close() {},
  };
}

function createContext(
  request: Request,
  url: URL,
  match: { readonly mount: MountedRoute; readonly params: Readonly<Record<string, string>> },
  store: Record<string, unknown>,
): PlatformRouteContext {
  const set: {
    status?: number | string;
    headers: Record<string, string | number | string[] | undefined>;
  } = { headers: {} };
  return {
    body: undefined,
    query: readQuery(url),
    params: {},
    headers: readHeaders(request),
    cookie: readCookies(request),
    request,
    path: url.pathname,
    set,
    store,
    host: url.host,
    status: (status, body) => {
      set.status = status;
      return buildResponse(body, set, request.method);
    },
  } as PlatformRouteContext;
}
