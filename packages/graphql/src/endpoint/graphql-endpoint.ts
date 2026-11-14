import { AponiaError, type ConfigurationToken } from "@aponiajs/common";
import type { ElysiaPlugin } from "@aponiajs/platform-elysia";
import { yoga } from "@elysia/graphql-yoga";
import type { GraphQLConfiguration, GraphQLSchemaOptions } from "./graphql-endpoint.types.ts";

/**
 * Reads the mount path out of the value a configuration validated into.
 *
 * A guard rather than a cast, for the reason `readCorsPolicy` and
 * `readOpenApiInfo` are: a `defineConfiguration` transform is arbitrary
 * JavaScript, and a JavaScript caller can hand `provideConfiguration` a schema
 * that answers anything at all. A path the plugin cannot mount is not an
 * endpoint, so it is refused before the plugin is built.
 *
 * The refusal is this framework's: `INVALID_CONFIGURATION_VALUE`, with the
 * declaration's name and the same `issues` list a schema refusal carries.
 *
 * @internal
 */
export function readGraphQLMount<TSourceValue>(
  value: TSourceValue,
  configuration: ConfigurationToken<GraphQLConfiguration>,
): string {
  const name = configuration.description;
  const candidate = value as RawGraphQLConfiguration | null | undefined;

  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw invalidConfigurationValue(name, ['"path" must be a non-empty string beginning with "/"']);
  }

  const issues: string[] = [];

  if (
    typeof candidate.path !== "string" ||
    candidate.path.trim().length === 0 ||
    !candidate.path.startsWith("/")
  ) {
    issues.push('"path" must be a non-empty string beginning with "/"');
  }

  if (issues.length > 0) {
    throw invalidConfigurationValue(name, issues);
  }

  const path = (candidate as GraphQLConfiguration).path;

  return path;
}

/**
 * Builds the native GraphQL plugin for one registration, while the module
 * mounts.
 *
 * The plugin is the wrapped `@elysia/graphql-yoga` one. This package's whole
 * contribution to it is the pair of fields below: the plugin's own `path` and
 * yoga's `graphqlEndpoint` are both set from the one declared value, which is
 * what makes a non-default endpoint answer instead of returning `404`. The
 * schema, the resolvers, and every other yoga option come from the application
 * unchanged.
 *
 * @internal
 */
export function buildGraphQLPlugin(path: string, options: GraphQLSchemaOptions): ElysiaPlugin {
  return yoga({ ...options, path, graphqlEndpoint: path });
}

/**
 * The shape a JavaScript caller can produce in place of what
 * `GraphQLConfiguration` promises.
 */
interface RawGraphQLConfiguration {
  readonly path?: unknown;
}

function invalidConfigurationValue(name: string, issues: readonly string[]): AponiaError {
  return new AponiaError(
    "INVALID_CONFIGURATION_VALUE",
    `Configuration "${name}" is not a valid GraphQL configuration.`,
    { configuration: name, issues: Object.freeze([...issues]) },
  );
}
