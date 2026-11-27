type AponiaContainer = {
  readonly graph: {
    readonly root: import("../interfaces/module.interface.ts").ModuleDefinition;
    readonly modules: readonly import("../interfaces/module.interface.ts").ModuleDefinition[];
  };
  get<T>(token: import("../interfaces/token.interface.ts").Token<T>): T;
  resolveModuleProvider<T>(
    moduleDefinition: import("../interfaces/module.interface.ts").ModuleDefinition,
    token: import("../interfaces/token.interface.ts").Token<T>,
  ): T;
};
import { AponiaError } from "../exceptions/aponia-error.ts";
import { createToken } from "../tokens/token.ts";
import { provideFactory, provideValue } from "../providers/provider.ts";
import { type ModuleDefinition } from "../interfaces/module.interface.ts";
import { type Provider } from "../interfaces/provider.interface.ts";
import { type TokenMap, type Token } from "../interfaces/token.interface.ts";
import type {
  CompressionOptions,
  CorsOptions,
  EtagOptions,
  HttpPolicy,
  HttpPolicyOptions,
  ResolvedCors,
  ResolvedHttpPolicies,
  SecurityHeadersOptions,
} from "../interfaces/http-policy.interface.ts";

export type { HttpPolicy } from "../interfaces/http-policy.interface.ts";

const defaultCorsMethods = Object.freeze([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
]);

/** Bodies larger than this are not buffered just to compute an ETag. */
const maxEtagBytes = 1024 * 1024;

/** The headers `securityHeaders: true` emits; none of them is CSP. */
const defaultSecurityHeaders: readonly (readonly [string, string])[] = Object.freeze(
  (
    [
      ["x-content-type-options", "nosniff"],
      ["x-frame-options", "SAMEORIGIN"],
      ["referrer-policy", "no-referrer"],
      ["strict-transport-security", "max-age=15552000; includeSubDomains"],
      ["cross-origin-opener-policy", "same-origin"],
      ["cross-origin-resource-policy", "same-origin"],
      ["permissions-policy", "camera=(), microphone=(), geolocation=()"],
    ] as [string, string][]
  ).map((entry) => Object.freeze(entry) as readonly [string, string]),
);

/**
 * Validates the response policies an application declared.
 *
 * @param options - The declared policies.
 * @returns The resolved policies, or `undefined` when none is declared.
 * @throws An `AponiaError` with `INVALID_CONFIGURATION_VALUE`.
 */
export function resolveApplicationHttpPolicies(
  options: HttpPolicyOptions,
): ResolvedHttpPolicies | undefined {
  const cors = resolveCors(options.cors);
  const securityHeaders = resolveSecurityHeaders(options.securityHeaders);
  const etag = resolveEtag(options.etag);
  const compression = resolveCompression(options.compression);
  if (
    cors === undefined &&
    securityHeaders === undefined &&
    etag === undefined &&
    compression === undefined
  ) {
    return undefined;
  }
  return Object.freeze({ cors, securityHeaders, etag, compression });
}

/**
 * The policies one module contributes.
 * @internal
 */
export const HTTP_POLICIES = createToken<readonly HttpPolicy[]>("aponia.http.policies");

/**
 * Registers one neutral HTTP policy.
 *
 * A module that contributes two policies registers them together with
 * {@link provideHttpPolicies}: a module's providers are unique by token, so
 * two separate values would be refused as a duplicate.
 *
 * @param name - The policy's identity, for diagnostics and duplicate checks.
 * @param handler - The request and response phases the policy implements.
 * @returns A frozen value provider the module's `providers` accepts.
 * @throws A `TypeError` when the name is empty or no phase is implemented.
 */
export function provideHttpPolicy(name: string, handler: Omit<HttpPolicy, "name">): Provider {
  return provideHttpPolicies({ name, ...handler });
}

/**
 * Registers a module's HTTP policies in declaration order.
 *
 * @param policies - The policies this module contributes.
 * @returns A frozen value provider the module's `providers` accepts.
 * @throws A `TypeError` when a policy states no name or no phase.
 */
