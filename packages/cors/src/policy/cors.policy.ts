import { AponiaError, type ConfigurationToken } from "@aponiajs/common";
import {
  applyCors,
  corsPreflight,
  resolveCorsOptions,
  type HttpPolicy,
  type ResolvedCors,
} from "@aponiajs/common";
import type { CorsConfiguration } from "../interfaces/cors-policy.interface.ts";

/**
 * Builds the neutral CORS policy for one registration, once, while the module
 * mounts.
 *
 * The headers and the preflight answer come from the shared request pipeline,
 * so the same registration behaves the same on every platform.
 *
 * @internal
 */
export function buildCorsPolicy<TSourceValue>(
  value: TSourceValue,
  configuration: ConfigurationToken<CorsConfiguration>,
): HttpPolicy {
  const cors = readCorsPolicy(value, configuration);
  const preflightEnabled = (value as { readonly preflight?: unknown } | null)?.preflight !== false;
  const methodsUnspecified =
    (value as { readonly methods?: unknown } | null)?.methods === undefined;
  return {
    name: "cors",
    onRequest: (request) => {
      if (!preflightEnabled) {
        return undefined;
      }
      // An omitted method list echoes the method the preflight asked about, which
      // is the policy the wrapped plugin stated for an unconfigured list.
      const requested = request.headers.get("access-control-request-method");
      const effective =
        methodsUnspecified && requested !== null
          ? Object.freeze({ ...cors, methods: Object.freeze([requested]) })
          : cors;
      return corsPreflight(request, {
        cors: effective,
        securityHeaders: undefined,
        etag: undefined,
        compression: undefined,
      });
    },
    // A preflight already carries its answer; adding the exposed-header list to a
    // bodyless `204` would state a response header the browser has nothing to read.
    onResponse: (request, response) =>
      request.method === "OPTIONS" ? response : applyCors(request, response, cors),
  };
}

/**
 * The policy, read from the value a configuration validated into.
 *
 * A guard rather than a cast, for the reason `readOpenApiInfo` and
 * `readCronJobs` are: a `defineConfiguration` transform is arbitrary
 * JavaScript, and a JavaScript caller can hand `provideConfiguration` a schema
 * that answers anything at all. What arrives therefore has to be checked before
 * it becomes a policy a browser will honor — a list of origins that is not a
 * list of strings is a policy nothing enforces.
 *
 * The refusal is this framework's: `INVALID_CONFIGURATION_VALUE`, with the
 * declaration's name and the same `issues` list a schema refusal carries. The
 * list is total — every field that fails is reported rather than the first — so
 * one boot names every field to fix.
 *
 * `credentials` is the one default this package changes rather than inherits:
 * the wrapped plugin defaults it to `true`, and this package defaults it to
 * `false`.
 *
 * @internal
 */
export function readCorsPolicy<TSourceValue>(
  value: TSourceValue,
  configuration: ConfigurationToken<CorsConfiguration>,
): ResolvedCors {
  const name = configuration.description;
  const candidate = value as RawCorsConfiguration | null | undefined;

  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw invalidConfigurationValue(name, [
      '"origins" must be a non-empty array of non-empty origin strings',
    ]);
  }

  const issues = readCorsIssues(candidate);

  if (issues.length > 0) {
    throw invalidConfigurationValue(name, issues);
  }

  const checked = candidate as CorsConfiguration;
  const resolved = resolveCorsOptions({
    origin: [...checked.origins],
    ...(checked.methods === undefined ? {} : { methods: [...checked.methods] }),
    ...(checked.allowedHeaders === undefined
      ? {}
      : { allowedHeaders: [...checked.allowedHeaders] }),
    ...(checked.exposeHeaders === undefined ? {} : { exposedHeaders: [...checked.exposeHeaders] }),
    credentials: checked.credentials ?? false,
    maxAge: checked.maxAge ?? 5,
  });
  if (resolved === undefined) {
    throw invalidConfigurationValue(name, ['"origins" must state at least one origin']);
  }
  return resolved;
}

/**
 * The shape a JavaScript caller can produce in place of what
 * `CorsConfiguration` promises.
 */
interface RawCorsConfiguration {
  readonly origins?: unknown;
  readonly methods?: unknown;
  readonly allowedHeaders?: unknown;
  readonly exposeHeaders?: unknown;
  readonly credentials?: unknown;
  readonly maxAge?: unknown;
  readonly preflight?: unknown;
}

function readCorsIssues(value: RawCorsConfiguration): string[] {
  const issues: string[] = [];

  if (!isNonEmptyStringArray(value.origins)) {
    issues.push('"origins" must be a non-empty array of non-empty origin strings');
  }

  if (value.methods !== undefined && !isNonEmptyStringArray(value.methods)) {
    issues.push('"methods" must be a non-empty array of non-empty method strings');
  }

  if (value.allowedHeaders !== undefined && !isNonEmptyStringArray(value.allowedHeaders)) {
    issues.push('"allowedHeaders" must be a non-empty array of non-empty header names');
  }

  if (value.exposeHeaders !== undefined && !isNonEmptyStringArray(value.exposeHeaders)) {
    issues.push('"exposeHeaders" must be a non-empty array of non-empty header names');
  }

  if (value.credentials !== undefined && typeof value.credentials !== "boolean") {
    issues.push('"credentials" must be a boolean when it is present');
  }

  if (value.maxAge !== undefined && !isNonNegativeNumber(value.maxAge)) {
    issues.push('"maxAge" must be a non-negative number when it is present');
  }

  if (value.preflight !== undefined && typeof value.preflight !== "boolean") {
    issues.push('"preflight" must be a boolean when it is present');
  }

  // The one cross-field rule. A browser rejects `Access-Control-Allow-Origin: *`
  // beside `Access-Control-Allow-Credentials: true`, so the pair is not a policy
  // a browser honors: it is refused here rather than served as a response the
  // browser then blocks, which a reader would debug at the client.
  if (
    isNonEmptyStringArray(value.origins) &&
    value.origins.includes("*") &&
    value.credentials === true
  ) {
    issues.push(
      '"credentials" cannot be true while "origins" contains "*": a browser rejects that response',
    );
  }

  return issues;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every((entry) => isNonEmptyString(entry))
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
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
    `Configuration "${name}" is not a valid CORS configuration.`,
    { configuration: name, issues: Object.freeze([...issues]) },
  );
}
