import { AponiaError, type ConfigurationToken } from "@aponiajs/common";
import type { ElysiaPlugin } from "@aponiajs/platform-elysia";
import { cors, type CORSConfig } from "@elysia/cors";
import type { CorsConfiguration } from "./cors-policy.types.ts";

/**
 * Builds the native CORS plugin for one registration, once, while the module
 * mounts.
 *
 * The plugin is the wrapped `@elysia/cors` one, configured from the value the
 * container resolved. Nothing about it is this package's except the options
 * derived below: the headers, the preflight handling, and the header values are
 * the plugin's own lowering of the policy this package validated.
 *
 * @internal
 */
export function buildCorsPlugin<TSourceValue>(
  value: TSourceValue,
  configuration: ConfigurationToken<CorsConfiguration>,
): ElysiaPlugin {
  return cors(readCorsPolicy(value, configuration));
}

/**
 * The plugin options, read from the value a configuration validated into.
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
 * The returned options fill every field the wrapped plugin reads, including the
 * ones it would default. That makes the plugin a pure function of the validated
 * value, and it makes the plugin's Elysia identity — its `name` and `seed`,
 * which the plugin derives from the options object — a function of the value
 * too, so two registrations answer to the same policy exactly when their
 * configurations are equal.
 *
 * `credentials` is the one default this adapter changes rather than inherits:
 * the plugin defaults it to `true`, and this package defaults it to `false`.
 *
 * @internal
 */
export function readCorsPolicy<TSourceValue>(
  value: TSourceValue,
  configuration: ConfigurationToken<CorsConfiguration>,
): CORSConfig {
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

  // The guard above is what makes these fields the declared types; this states
  // what it proved, the way the OpenAPI and cron guards state theirs.
  const checked = candidate as CorsConfiguration;

  // Every field the plugin reads is stated, including the ones it would
  // default, so the options object — and therefore the plugin's own identity —
  // is a pure function of the validated value.
  const policy: CORSConfig = {
    origin: [...checked.origins],
    methods: checked.methods === undefined ? true : [...checked.methods],
    allowedHeaders: checked.allowedHeaders === undefined ? true : [...checked.allowedHeaders],
    exposeHeaders: checked.exposeHeaders === undefined ? true : [...checked.exposeHeaders],
    credentials: checked.credentials ?? false,
    maxAge: checked.maxAge ?? 5,
    preflight: checked.preflight ?? true,
  };

  return Object.freeze(policy);
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
