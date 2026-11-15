import { AponiaError, type ConfigurationToken } from "@aponiajs/common";
import type { ElysiaPlugin } from "@aponiajs/platform-elysia";
import { openapi } from "@elysia/openapi";
import type { OpenApiConfiguration, OpenApiInfo } from "./openapi-document.types.ts";

/**
 * The methods the served document omits, whatever the application mounts.
 *
 * `options` is the wrapped plugin's own default and stays: an `OPTIONS` route
 * is Elysia's, not a declaration an application made. `ws` is this package's
 * addition, and it is a correctness fix rather than a preference. A WebSocket
 * gateway mounted through the platform reaches the native route table as a
 * route whose method really is `ws`, and the plugin turns it into
 * `{ "/events": { "ws": { … } } }`. `ws` is not one of OpenAPI's path-item
 * fields, so that object is a document no validator accepts — a route the
 * platform mounted, described in a vocabulary the specification does not have.
 * Excluding it is the honest answer: this package documents HTTP operations,
 * and a gateway's message protocol is not one.
 */
const excludedMethods = Object.freeze(["options", "ws"]);

/**
 * The options one registration hands the plugin builder.
 *
 * @internal
 */
interface OpenApiPluginOptions {
  readonly configuration: ConfigurationToken<OpenApiConfiguration>;
  readonly path: string;
}

/**
 * Builds the native plugin for one registration, once, while the module mounts.
 *
 * The plugin is the wrapped one, configured from the value the container
 * resolved: the document's `info` is the validated configuration's, the mount
 * path is the registration's, and nothing else about it is this package's.
 * Everything a reader sees beyond that — the paths, the operations, the
 * schemas, the Scalar UI the plugin serves at the mount path — is
 * `@elysia/openapi`'s own lowering of the route table the platform compiled.
 *
 * @internal
 */
export function createOpenApiPlugin<TSourceValue>(
  value: TSourceValue,
  options: OpenApiPluginOptions,
): ElysiaPlugin {
  return openapi({
    path: options.path,
    documentation: { info: readOpenApiInfo(value, options.configuration) },
    exclude: { methods: [...excludedMethods] },
  });
}

/**
 * The document metadata, read from the value a configuration validated into.
 *
 * A guard rather than a cast, for the reason `readCronJobs` is one: a
 * `defineConfiguration` transform is arbitrary JavaScript, and a JavaScript
 * caller can hand `provideConfiguration` a schema that answers anything at all.
 * What arrives therefore has to be checked before it becomes the `info` of a
 * document a client generator will trust — a document titled `undefined` is one
 * a generator will happily write a client from.
 *
 * The refusal is this framework's: `INVALID_CONFIGURATION_VALUE`, with the
 * declaration's name and the same `issues` list a schema refusal carries, so a
 * caller reads one shape whichever half of the validation refused. The list is
 * total — every field that fails is reported rather than the first — so one
 * boot names every field to fix.
 *
 * `description` is reported as present-but-`undefined` rather than omitted when
 * the configuration states none, because the wrapped plugin fills an absent
 * `description` with its own placeholder. An own property whose value is
 * `undefined` overrides that default, so what the document ends up saying about
 * the application is what the application declared.
 *
 * @internal
 */
export function readOpenApiInfo<TSourceValue>(
  value: TSourceValue,
  configuration: ConfigurationToken<OpenApiConfiguration>,
): OpenApiInfo {
  const name = configuration.description;
  const info = (value as { readonly info?: unknown } | null | undefined)?.info;

  if (typeof info !== "object" || info === null) {
    throw invalidConfigurationValue(name, [
      '"info" must be an object stating the document title and version',
    ]);
  }

  const issues = readInfoIssues(info as RawInfo);

  if (issues.length > 0) {
    throw invalidConfigurationValue(name, issues);
  }

  // The guard above is what makes these strings; this states what it proved, the
  // way the scheduler's guard states its job list after checking it.
  const checked = info as RawInfo;

  return Object.freeze({
    title: checked.title as string,
    version: checked.version as string,
    description: typeof checked.description === "string" ? checked.description : undefined,
  });
}

/**
 * The shape a JavaScript caller can produce in place of what
 * `OpenApiConfiguration` promises.
 */
interface RawInfo {
  readonly title?: unknown;
  readonly version?: unknown;
  readonly description?: unknown;
}

function readInfoIssues(info: RawInfo): string[] {
  const issues: string[] = [];

  if (!isNonEmptyString(info.title)) {
    issues.push('"info.title" must be a non-empty string');
  }

  if (!isNonEmptyString(info.version)) {
    issues.push('"info.version" must be a non-empty string');
  }

  if (info.description !== undefined && typeof info.description !== "string") {
    issues.push('"info.description" must be a string when it is present');
  }

  return issues;
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
    `Configuration "${name}" is not a valid OpenAPI document configuration.`,
    { configuration: name, issues: Object.freeze([...issues]) },
  );
}
