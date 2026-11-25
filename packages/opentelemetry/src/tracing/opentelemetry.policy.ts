import { AponiaError, type ConfigurationToken } from "@aponiajs/common";
import {
  SpanKind,
  SpanStatusCode,
  context,
  propagation,
  trace,
  type Attributes,
  type Span,
} from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK, type NodeSDKConfiguration } from "@opentelemetry/sdk-node";
import { matchedRouteOf, type RequestLifecycleHook } from "@aponiajs/platform-core";
import type { OpentelemetryConfiguration } from "../interfaces/opentelemetry-tracing.interface.ts";

/** The credential-bearing header names the cross-field rule refuses. */
const credentialHeaders: readonly string[] = Object.freeze([
  "authorization",
  "proxy-authorization",
  "cookie",
]);

/**
 * The fields of the configuration this package owns.
 * @internal
 */
export interface OpentelemetryPolicy {
  readonly serviceName: string;
  readonly recordBody: { readonly request: boolean; readonly response: boolean };
  readonly headersToSpanAttributes: {
    readonly request: readonly string[];
    readonly response: readonly string[];
  };
  readonly spanUrlRedaction:
    | false
    | { readonly stripCredentials: boolean; readonly sensitiveQueryParams: readonly string[] };
}

/**
 * The runtime half of the module's options: the live objects and SDK settings a
 * configuration cannot carry.
 * @internal
 */
export type OpentelemetryRuntimeOptions = Omit<
  Partial<NodeSDKConfiguration>,
  "serviceName" | "recordBody" | "headersToSpanAttributes" | "spanUrlRedaction" | "resource"
>;

let sdkStarted = false;

/**
 * Builds the neutral tracing hook one registration contributes.
 *
 * The hook wraps the request, so the server span is active for the handler, the
 * guards, and every service the handler calls. The SDK starts once per process;
 * a later registration's processors never take effect, which is the
 * process-global limit the README states.
 *
 * @internal
 */
export function createOpentelemetryHook(
  runtime: Readonly<OpentelemetryRuntimeOptions>,
  policy: OpentelemetryPolicy,
): RequestLifecycleHook {
  startSdk(runtime, policy);
  const tracer = trace.getTracer(policy.serviceName);

  return {
    name: "opentelemetry",
    async wrap(request, next) {
      const parent = propagation.extract(context.active(), headersOf(request));
      const span = tracer.startSpan(
        `${request.method} ${new URL(request.url).pathname}`,
        {
          kind: SpanKind.SERVER,
          attributes: await requestAttributes(request, policy),
        },
        parent,
      );

      return await context.with(trace.setSpan(parent, span), async () => {
        try {
          const response = await next(request);
          span.setAttribute("http.response.status_code", response.status);
          const route = matchedRouteOf(request);
          if (route !== undefined) {
            span.setAttribute("http.route", route);
          }
          const attributes: Attributes = {};
          for (const name of policy.headersToSpanAttributes.response) {
            const value = response.headers.get(name);
            if (value !== null) {
              attributes[`http.response.header.${name}`] = value;
            }
          }
          if (policy.recordBody.response) {
            attributes["http.response.body"] = await response.clone().text();
          }
          if (Object.keys(attributes).length > 0) {
            span.setAttributes(attributes);
          }
          if (response.status >= 500) {
            span.setStatus({ code: SpanStatusCode.ERROR });
          }
          return response;
        } catch (error) {
          recordFailure(span, error);
          throw error;
        } finally {
          span.end();
        }
      });
    },
  };
}

/**
 * Reads the policy a configuration validated into.
 * @internal
 */
export function readOpentelemetryPolicy<TSourceValue>(
  value: TSourceValue,
  configuration: ConfigurationToken<OpentelemetryConfiguration>,
): OpentelemetryPolicy {
  const name = configuration.description;
  const candidate = value as RawOpentelemetryConfiguration | null | undefined;

  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw invalidConfigurationValue(name, [
      '"serviceName" must be a non-empty string, and the value must be an object',
    ]);
  }

  const issues = collectIssues(candidate);
  if (issues.length > 0) {
    throw invalidConfigurationValue(name, issues);
  }

  return Object.freeze({
    serviceName: candidate.serviceName as string,
    recordBody: normalizeRecordBody(candidate.recordBody),
    headersToSpanAttributes: normalizeHeaders(candidate.headersToSpanAttributes),
    spanUrlRedaction: normalizeRedaction(candidate.spanUrlRedaction),
  });
}

function startSdk(
  runtime: Readonly<OpentelemetryRuntimeOptions>,
  policy: OpentelemetryPolicy,
): void {
  if (sdkStarted) {
    return;
  }
  // A registration that declares no processor and no instrumentation has
  // nothing to export: starting an empty SDK would take the process-global
  // provider from a later registration that does.
  if ((runtime.spanProcessors?.length ?? 0) === 0 && runtime.instrumentations === undefined) {
    return;
  }
  sdkStarted = true;
  const sdk = new NodeSDK({
    ...(runtime as NodeSDKConfiguration),
    resource: resourceFromAttributes({ "service.name": policy.serviceName }),
  });
  sdk.start();
}

async function requestAttributes(
  request: Request,
  policy: OpentelemetryPolicy,
): Promise<Attributes> {
  const attributes: Attributes = {
    "http.request.method": request.method,
    "url.full": sanitizeUrl(request.url, policy.spanUrlRedaction),
  };
  for (const name of policy.headersToSpanAttributes.request) {
    const value = request.headers.get(name);
    if (value !== null) {
      attributes[`http.request.header.${name}`] = value;
    }
  }
  if (policy.recordBody.request) {
    try {
      attributes["http.request.body"] = await request.clone().text();
    } catch {
      attributes["http.request.body"] = "[unreadable]";
    }
  }
  return attributes;
}

