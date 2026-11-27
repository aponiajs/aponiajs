import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { AponiaError, type ResponseSettingsState } from "@aponiajs/common";
import { httpErrors, writeCookie, type HttpPolicy } from "@aponiajs/common";
import type {
  CsrfOptions,
  SecurityHeadersOptions,
  SecurityModuleOptions,
} from "../interfaces/security.interface.ts";

const defaultHeaders: SecurityHeadersOptions = Object.freeze({
  contentSecurityPolicy:
    "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; form-action 'self'",
  frameOptions: "DENY",
  referrerPolicy: "no-referrer",
  strictTransportSecurity: "max-age=31536000; includeSubDomains",
  contentTypeOptions: "nosniff",
  permissionsPolicy: "camera=(), microphone=(), geolocation=()",
  crossOriginOpenerPolicy: "same-origin",
  crossOriginResourcePolicy: "same-origin",
});

const defaultCsrfMethods = Object.freeze(["POST", "PUT", "PATCH", "DELETE"]);

/** The nonce one request's CSP used; `getCspNonce` reads it without touching the Request. */
const cspNonces = new WeakMap<Request, string>();

/** The CSRF token one request must echo back, when this response issues it. */
const issuedCsrfTokens = new WeakMap<Request, string>();

/**
 * The nonce the current request's CSP header used, when the policy stated a
 * `{nonce}` placeholder.
 *
 * A handler that renders an inline script passes it to that script's `nonce`
 * attribute, which is what makes the header and the markup agree.
 */
export function getCspNonce(request: Request): string | undefined {
  return cspNonces.get(request);
}

/** The validated policy one security registration builds. */
export interface ResolvedSecurityPolicy {
  readonly headers: SecurityHeadersOptions | false;
  readonly csrf: ResolvedCsrfPolicy | undefined;
}

interface ResolvedCsrfPolicy {
  readonly secret: string;
  readonly cookieName: string;
  readonly headerName: string;
  readonly path: string;
  readonly maxAge: number | undefined;
  readonly domain: string | undefined;
  readonly secure: boolean;
  readonly sameSite: "lax" | "strict" | "none";
  readonly exclude: readonly string[];
  readonly methods: readonly string[];
}

/** Validates one registration and answers the policy it builds. */
export function resolveSecurityPolicy(options: SecurityModuleOptions): ResolvedSecurityPolicy {
  const issues: string[] = [];
  const headers: SecurityHeadersOptions | false =
    options.headers === false
      ? false
      : options.headers === undefined || options.headers === true
        ? defaultHeaders
        : Object.freeze({ ...defaultHeaders, ...options.headers });
  let csrf: ResolvedCsrfPolicy | undefined;

  if (headers !== false) {
    issues.push(...readHeaderIssues(headers));
  }
  if (options.csrf !== undefined) {
    const resolved = readCsrfPolicy(options.csrf, issues);
    if (resolved !== undefined) {
      csrf = resolved;
    }
  }
  if (issues.length > 0) {
    throw new AponiaError(
      "INVALID_SECURITY_OPTIONS",
      `The security registration is invalid: ${issues.join("; ")}.`,
      { issues: Object.freeze(issues) },
    );
  }

  return Object.freeze({ headers, csrf });
}

/**
 * Builds the neutral policies one registration contributes.
 *
 * The header policy computes the CSP nonce before the handler runs and writes
 * the headers onto the final response; the CSRF policy issues the readable
 * double-submit cookie on a safe method and refuses an unsafe one whose token
 * is missing, mismatched, or unsigned.
 *
 * @internal
 */
