import { AponiaError, type ConfigurationToken } from "@aponiajs/common";
import { createSchema, createYoga } from "graphql-yoga";
import type { HttpPolicy } from "@aponiajs/platform-core";
import type {
  GraphQLConfiguration,
  GraphQLSchemaOptions,
} from "../interfaces/graphql-endpoint.interface.ts";

/**
 * Reads the mount path out of the value a configuration validated into.
 *
 * A guard rather than a cast: a `defineConfiguration` transform is arbitrary
 * JavaScript, so a path the endpoint cannot serve is refused before yoga is
 * built.
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

  return (candidate as GraphQLConfiguration).path;
}

/**
 * Builds the neutral GraphQL endpoint one registration contributes.
 *
 * The handler is `graphql-yoga`'s own fetch handler, so the same registration
 * answers the same query on every platform: the policy matches the declared
 * path and delegates the request, and yoga owns the schema, the resolvers, the
 * error shapes, and GraphiQL.
 *
 * @internal
 */
export function buildGraphQLPolicy(path: string, options: GraphQLSchemaOptions): HttpPolicy {
  const { typeDefs, resolvers, ...rest } = options as GraphQLSchemaOptions & {
    readonly typeDefs?: unknown;
    readonly resolvers?: unknown;
  };
  const schema =
    typeDefs === undefined
      ? (rest as { readonly schema?: unknown }).schema
      : createSchema({
          typeDefs: typeDefs as never,
          resolvers: resolvers as never,
        });
  const yoga = createYoga({
    ...rest,
    schema: schema as never,
    graphqlEndpoint: path,
  });
  return {
    name: "graphql",
    onRequest: (request) => {
      let pathname: string;
      try {
        pathname = new URL(request.url).pathname;
      } catch {
        return undefined;
      }
      if (pathname !== path) {
        return undefined;
      }
      return yoga.fetch(request);
    },
  };
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
