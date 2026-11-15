import { AponiaError, type ConfigurationToken } from "@aponiajs/common";
import type { ElysiaPlugin } from "@aponiajs/platform-elysia";
import { opentelemetry, type ElysiaOpenTelemetryOptions } from "@elysia/opentelemetry";
import type { OpentelemetryConfiguration } from "./opentelemetry-tracing.types.ts";

/**
 * The request header names that carry credentials.
 *
 * Capturing one of these on a span puts a live credential on data that leaves
 * the process, which is the fact the cross-field rule below is built on. The
 * list is the three names a proxy, a browser, or a client library actually uses
 * for a credential; it is deliberately short, because a longer list would start
 * guessing at application-specific names and a rule a reader cannot predict is
 * worse than the narrow rule it replaced.
 */
const credentialHeaders: readonly string[] = Object.freeze([
  "authorization",
  "proxy-authorization",
  "cookie",
]);

/**
 * The fields of the wrapped plugin's options this configuration owns.
 *
 * The rest of `ElysiaOpenTelemetryOptions` is passed to `register` as runtime
 * options, because a span processor, an instrumentation, a context manager, and
 * a predicate are code or live objects rather than data a schema can validate.
 *
 * @internal
 */
export type OpentelemetryPolicy = Required<
  Pick<
    ElysiaOpenTelemetryOptions,
    "serviceName" | "recordBody" | "headersToSpanAttributes" | "spanUrlRedaction"
  >
>;

/**
 * Builds the native OpenTelemetry plugin for one registration, once, while the
 * module mounts.
 *
 * The plugin is the wrapped `@elysia/opentelemetry` one. Nothing about it is
 * this package's except the options derived below: the root span, the per-stage
 * spans, the span attributes, the propagation, and the `NodeSDK` startup are the
 * plugin's own lowering of the policy this package validated.
 *
 * **The first call in a process starts the SDK and every later call is inert.**
 * The plugin constructs a `NodeSDK` and calls `start()` on it, and `start()` sets
 * the process-global tracer provider; the plugin asks `shouldStartNodeSDK` first
 * and skips the start when a provider already exists. A second registration
 * therefore mounts its Elysia plugin — which Elysia deduplicates by name — but
 * its `serviceName`, its span processors, and every other `NodeSDK` option never
 * take effect. Spans from every application in that process are exported through
 * the first registration's configuration. `application.close()` does not stop
 * that SDK either: it is not a provider, so no lifecycle hook reaches it. This
 * is measured in both lanes rather than inferred, and it is why one registration
 * per process is the supported shape.
 *
 * @internal
 */
export function buildOpentelemetryPlugin<TSourceValue>(
  runtime: Readonly<OpentelemetryRuntimeOptions>,
  value: TSourceValue,
  configuration: ConfigurationToken<OpentelemetryConfiguration>,
): ElysiaPlugin {
  return opentelemetry({ ...runtime, ...readOpentelemetryPolicy(value, configuration) });
}

/**
 * The plugin options, read from the value a configuration validated into.
 *
 * A guard rather than a cast, for the reason `readCorsPolicy` and
 * `readOpenApiInfo` are: a `defineConfiguration` transform is arbitrary
 * JavaScript, and a JavaScript caller can hand `provideConfiguration` a schema
 * that answers anything at all. What arrives therefore has to be checked before
 * it becomes the configuration of a process-global exporter — a `serviceName`
 * that is not a string is a resource attribute nothing enforces, and a
 * `headersToSpanAttributes` that is not a list of lists is read by the plugin as
 * whatever it happens to be.
 *
 * The refusal is this framework's: `INVALID_CONFIGURATION_VALUE`, with the
 * declaration's name and the same `issues` list a schema refusal carries. The
 * list is total — every field that fails is reported rather than the first — so
 * one boot names every field to fix.
 *
 * The returned options fill all four fields the configuration owns, including
 * the ones the wrapped plugin would default, so the plugin is a pure function of
 * the validated value.
 *
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

/**
 * The shape a value read into options is checked against.
 *
 * The fields the configuration owns are `unknown` on purpose: the whole point of
 * the guard is that nothing has established their type yet. Everything else a
 * caller may have set is carried through untouched, because a configuration that
 * answers with extra fields is not this package's to police.
 */
