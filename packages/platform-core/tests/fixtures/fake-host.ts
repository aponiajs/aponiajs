import {
  buildResponse,
  createRouteMatcher,
  readCookies,
  readHeaders,
  readQuery,
  type MountedRoute,
  type PlatformHost,
  type PlatformRouteContext,
  type PlatformRouteHandler,
  type RouteMatcher,
} from "../../src/index.ts";

/** A native application a test can inspect. */
export interface FakeApp {
  readonly name: string;
  readonly routes: {
    readonly mount: MountedRoute;
    readonly handler: PlatformRouteHandler;
  }[];
  matcher?: RouteMatcher;
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
      application.matcher ??= createRouteMatcher(application.routes.map((entry) => entry.mount));
      const url = new URL(request.url);
      const match = application.matcher.match(request.method, url.pathname);
      if (match === undefined) {
        return new Response("host 404", { status: 404 });
      }
      const entry = application.routes.find((candidate) => candidate.mount === match.mount);
      if (entry === undefined) {
        return new Response("host 404", { status: 404 });
      }
      return await entry.handler(createContext(request, url, match, application.store ?? {}));
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
    params: match.params,
    headers: readHeaders(request),
    cookie: readCookies(request),
    request,
    path: match.mount.route.path,
    set,
    store,
    host: url.host,
    status: (status, body) => {
      set.status = status;
      return buildResponse(body, set, request.method);
    },
  } as PlatformRouteContext;
}
