import { AponiaError, versionPathSegment } from "@aponiajs/common";
import { stripRoutePrefix } from "./route-prefix.ts";
import type {
  AponiaVersioningOptions,
  VersionNegotiationRoute,
  VersionNegotiator,
} from "./version-negotiation.types.ts";

interface ResolvedVersioning {
  readonly type: "header" | "media-type";
  readonly header: string;
  readonly parameter: string;
  readonly defaultVersion: string | undefined;
}

interface VersionedPathEntry {
  readonly method: string;
  readonly pattern: RegExp;
  readonly versions: ReadonlyMap<string, string>;
  readonly specificity: number;
}

interface VersionTable {
  readonly exact: ReadonlyMap<string, ReadonlyMap<string, string>>;
  readonly dynamic: readonly VersionedPathEntry[];
}

/**
 * Compiles header and media-type version negotiation for one boot.
 *
 * The router mounts one path per handler, so each version lives at its URI
 * path; negotiation is the layer that lets a client reach a version by header
 * without changing the request path. The rewrite happens before routing, so
 * the selected route's guards, pipes, validation, and filters run exactly as
 * they would for a request that named the versioned path.
 *
 * @param routes - The lowered routes, before the application prefix is joined.
 * @param options - The declared versioning options.
 * @param routePrefix - The application's normalized route prefix.
 * @returns The negotiator, or `undefined` for URI versioning and no option.
 * @throws An `AponiaError` with `INVALID_CONFIGURATION_VALUE` when the options
 *   are invalid.
 *
 * @internal
 */
export function createVersionNegotiator(
  routes: readonly VersionNegotiationRoute[],
  options: AponiaVersioningOptions | undefined,
  routePrefix = "",
): VersionNegotiator | undefined {
  const resolved = resolveVersioning(options);
  if (resolved === undefined) {
    return undefined;
  }
  const table = buildVersionTable(routes);
  if (table === undefined) {
    return undefined;
  }

  return (request: Request): Request | Response | undefined => {
    const url = new URL(request.url);
    const publicPath = stripRoutePrefix(url.pathname, routePrefix);
    if (publicPath === undefined) {
      return undefined;
    }
    const versions = findVersionedRoutes(table, request.method, publicPath);
    if (versions === undefined) {
      return undefined;
    }
    const requested = readRequestedVersion(request, resolved);
    const version = normalizeVersion(requested ?? resolved.defaultVersion);
    if (version === undefined) {
      return undefined;
    }
    const versionPrefix = versions.get(version);
    if (versionPrefix === undefined) {
      return versionProblem(
        `API version ${version} is not available for ${request.method.toUpperCase()} ${url.pathname}.`,
      );
    }
    const rewritten = new URL(request.url);
    // The table holds the version's mount prefix, not the declared path: a
    // parameterized route must keep the values the client actually sent.
    rewritten.pathname =
      publicPath === "/"
        ? `${routePrefix}${versionPrefix}`
        : `${routePrefix}${versionPrefix}${publicPath}`;
    return new Request(rewritten.toString(), copyRequestInit(request));
  };
}

function resolveVersioning(
  options: AponiaVersioningOptions | undefined,
): ResolvedVersioning | undefined {
  if (options === undefined || options.type === "uri") {
    return undefined;
  }
  const issues: string[] = [];
  if (options.type !== "header" && options.type !== "media-type") {
    issues.push('versioning.type must be "uri", "header", or "media-type"');
  }
  const header = options.header ?? "x-api-version";
  if (typeof header !== "string" || header.trim() === "") {
    issues.push("versioning.header must be a non-empty string");
  }
  const parameter = options.parameter ?? "version";
  if (typeof parameter !== "string" || parameter.trim() === "") {
    issues.push("versioning.parameter must be a non-empty string");
  }
  if (
    options.defaultVersion !== undefined &&
    (typeof options.defaultVersion !== "string" || options.defaultVersion.trim() === "")
  ) {
    issues.push("versioning.defaultVersion must be a non-empty string when present");
  }
  if (issues.length > 0) {
    throw new AponiaError("INVALID_CONFIGURATION_VALUE", "The versioning options are invalid.", {
      issues: Object.freeze([...issues]),
    });
  }
  return Object.freeze({
    type: options.type as "header" | "media-type",
    header,
    parameter,
    defaultVersion: options.defaultVersion,
  });
}