export function buildSecurityPolicies(policy: ResolvedSecurityPolicy): readonly HttpPolicy[] {
  const policies: HttpPolicy[] = [];

  if (policy.headers !== false) {
    const headers = policy.headers;
    policies.push({
      name: "security-headers",
      onRequest(request) {
        prepareNonce(headers, request);
        return undefined;
      },
      onResponse(request, response) {
        return applySecurityHeaders(response, headers, request);
      },
    });
  }

  if (policy.csrf !== undefined) {
    const csrf = policy.csrf;
    policies.push({
      name: "csrf",
      onRequest(request) {
        return checkCsrf(request, csrf);
      },
      onResponse(request, response) {
        const issued = issuedCsrfTokens.get(request);
        if (issued === undefined) {
          return response;
        }
        const set: ResponseSettingsState = { headers: {} };
        writeCookie(set, csrf.cookieName, issued, {
          httpOnly: false,
          secure: csrf.secure,
          sameSite: csrf.sameSite,
          path: csrf.path,
          ...(csrf.maxAge === undefined ? {} : { maxAge: csrf.maxAge }),
          ...(csrf.domain === undefined ? {} : { domain: csrf.domain }),
        });
        const cookies = set.headers["set-cookie"];
        if (cookies === undefined) {
          return response;
        }
        const headers = new Headers(response.headers);
        for (const cookie of Array.isArray(cookies) ? cookies : [cookies]) {
          headers.append("set-cookie", String(cookie));
        }
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      },
    });
  }

  return Object.freeze(policies);
}

function checkCsrf(request: Request, csrf: ResolvedCsrfPolicy): Response | undefined {
  const url = new URL(request.url);
  if (isExcluded(url.pathname, csrf.exclude)) {
    return undefined;
  }

  const method = request.method.toUpperCase();
  const cookieToken = readCookie(request, csrf.cookieName);

  if (!csrf.methods.includes(method)) {
    if (cookieToken === undefined) {
      issuedCsrfTokens.set(request, issueToken(csrf.secret));
    }
    return undefined;
  }

  const headerToken = request.headers.get(csrf.headerName);
  if (
    cookieToken === undefined ||
    headerToken === null ||
    headerToken !== cookieToken ||
    !verifyToken(cookieToken, csrf.secret)
  ) {
    return httpErrors.forbidden("CSRF token is missing or invalid.").toResponse();
  }
  return undefined;
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (header === null) {
    return undefined;
  }
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    if (part.slice(0, separator).trim() !== name) {
      continue;
    }
    const raw = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

function prepareNonce(headers: SecurityHeadersOptions, request: Request): void {
  const csp = headers.contentSecurityPolicy;
  if (typeof csp === "string" && csp.includes("{nonce}")) {
    cspNonces.set(request, randomBytes(16).toString("base64"));
  }
}

function applySecurityHeaders(
  response: Response,
  headers: SecurityHeadersOptions,
  request: Request,
): Response {
  const target: Record<string, string | number | string[] | undefined> = {};
  applyHeaders(target, headers, request);
  const next = new Headers(response.headers);
  for (const [name, value] of Object.entries(target)) {
    if (value === undefined || next.has(name)) {
      continue;
    }
    next.set(name, String(value));
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: next,
  });
}

function applyHeaders(
  target: Record<string, string | number | string[] | undefined>,
  headers: SecurityHeadersOptions,
  request?: Request,
): void {
  const csp = headers.contentSecurityPolicy;
  if (typeof csp === "string" && csp.includes("{nonce}") && request !== undefined) {
    const nonce = cspNonces.get(request);
    if (nonce !== undefined) {
      target["content-security-policy"] = csp.replaceAll("{nonce}", nonce);
    }
  } else {
    setHeader(target, "content-security-policy", csp);
  }
  setHeader(target, "x-frame-options", headers.frameOptions);
  setHeader(target, "referrer-policy", headers.referrerPolicy);
  setHeader(target, "strict-transport-security", headers.strictTransportSecurity);
  setHeader(target, "x-content-type-options", headers.contentTypeOptions);
  setHeader(target, "permissions-policy", headers.permissionsPolicy);
  setHeader(target, "cross-origin-opener-policy", headers.crossOriginOpenerPolicy);
  setHeader(target, "cross-origin-embedder-policy", headers.crossOriginEmbedderPolicy);
  setHeader(target, "cross-origin-resource-policy", headers.crossOriginResourcePolicy);
}