export function provideHttpPolicies(...policies: readonly HttpPolicy[]): Provider {
  return provideValue(HTTP_POLICIES, Object.freeze(policies.map((policy) => checkPolicy(policy))));
}

/**
 * Registers a module's HTTP policies from a factory over injected values.
 *
 * This is the asynchronous form a registration whose policy depends on a
 * validated configuration uses. The factory runs in the boot's provider pass,
 * so the policy is built once rather than per request.
 *
 * @param dependencies - The tokens the factory receives.
 * @param factory - Builds one policy, or several, from the resolved values.
 * @returns A factory provider the module's `providers` accepts.
 */
export function provideHttpPolicyAsync<const TDependencies extends readonly Token<unknown>[]>(
  dependencies: TDependencies,
  factory: (...values: TokenMap<TDependencies>) => HttpPolicy | readonly HttpPolicy[],
): Provider {
  return provideFactory(HTTP_POLICIES, dependencies, (...values: TokenMap<TDependencies>) => {
    const built = factory(...values);
    const list = Array.isArray(built) ? built : [built as HttpPolicy];
    return Object.freeze(list.map((policy) => checkPolicy(policy)));
  });
}

/**
 * Registers several HTTP policies a factory builds from injected values.
 *
 * @param dependencies - The tokens the factory receives.
 * @param factory - Builds the policies from the resolved values.
 * @returns A factory provider the module's `providers` accepts.
 */
export function provideHttpPoliciesAsync<const TDependencies extends readonly Token<unknown>[]>(
  dependencies: TDependencies,
  factory: (...values: TokenMap<TDependencies>) => readonly HttpPolicy[],
): Provider {
  return provideFactory(HTTP_POLICIES, dependencies, (...values: TokenMap<TDependencies>) =>
    Object.freeze(factory(...values).map((policy) => checkPolicy(policy))),
  );
}

/**
 * Compiles the policies the whole graph contributes, once at boot.
 *
 * @param container - The container the boot built.
 * @returns The policies in module order, then declaration order.
 */
export function resolveHttpPolicies(container: AponiaContainer): readonly HttpPolicy[] {
  const resolved: HttpPolicy[] = [];
  for (const module of container.graph.modules) {
    resolved.push(...readPolicies(container, module));
  }
  return Object.freeze(resolved);
}

/**
 * Runs each policy's `onRequest` phase until one answers.
 *
 * @param policies - The resolved policies.
 * @param request - The incoming request.
 * @returns The short-circuiting response, or `undefined`.
 */
export async function runHttpPolicyRequests(
  policies: readonly HttpPolicy[],
  request: Request,
): Promise<Response | undefined> {
  for (const policy of policies) {
    if (policy.onRequest === undefined) {
      continue;
    }
    const response = await policy.onRequest(request);
    if (response !== undefined) {
      return response;
    }
  }
  return undefined;
}

/**
 * Runs each policy's `onResponse` phase in declaration order.
 *
 * @param policies - The resolved policies.
 * @param request - The request the response answers.
 * @param response - The response so far.
 * @returns The transformed response.
 */
export async function applyHttpPolicyResponses(
  policies: readonly HttpPolicy[],
  request: Request,
  response: Response,
): Promise<Response> {
  let current = response;
  for (const policy of policies) {
    if (policy.onResponse === undefined) {
      continue;
    }
    const next = await policy.onResponse(request, current);
    if (next instanceof Response) {
      current = next;
    }
  }
  return current;
}

/**
 * Validates a cross-origin policy and answers the value a transform runs with.
 *
 * @param options - The declared policy.
 * @returns The validated policy, or `undefined` when none is declared.
 * @throws An `AponiaError` with `INVALID_CONFIGURATION_VALUE`.
 */
export function resolveCorsOptions(
  options: CorsOptions | boolean | undefined,
): ResolvedCors | undefined {
  return resolveCors(options);
}

/**
 * Adds the cross-origin headers one response carries.
 *
 * @param request - The request the response answers.
 * @param response - The response so far.
 * @param cors - The validated policy.
 * @returns The transformed response.
 */