function headersOf(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return headers;
}

function sanitizeUrl(url: string, redaction: OpentelemetryPolicy["spanUrlRedaction"]): string {
  if (redaction === false) {
    return url;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (redaction.stripCredentials) {
    parsed.username = "";
    parsed.password = "";
  }
  for (const name of redaction.sensitiveQueryParams) {
    if (parsed.searchParams.has(name)) {
      parsed.searchParams.set(name, "REDACTED");
    }
  }
  return parsed.href;
}

function recordFailure(span: Span, error: unknown): void {
  span.recordException(error instanceof Error ? error : String(error));
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: error instanceof Error ? error.message : undefined,
  });
}

interface RawOpentelemetryConfiguration {
  readonly serviceName?: unknown;
  readonly recordBody?: unknown;
  readonly headersToSpanAttributes?: unknown;
  readonly spanUrlRedaction?: unknown;
}

function collectIssues(value: RawOpentelemetryConfiguration): string[] {
  const issues: string[] = [];
  if (!isNonEmptyString(value.serviceName)) {
    issues.push('"serviceName" must be a non-empty string');
  }
  if (value.recordBody !== undefined && !isBodyRecording(value.recordBody)) {
    issues.push('"recordBody" must be a boolean or an object of booleans when it is present');
  }
  if (
    value.headersToSpanAttributes !== undefined &&
    !isHeaderCapture(value.headersToSpanAttributes)
  ) {
    issues.push(
      '"headersToSpanAttributes" must be an object whose "request" and "response" are lists of non-empty header names when it is present',
    );
  }
  if (value.spanUrlRedaction !== undefined && !isRedaction(value.spanUrlRedaction)) {
    issues.push(
      '"spanUrlRedaction" must be false or an object of redaction settings when it is present',
    );
  }
  const leaked = leakedCredentialHeader(value);
  if (leaked !== undefined) {
    issues.push(
      `"recordBody" cannot record the request while "headersToSpanAttributes.request" captures "${leaked}": both are recorded on the exported span`,
    );
  }
  return issues;
}

function leakedCredentialHeader(value: RawOpentelemetryConfiguration): string | undefined {
  if (!recordsRequest(value.recordBody)) {
    return undefined;
  }
  const captured = value.headersToSpanAttributes;
  if (!isRecord(captured) || !Array.isArray(captured.request)) {
    return undefined;
  }
  for (const entry of captured.request) {
    if (typeof entry !== "string") {
      continue;
    }
    const name = entry.toLowerCase();
    if (name === "*") {
      return "*";
    }
    if (credentialHeaders.includes(name)) {
      return entry;
    }
  }
  return undefined;
}

function recordsRequest(value: unknown): boolean {
  if (value === true) {
    return true;
  }
  return isRecord(value) && value.request === true;
}

function normalizeRecordBody(value: unknown): OpentelemetryPolicy["recordBody"] {
  if (value === undefined) {
    return Object.freeze({ request: false, response: false });
  }
  if (typeof value === "boolean") {
    return Object.freeze({ request: value, response: value });
  }
  const recording = value as { readonly request?: unknown; readonly response?: unknown };
  return Object.freeze({
    request: recording.request === true,
    response: recording.response === true,
  });
}

function normalizeHeaders(value: unknown): OpentelemetryPolicy["headersToSpanAttributes"] {
  if (!isRecord(value)) {
    return Object.freeze({ request: Object.freeze([]), response: Object.freeze([]) });
  }
  return Object.freeze({
    request: Object.freeze(
      Array.isArray(value.request) ? value.request.filter(isNonEmptyString) : [],
    ),
    response: Object.freeze(
      Array.isArray(value.response) ? value.response.filter(isNonEmptyString) : [],
    ),
  });
}

function normalizeRedaction(value: unknown): OpentelemetryPolicy["spanUrlRedaction"] {
  if (value === false) {
    return false;
  }
  if (!isRecord(value)) {
    return Object.freeze({ stripCredentials: true, sensitiveQueryParams: Object.freeze([]) });
  }
  return Object.freeze({
    stripCredentials: value.stripCredentials !== false,
    sensitiveQueryParams: Object.freeze(
      Array.isArray(value.sensitiveQueryParams)
        ? value.sensitiveQueryParams.filter(isNonEmptyString)
        : [],
    ),
  });
}

function isBodyRecording(value: unknown): boolean {
  if (typeof value === "boolean") {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }
  return isOptionalBoolean(value.request) && isOptionalBoolean(value.response);
}

function isHeaderCapture(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return isOptionalHeaderList(value.request) && isOptionalHeaderList(value.response);
}

function isRedaction(value: unknown): boolean {
  if (value === false) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }
  return (
    isOptionalBoolean(value.stripCredentials) && isOptionalHeaderList(value.sensitiveQueryParams)
  );
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function isOptionalHeaderList(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  return Array.isArray(value) && value.every((entry) => isNonEmptyString(entry));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function invalidConfigurationValue(name: string, issues: readonly string[]): AponiaError {
  return new AponiaError(
    "INVALID_CONFIGURATION_VALUE",
    `Configuration "${name}" is not a valid OpenTelemetry configuration.`,
    { configuration: name, issues: Object.freeze([...issues]) },
  );
}