function setHeader(
  target: Record<string, string | number | string[] | undefined>,
  name: string,
  value: string | false | undefined,
): void {
  if (typeof value === "string") {
    target[name] = value;
  }
}

function issueToken(secret: string): string {
  const nonce = randomBytes(32).toString("hex");
  return `${nonce}.${sign(nonce, secret)}`;
}

function verifyToken(token: string, secret: string): boolean {
  const [nonce, signature, ...rest] = token.split(".");
  if (nonce === undefined || signature === undefined || rest.length > 0) {
    return false;
  }
  const expected = sign(nonce, secret);
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function sign(nonce: string, secret: string): string {
  return createHmac("sha256", secret).update(nonce).digest("hex");
}

function isExcluded(pathname: string, exclude: readonly string[]): boolean {
  return exclude.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix.replace(/\/$/, "")}/`),
  );
}

function readHeaderIssues(headers: SecurityHeadersOptions): string[] {
  const issues: string[] = [];
  const fields: readonly (keyof SecurityHeadersOptions)[] = [
    "contentSecurityPolicy",
    "frameOptions",
    "referrerPolicy",
    "strictTransportSecurity",
    "contentTypeOptions",
    "permissionsPolicy",
    "crossOriginOpenerPolicy",
    "crossOriginEmbedderPolicy",
    "crossOriginResourcePolicy",
  ];
  for (const field of fields) {
    const value = headers[field];
    if (
      value !== undefined &&
      value !== false &&
      (typeof value !== "string" || value.trim() === "")
    ) {
      issues.push(`${field} must be a non-empty string or false`);
    }
  }
  return issues;
}

function readCsrfPolicy(options: CsrfOptions, issues: string[]): ResolvedCsrfPolicy | undefined {
  const before = issues.length;
  if (typeof options.secret !== "string" || options.secret.length < 32) {
    issues.push("csrf.secret must be a string of at least 32 characters");
  }
  const cookieName = options.cookieName ?? "aponia.csrf";
  const headerName = (options.headerName ?? "x-csrf-token").toLowerCase();
  if (cookieName.trim() === "") {
    issues.push("csrf.cookieName must be a non-empty string");
  }
  if (headerName.trim() === "") {
    issues.push("csrf.headerName must be a non-empty string");
  }
  if (options.path !== undefined && options.path.trim() === "") {
    issues.push("csrf.path must be a non-empty string");
  }
  if (options.maxAge !== undefined && (!Number.isInteger(options.maxAge) || options.maxAge < 1)) {
    issues.push("csrf.maxAge must be a positive integer");
  }
  if (options.domain !== undefined && options.domain.trim() === "") {
    issues.push("csrf.domain must be a non-empty string");
  }
  if (options.sameSite !== undefined && !["lax", "strict", "none"].includes(options.sameSite)) {
    issues.push('csrf.sameSite must be "lax", "strict", or "none"');
  }
  if (options.exclude !== undefined && !isStringArray(options.exclude)) {
    issues.push("csrf.exclude must be an array of non-empty strings");
  }
  if (options.methods !== undefined && !isStringArray(options.methods)) {
    issues.push("csrf.methods must be an array of non-empty strings");
  }
  if (issues.length !== before) {
    return undefined;
  }

  return Object.freeze({
    secret: options.secret,
    cookieName,
    headerName,
    path: options.path ?? "/",
    maxAge: options.maxAge,
    domain: options.domain,
    secure: options.secure ?? true,
    sameSite: options.sameSite ?? "lax",
    exclude: Object.freeze([...(options.exclude ?? [])]),
    methods: Object.freeze(
      (options.methods ?? defaultCsrfMethods).map((method) => method.toUpperCase()),
    ),
  });
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.trim() !== "")
  );
}