export function applyCors(request: Request, response: Response, cors: ResolvedCors): Response {
  const origin = request.headers.get("origin");
  const allowed = allowedOrigin(origin, cors);
  return withHeaders(response, (headers) => {
    if (allowed !== undefined) {
      headers.set("access-control-allow-origin", allowed);
      if (cors.credentials) {
        headers.set("access-control-allow-credentials", "true");
      }
      if (cors.exposedHeaders.length > 0) {
        headers.set("access-control-expose-headers", cors.exposedHeaders.join(", "));
      }
    }
    // A cache must not answer a later allowed origin from a denied response.
    headers.set("vary", appendVary(headers.get("vary"), "Origin"));
  });
}

function readPolicies(container: AponiaContainer, module: ModuleDefinition): readonly HttpPolicy[] {
  if (!module.providers.some((provider) => provider.provide === HTTP_POLICIES)) {
    return [];
  }
  return container.resolveModuleProvider(module, HTTP_POLICIES) as readonly HttpPolicy[];
}

function checkPolicy(policy: HttpPolicy): HttpPolicy {
  if (typeof policy.name !== "string" || policy.name.trim().length === 0) {
    throw new TypeError("An HTTP policy needs a non-empty name.");
  }
  if (policy.onRequest === undefined && policy.onResponse === undefined) {
    throw new TypeError(`The HTTP policy "${policy.name}" implements no phase.`);
  }
  return Object.freeze({
    name: policy.name,
    ...(policy.onRequest === undefined ? {} : { onRequest: policy.onRequest.bind(policy) }),
    ...(policy.onResponse === undefined ? {} : { onResponse: policy.onResponse.bind(policy) }),
  });
}

/**
 * Answers a CORS preflight, or declines a request that is not one.
 *
 * @param request - The incoming request.
 * @param policies - The resolved policies.
 * @returns The preflight response, or `undefined`.
 */