interface RawOpentelemetryConfiguration {
  readonly serviceName?: unknown;
  readonly recordBody?: unknown;
  readonly headersToSpanAttributes?: unknown;
  readonly spanUrlRedaction?: unknown;
}

interface RawBodyRecording {
  readonly request?: unknown;
  readonly response?: unknown;
}

/**
 * The runtime half of the module's options: everything the wrapped plugin
 * accepts that a configuration cannot carry.
 *
 * Derived from the plugin's own options type rather than restated, so a release
 * of the plugin that adds an option to `NodeSDK` or to the plugin's own surface
 * is accepted here without this package changing — and a field this
 * configuration owns is removed from it, so a caller cannot set `serviceName`
 * twice and get whichever one the spread order happened to favor.
 *
 * @internal
 */
export type OpentelemetryRuntimeOptions = Omit<
  ElysiaOpenTelemetryOptions,
  "serviceName" | "recordBody" | "headersToSpanAttributes" | "spanUrlRedaction"
>;

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

  // The one cross-field rule. Recording the request body and capturing a
  // credential-bearing request header both put data on the same exported span,
  // and together they put a live credential there. The plugin serves the pair
  // happily; refusing it here is the same move as refusing a wildcard origin
  // beside credentialed requests — the misconfiguration is refused at boot
  // rather than written to a backend a reader inspects later.
  const leaked = leakedCredentialHeader(value);
  if (leaked !== undefined) {
    issues.push(
      `"recordBody" cannot record the request while "headersToSpanAttributes.request" captures "${leaked}": both are recorded on the exported span`,
    );
  }

  return issues;
}

/**
 * The credential-bearing request header the value would capture, if it also
 * records request bodies.
 *
 * `"*"` is the whole header set, so it captures every credential name without
 * naming one, which is why it is reported as itself rather than expanded.
 */
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
    return false;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const recording = value as RawBodyRecording;
  return Object.freeze({
    request: typeof recording.request === "boolean" ? recording.request : false,
    response: typeof recording.response === "boolean" ? recording.response : false,
  });
}

function normalizeHeaders(value: unknown): OpentelemetryPolicy["headersToSpanAttributes"] {
  if (!isRecord(value)) {
    return Object.freeze({ request: [], response: [] });
  }

  const request = Array.isArray(value.request) ? value.request : [];
  const response = Array.isArray(value.response) ? value.response : [];

  // The outer object is frozen and the two lists are not, because the wrapped
  // plugin's own option type declares them as `string[]` and a `readonly
  // string[]` is not assignable to it. Every list here is built fresh for this
  // call, and nothing in this package keeps a reference to it.
  return Object.freeze({
    request: [...request] as string[],
    response: [...response] as string[],
  });
}

function normalizeRedaction(value: unknown): OpentelemetryPolicy["spanUrlRedaction"] {
  if (value === false) {
    return false;
  }

  if (!isRecord(value)) {
    return Object.freeze({ stripCredentials: true, sensitiveQueryParams: [] });
  }

  const sensitive = Array.isArray(value.sensitiveQueryParams) ? value.sensitiveQueryParams : [];

  return Object.freeze({
    stripCredentials: typeof value.stripCredentials === "boolean" ? value.stripCredentials : true,
    sensitiveQueryParams: [...sensitive] as string[],
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
  // `false` is a value the wrapped plugin accepts — it means "record URLs raw"
  // — and the README names it as the one setting this package cannot make safe.
  // Reading it as a wrong shape here would refuse a value the plugin documents.
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

/**
 * The refusal, in the shape a schema refusal already uses.
 *
 * The message names the declaration and states no field count, because what a
 * caller acts on is the `issues` list — the same one `provideConfiguration`
 * attaches when the schema itself is what refused.
 */
function invalidConfigurationValue(name: string, issues: readonly string[]): AponiaError {
  return new AponiaError(
    "INVALID_CONFIGURATION_VALUE",
    `Configuration "${name}" is not a valid OpenTelemetry configuration.`,
    { configuration: name, issues: Object.freeze([...issues]) },
  );
}