function buildVersionTable(routes: readonly VersionNegotiationRoute[]): VersionTable | undefined {
  const table = new Map<string, Map<string, string>>();
  for (const route of routes) {
    if (typeof route.version !== "string") {
      continue;
    }
    const prefix = `/${versionPathSegment(route.version)}`;
    if (!route.path.startsWith(`${prefix}/`) && route.path !== prefix) {
      continue;
    }
    const publicPath = route.path.slice(prefix.length) || "/";
    const key = `${route.method.toUpperCase()} ${publicPath}`;
    const versions = table.get(key) ?? new Map<string, string>();
    versions.set(normalizeVersion(route.version) as string, prefix);
    table.set(key, versions);
  }
  if (table.size === 0) {
    return undefined;
  }

  const exact = new Map<string, ReadonlyMap<string, string>>();
  const dynamic: VersionedPathEntry[] = [];
  for (const [key, versions] of table) {
    const separator = key.indexOf(" ");
    const method = key.slice(0, separator);
    const path = key.slice(separator + 1);
    const frozen = Object.freeze(new Map(versions));
    const pattern = compilePathPattern(path);
    if (pattern === undefined) {
      exact.set(key, frozen);
      continue;
    }
    dynamic.push(
      Object.freeze({
        method,
        pattern: pattern.regex,
        versions: frozen,
        specificity: pattern.specificity,
      }),
    );
  }
  dynamic.sort((left, right) => right.specificity - left.specificity);

  return Object.freeze({ exact: Object.freeze(exact), dynamic: Object.freeze(dynamic) });
}

function findVersionedRoutes(
  table: VersionTable,
  method: string,
  pathname: string,
): ReadonlyMap<string, string> | undefined {
  const upper = method.toUpperCase();
  const exact = table.exact.get(`${upper} ${pathname}`);
  if (exact !== undefined) {
    return exact;
  }
  return matchDynamic(table.dynamic, upper, pathname);
}

function matchDynamic(
  entries: readonly VersionedPathEntry[],
  method: string,
  pathname: string,
): ReadonlyMap<string, string> | undefined {
  for (const entry of entries) {
    if (entry.method === method && entry.pattern.test(pathname)) {
      return entry.versions;
    }
  }
  return undefined;
}

/**
 * Compiles a public path into a matcher when it carries a parameter or a
 * wildcard. Literal segments raise the specificity so `/users/me` is consulted
 * before `/users/:id`, mirroring the router's own precedence.
 */
function compilePathPattern(
  path: string,
): { readonly regex: RegExp; readonly specificity: number } | undefined {
  if (!path.includes(":") && !path.includes("*")) {
    return undefined;
  }
  let source = "^";
  let specificity = 0;
  for (const segment of path.split("/").slice(1)) {
    if (segment === "*") {
      source += "/.*";
      continue;
    }
    if (segment.startsWith(":")) {
      const optional = segment.endsWith("?");
      source += optional ? "(?:/[^/]+)?" : "/[^/]+";
      specificity += optional ? 1 : 2;
      continue;
    }
    specificity += 4;
    source += `/${escapeRegExp(segment)}`;
  }
  return { regex: new RegExp(`${source}$`), specificity };
}

/**
 * Carries the original request's method, headers, and body onto the rewritten
 * URL. A body stream needs `duplex: "half"` on runtimes that enforce the
 * streaming request rule; Bun ignores it.
 */
function copyRequestInit(request: Request): RequestInit {
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal,
  };
  if (request.body !== null) {
    init.duplex = "half";
  }
  return init;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readRequestedVersion(request: Request, options: ResolvedVersioning): string | undefined {
  if (options.type === "header") {
    const value = request.headers.get(options.header);
    return value === null || value.trim() === "" ? undefined : value.trim();
  }
  const accept = request.headers.get("accept");
  if (accept === null) {
    return undefined;
  }
  for (const entry of accept.split(",")) {
    for (const parameter of entry.split(";").slice(1)) {
      const [name, value] = parameter.split("=");
      if (name?.trim().toLowerCase() === options.parameter.toLowerCase() && value !== undefined) {
        const cleaned = value.trim().replace(/^"(.*)"$/, "$1");
        return cleaned === "" ? undefined : cleaned;
      }
    }
  }
  return undefined;
}

function normalizeVersion(version: string | undefined): string | undefined {
  if (version === undefined) {
    return undefined;
  }
  const trimmed = version.trim().replace(/^v/i, "");
  return trimmed === "" ? undefined : trimmed;
}

function versionProblem(detail: string): Response {
  return new Response(
    JSON.stringify({
      type: "about:blank",
      title: "API version not found",
      status: 400,
      detail,
      code: "API_VERSION_NOT_FOUND",
    }),
    { status: 400, headers: { "content-type": "application/problem+json" } },
  );
}