export function corsPreflight(
  request: Request,
  policies: ResolvedHttpPolicies,
): Response | undefined {
  const cors = policies.cors;
  if (cors === undefined || request.method !== "OPTIONS") {
    return undefined;
  }
  const requestedMethod = request.headers.get("access-control-request-method");
  if (requestedMethod === null) {
    return undefined;
  }

  const origin = request.headers.get("origin");
  const allowed = allowedOrigin(origin, cors);
  const headers = new Headers({ vary: "Origin" });
  if (allowed !== undefined) {
    headers.set("access-control-allow-origin", allowed);
    headers.set("access-control-allow-methods", cors.methods.join(", "));
    const allowedHeaders =
      cors.allowedHeaders ??
      (request.headers.get("access-control-request-headers") ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
    if (allowedHeaders.length > 0) {
      headers.set("access-control-allow-headers", allowedHeaders.join(", "));
    }
    if (cors.maxAge !== undefined) {
      headers.set("access-control-max-age", String(cors.maxAge));
    }
    if (cors.credentials) {
      headers.set("access-control-allow-credentials", "true");
    }
  }
  return new Response(null, { status: 204, headers });
}

/**
 * Applies the declared policies to one response.
 *
 * Header policies run first, then the entity tag, then compression, so a `304`
 * is decided against the identity body and a compressed body never carries a
 * stale length.
 *
 * @param request - The request the response answers.
 * @param response - The response the route or the runtime produced.
 * @param policies - The resolved policies.
 * @returns The response to send.
 */
export async function applyHttpPolicies(
  request: Request,
  response: Response,
  policies: ResolvedHttpPolicies,
): Promise<Response> {
  let current = response;

  if (policies.securityHeaders !== undefined) {
    current = withHeaders(current, (headers) => {
      for (const [name, value] of policies.securityHeaders ?? []) {
        if (!headers.has(name)) {
          headers.set(name, value);
        }
      }
    });
  }

  if (policies.cors !== undefined) {
    const origin = request.headers.get("origin");
    const allowed = allowedOrigin(origin, policies.cors);
    if (allowed !== undefined) {
      current = withHeaders(current, (headers) => {
        headers.set("access-control-allow-origin", allowed);
        headers.set("vary", appendVary(headers.get("vary"), "origin"));
        if (policies.cors?.credentials === true) {
          headers.set("access-control-allow-credentials", "true");
        }
        if ((policies.cors?.exposedHeaders.length ?? 0) > 0) {
          headers.set(
            "access-control-expose-headers",
            policies.cors?.exposedHeaders.join(", ") ?? "",
          );
        }
      });
    }
  }

  if (policies.etag !== undefined) {
    current = await applyEtag(request, current, policies.etag);
  }

  if (policies.compression !== undefined) {
    current = compressResponse(request, current, policies.compression);
  }

  return current;
}

function resolveCors(options: CorsOptions | boolean | undefined): ResolvedCors | undefined {
  if (options === undefined || options === false) {
    return undefined;
  }
  if (options === true) {
    return Object.freeze({
      origin: "*",
      methods: defaultCorsMethods,
      allowedHeaders: undefined,
      exposedHeaders: Object.freeze([]),
      credentials: false,
      maxAge: undefined,
    });
  }

  const issues: string[] = [];
  const origin = options.origin ?? "*";
  if (origin === "*" && options.credentials === true) {
    issues.push('"cors.credentials" cannot be true when "cors.origin" is "*"');
  }
  if (
    typeof origin !== "string" &&
    typeof origin !== "function" &&
    (!Array.isArray(origin) || origin.some((entry) => typeof entry !== "string"))
  ) {
    issues.push('"cors.origin" must be a string, a string array, or a function');
  }
  if (
    options.methods !== undefined &&
    (!Array.isArray(options.methods) || options.methods.some((entry) => typeof entry !== "string"))
  ) {
    issues.push('"cors.methods" must be a string array');
  }
  for (const field of ["allowedHeaders", "exposedHeaders"] as const) {
    const value = options[field];
    if (
      value !== undefined &&
      (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
    ) {
      issues.push(`"cors.${field}" must be a string array`);
    }
  }
  if (options.maxAge !== undefined && (!Number.isInteger(options.maxAge) || options.maxAge < 0)) {
    issues.push('"cors.maxAge" must be a non-negative integer');
  }
  if (issues.length > 0) {
    throw new AponiaError("INVALID_CONFIGURATION_VALUE", "The CORS policy is invalid.", {
      issues: Object.freeze(issues),
    });
  }

  return Object.freeze({
    origin,
    methods: Object.freeze([...(options.methods ?? defaultCorsMethods)]),
    allowedHeaders:
      options.allowedHeaders === undefined ? undefined : Object.freeze([...options.allowedHeaders]),
    exposedHeaders: Object.freeze([...(options.exposedHeaders ?? [])]),
    credentials: options.credentials === true,
    maxAge: options.maxAge,
  });
}

function resolveSecurityHeaders(
  options: SecurityHeadersOptions | boolean | undefined,
): readonly (readonly [string, string])[] | undefined {
  if (options === undefined || options === false) {
    return undefined;
  }
  if (options === true) {
    return defaultSecurityHeaders;
  }

  const headers: [string, string][] = [];
  const add = (name: string, value: string | false | undefined, fallback: string): void => {
    if (value === false) {
      return;
    }
    headers.push([name, value ?? fallback]);
  };
  add("content-security-policy", options.contentSecurityPolicy, "default-src 'self'");
  add(
    "strict-transport-security",
    options.strictTransportSecurity,
    "max-age=15552000; includeSubDomains",
  );
  add("x-frame-options", options.xFrameOptions, "SAMEORIGIN");
  add("referrer-policy", options.referrerPolicy, "no-referrer");
  if (options.xContentTypeOptions !== false) {
    headers.push(["x-content-type-options", "nosniff"]);
  }
  add("cross-origin-opener-policy", options.crossOriginOpenerPolicy, "same-origin");
  add("cross-origin-resource-policy", options.crossOriginResourcePolicy, "same-origin");
  add("permissions-policy", options.permissionsPolicy, "camera=(), microphone=(), geolocation=()");
  return Object.freeze(headers.map((entry) => Object.freeze(entry) as readonly [string, string]));
}

function resolveEtag(options: EtagOptions | boolean | undefined): EtagOptions | undefined {
  if (options === undefined || options === false) {
    return undefined;
  }
  return options === true ? Object.freeze({ weak: true }) : Object.freeze({ ...options });
}

function resolveCompression(
  options: CompressionOptions | boolean | undefined,
): CompressionOptions | undefined {
  if (options === undefined || options === false) {
    return undefined;
  }
  if (options === true) {
    return Object.freeze({ enabled: true, threshold: 1024 });
  }
  if (
    options.threshold !== undefined &&
    (!Number.isInteger(options.threshold) || options.threshold < 0)
  ) {
    throw new AponiaError("INVALID_CONFIGURATION_VALUE", "The compression policy is invalid.", {
      issues: Object.freeze(['"compression.threshold" must be a non-negative integer']),
    });
  }
  if (options.enabled === false) {
    return undefined;
  }
  return Object.freeze({ enabled: true, threshold: options.threshold ?? 1024 });
}

function allowedOrigin(origin: string | null, cors: ResolvedCors): string | undefined {
  if (typeof cors.origin === "function") {
    return origin === null ? undefined : cors.origin(origin);
  }
  if (cors.origin === "*") {
    return "*";
  }
  const list = Array.isArray(cors.origin) ? cors.origin : [cors.origin];
  if (origin !== null && list.includes(origin)) {
    return origin;
  }
  return undefined;
}

function withHeaders(response: Response, mutate: (headers: Headers) => void): Response {
  const headers = new Headers(response.headers);
  mutate(headers);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function applyEtag(
  request: Request,
  response: Response,
  options: EtagOptions,
): Promise<Response> {
  if (response.status !== 200 || response.body === null || response.headers.has("etag")) {
    return response;
  }
  // An event stream never ends: buffering it would hang the request.
  if ((response.headers.get("content-type") ?? "").startsWith("text/event-stream")) {
    return response;
  }
  // shortcut: a non-SSE chunked body without content-length is still buffered;
  // upgrade to a bounded reader if such an endpoint appears.
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > maxEtagBytes) {
    return response;
  }
  const bytes = await response.clone().arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const tag = `${options.weak === false ? "" : "W/"}${JSON.stringify(hex)}`;
  const headers = new Headers(response.headers);
  headers.set("etag", tag);

  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch !== null && ifNoneMatch.split(",").some((entry) => sameTag(entry.trim(), tag))) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function sameTag(left: string, right: string): boolean {
  return left.replace(/^W\//, "") === right.replace(/^W\//, "");
}

function compressResponse(
  request: Request,
  response: Response,
  options: CompressionOptions,
): Response {
  if (options.enabled === false || response.body === null || request.method === "HEAD") {
    return response;
  }
  if (response.headers.has("content-encoding")) {
    return response;
  }
  const type = response.headers.get("content-type") ?? "";
  if (!isCompressible(type)) {
    return response;
  }
  const accepted = request.headers.get("accept-encoding") ?? "";
  if (!/\bgzip\b/.test(accepted)) {
    return response;
  }
  const rawLength = response.headers.get("content-length");
  const length = rawLength === null ? undefined : Number(rawLength);
  if (length !== undefined && Number.isFinite(length) && length < (options.threshold ?? 1024)) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("content-encoding", "gzip");
  headers.set("vary", appendVary(headers.get("vary"), "accept-encoding"));
  headers.delete("content-length");
  return new Response(response.body.pipeThrough(new CompressionStream("gzip")), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isCompressible(contentType: string): boolean {
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (type === "") {
    return false;
  }
  return (
    type.startsWith("text/") ||
    type === "application/json" ||
    type === "application/javascript" ||
    type === "application/xml" ||
    type === "application/xhtml+xml" ||
    type === "image/svg+xml"
  );
}

function appendVary(current: string | null, value: string): string {
  if (current === null || current.trim() === "") {
    return value;
  }
  const values = current.split(",").map((entry) => entry.trim().toLowerCase());
  return values.includes(value) ? current : `${current}, ${value}`;
}
