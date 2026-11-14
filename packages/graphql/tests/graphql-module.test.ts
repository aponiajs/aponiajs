import { expect, test } from "bun:test";
import {
  AponiaError,
  Controller,
  Get,
  Injectable,
  Module,
  UseGuards,
  defineConfiguration,
  type AponiaErrorCode,
  type CanActivate,
} from "@aponiajs/common";
import {
  AponiaFactory,
  PluginModule,
  httpErrors,
  inspectAponiaApplication,
  type AponiaApplication,
} from "@aponiajs/platform-elysia";
import { yoga } from "@elysia/graphql-yoga";
import { GraphQLObjectType, GraphQLSchema, GraphQLString } from "graphql";
import { z } from "zod";
import { GraphQLModule } from "../src/index.ts";
import type { GraphQLConfiguration } from "../src/index.ts";

function codeOf(error: unknown): AponiaErrorCode | undefined {
  return error instanceof AponiaError ? error.code : undefined;
}

/**
 * The path declaration of the shape an environment supplies: one variable for
 * the endpoint, with the default that makes `source: {}` a complete
 * declaration.
 *
 * Every case names its configuration, so a refusal names the declaration the
 * case wrote rather than an anonymous one. The value carries one field, which
 * is the whole contract this package adds over the raw plugin: a mount path
 * stated once, that the module sets as both the plugin's `path` and yoga's
 * `graphqlEndpoint`.
 */
function pathOf(name: string) {
  return defineConfiguration(
    z
      .object({ GRAPHQL_PATH: z.string().min(1).default("/graphql") })
      .transform(({ GRAPHQL_PATH }) => ({ path: GRAPHQL_PATH }) satisfies GraphQLConfiguration),
    `graphql.${name}`,
  );
}

/** The same declaration with no defaults, so an empty source is what a schema refuses. */
function requiredPathOf(name: string) {
  return defineConfiguration(
    z
      .object({ GRAPHQL_PATH: z.string().min(1) })
      .transform(({ GRAPHQL_PATH }) => ({ path: GRAPHQL_PATH }) satisfies GraphQLConfiguration),
    `graphql.${name}`,
  );
}

const typeDefs = `type Query { hello: String }`;

const resolvers = { Query: { hello: (): string => "world" } };

/** The GraphQL request body one case posts, so the shape is stated once. */
function queryBody(query: string): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  };
}

@Controller("ping")
class PingController {
  @Get("/")
  ping(): string {
    return "pong";
  }
}

@Injectable()
class GreetingService {
  greet(): string {
    return "from-service";
  }
}

/** A provider the GraphQL module imports, so a resolver can close over it. */
@Module({ providers: [GreetingService], exports: [GreetingService] })
class GreetingModule {}

test("answers a query at the default path, with a resolver served by an injected service", async (): Promise<void> => {
  const GraphQLConfig = pathOf("default");

  @Module({
    imports: [
      GreetingModule,
      GraphQLModule.register({
        configuration: GraphQLConfig,
        source: {},
        imports: [GreetingModule],
        inject: [GreetingService],
        useFactory: (greetings: GreetingService) => ({
          typeDefs,
          resolvers: { Query: { hello: (): string => greetings.greet() } },
        }),
      }),
    ],
    controllers: [PingController],
  })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });

  try {
    const response = await application.handle(
      new Request("http://localhost/graphql?query={hello}"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { hello: "from-service" } });

    const posted = await application.handle(
      new Request("http://localhost/graphql", queryBody("{hello}")),
    );

    expect(posted.status).toBe(200);
    expect(await posted.json()).toEqual({ data: { hello: "from-service" } });

    // A controller beside the endpoint keeps answering: the registration mounts
    // through `use()`, outside the compiled route table, rather than replacing
    // it.
    const ping = await application.handle(new Request("http://localhost/ping"));

    expect(ping.status).toBe(200);
    expect(await ping.text()).toBe("pong");

    // The module provides the configuration it consumes and exports it, so the
    // application reads back the same validated value the endpoint was built
    // from.
    expect(application.get(GraphQLConfig)).toEqual({ path: "/graphql" });
  } finally {
    await application.close();
  }
});

test("answers a non-default path, where the raw plugin with only path set returns 404", async (): Promise<void> => {
  const GraphQLConfig = pathOf("custom");

  @Module({
    imports: [
      GraphQLModule.register({
        configuration: GraphQLConfig,
        source: { GRAPHQL_PATH: "/gql" },
        useFactory: () => ({ typeDefs, resolvers }),
      }),
    ],
  })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });

  try {
    // The registration sets both the plugin's `path` and yoga's
    // `graphqlEndpoint` from the one declared value, so the declared path is
    // the one that answers.
    expect(application.getNativeApplication().routes.map((route) => route.path)).toContain("/gql");

    const response = await application.handle(new Request("http://localhost/gql?query={hello}"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { hello: "world" } });

    const posted = await application.handle(
      new Request("http://localhost/gql", queryBody("{hello}")),
    );

    expect(posted.status).toBe(200);
    expect(await posted.json()).toEqual({ data: { hello: "world" } });

    // The default path is not mounted beside the declared one.
    expect(
      (await application.handle(new Request("http://localhost/graphql?query={hello}"))).status,
    ).toBe(404);

    // The footgun this package closes, measured against the raw plugin: setting
    // only `path` moves the Elysia route while yoga still answers for the
    // default endpoint, so every request at the declared path is a 404.
    const raw = PluginModule.register(yoga({ typeDefs, resolvers, path: "/gql" }) as never, {
      key: "graphql-raw-path-only",
    });

    @Module({ imports: [raw] })
    class RawModule {}

    const rawApplication: AponiaApplication = await AponiaFactory.create(RawModule, {
      logger: false,
    });

    try {
      const control = await rawApplication.handle(
        new Request("http://localhost/gql?query={hello}"),
      );

      expect(control.status).toBe(404);
    } finally {
      await rawApplication.close();
    }
  } finally {
    await application.close();
  }
});

test("serves a prebuilt schema the factory returns unchanged", async (): Promise<void> => {
  const GraphQLConfig = pathOf("schema");

  const schema = new GraphQLSchema({
    query: new GraphQLObjectType({
      name: "Query",
      fields: { hello: { type: GraphQLString, resolve: (): string => "prebuilt" } },
    }),
  });

  @Module({
    imports: [
      GraphQLModule.register({
        configuration: GraphQLConfig,
        source: {},
        useFactory: () => ({ schema }),
      }),
    ],
  })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });

  try {
    const response = await application.handle(
      new Request("http://localhost/graphql?query={hello}"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { hello: "prebuilt" } });
  } finally {
    await application.close();
  }
});

test("keeps a guard off the endpoint while the guard still refuses its own controller", async (): Promise<void> => {
  @Injectable()
  class RefusingGuard implements CanActivate {
    canActivate(): boolean {
      throw httpErrors.forbidden("A guard refused this request.");
    }
  }

  @Controller("guarded")
  class GuardedController {
    @Get("/open")
    @UseGuards(RefusingGuard)
    open(): string {
      return "never";
    }
  }

  const GraphQLConfig = pathOf("guarded");

  @Module({
    imports: [
      GraphQLModule.register({
        configuration: GraphQLConfig,
        source: {},
        useFactory: () => ({ typeDefs, resolvers }),
      }),
    ],
    controllers: [GuardedController],
    providers: [RefusingGuard],
  })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });

  try {
    // The endpoint mounts through `use()`, outside the compiled route table,
    // so no guard, interceptor, or exception filter the platform compiles for
    // routes reaches it: the query answers while the guarded route refuses.
    const endpoint = await application.handle(
      new Request("http://localhost/graphql?query={hello}"),
    );

    expect(endpoint.status).toBe(200);
    expect(await endpoint.json()).toEqual({ data: { hello: "world" } });

    const refused = await application.handle(new Request("http://localhost/guarded/open"));

    expect(refused.status).toBe(403);
    expect(refused.headers.get("content-type")).toContain("application/problem+json");
  } finally {
    await application.close();
  }
});

test("answers a resolver failure with a GraphQL error rather than a thrown message", async (): Promise<void> => {
  const GraphQLConfig = pathOf("failure");

  @Module({
    imports: [
      GraphQLModule.register({
        configuration: GraphQLConfig,
        source: {},
        useFactory: () => ({
          typeDefs,
          resolvers: {
            Query: {
              hello: (): string => {
                throw new Error("a resolver failed on purpose");
              },
            },
          },
        }),
      }),
    ],
  })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });

  try {
    const response = await application.handle(
      new Request("http://localhost/graphql", queryBody("{hello}")),
    );

    expect(response.status).toBe(200);

    // Probed, not guessed: yoga masks the thrown message, reports the failure
    // under the field that failed, and answers 200 with partial data.
    const body = (await response.json()) as {
      readonly errors?: readonly { readonly message?: unknown; readonly path?: unknown }[];
      readonly data?: unknown;
    };

    expect(body.data).toEqual({ hello: null });
    expect(body.errors).toHaveLength(1);
    expect(body.errors?.[0]?.path).toEqual(["hello"]);
    expect(JSON.stringify(body)).not.toContain("a resolver failed on purpose");
  } finally {
    await application.close();
  }
});

test("refuses a boot whose configuration the schema rejects", async (): Promise<void> => {
  const GraphQLConfig = requiredPathOf("required");

  @Module({
    imports: [
      GraphQLModule.register({
        configuration: GraphQLConfig,
        // `GRAPHQL_PATH` has no default, so the source is what the schema refuses.
        source: {},
        useFactory: () => ({ typeDefs, resolvers }),
      }),
    ],
  })
  class AppModule {}

  let failure: unknown;

  try {
    await AponiaFactory.create(AppModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(AponiaError);
  expect(codeOf(failure)).toBe("INVALID_CONFIGURATION_VALUE");
  expect((failure as AponiaError).details).toMatchObject({ configuration: "graphql.required" });
  expect((failure as AponiaError).details.issues).toHaveLength(1);
});

test("refuses a value only a runtime could produce, naming every field at once", async (): Promise<void> => {
  const GraphQLConfig = defineConfiguration(
    z.object({}).transform(() => ({ path: 42 }) as unknown as GraphQLConfiguration),
    "graphql.malformed",
  );

  @Module({
    imports: [
      GraphQLModule.register({
        configuration: GraphQLConfig,
        source: {},
        useFactory: () => ({ typeDefs, resolvers }),
      }),
    ],
  })
  class AppModule {}

  let failure: unknown;

  try {
    await AponiaFactory.create(AppModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(AponiaError);
  expect(codeOf(failure)).toBe("INVALID_CONFIGURATION_VALUE");
  expect((failure as AponiaError).details).toMatchObject({ configuration: "graphql.malformed" });

  // The mount has one field, so the total list is the one issue the guard
  // states; the shape is what matters — `{ configuration, issues }` — because
  // a caller reads one contract whichever half refused.
  expect((failure as AponiaError).details.issues).toEqual([
    '"path" must be a non-empty string beginning with "/"',
  ]);
});

test("refuses a value that states no endpoint at all", async (): Promise<void> => {
  const GraphQLConfig = defineConfiguration(
    z.object({}).transform(() => null as unknown as GraphQLConfiguration),
    "graphql.noendpoint",
  );

  @Module({
    imports: [
      GraphQLModule.register({
        configuration: GraphQLConfig,
        source: {},
        useFactory: () => ({ typeDefs, resolvers }),
      }),
    ],
  })
  class AppModule {}

  let failure: unknown;

  try {
    await AponiaFactory.create(AppModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  expect(codeOf(failure)).toBe("INVALID_CONFIGURATION_VALUE");
  expect((failure as AponiaError).details.issues).toEqual([
    '"path" must be a non-empty string beginning with "/"',
  ]);
});

test("refuses two registrations that share a key", async (): Promise<void> => {
  const GraphQLConfig = pathOf("shared-key");
  const options = {
    configuration: GraphQLConfig,
    source: {},
    useFactory: () => ({ typeDefs, resolvers }),
  } as const;

  const first = GraphQLModule.register({ ...options });
  const second = GraphQLModule.register({ ...options });

  @Module({ imports: [first, second] })
  class AppModule {}

  let failure: unknown;

  try {
    await AponiaFactory.create(AppModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  // The key is the module's identity, so two registrations that share one are
  // not two modules: the graph refuses the boot rather than mounting one and
  // dropping the other.
  expect(codeOf(failure)).toBe("DUPLICATE_MODULE");
  expect((failure as AponiaError).details).toMatchObject({ module: "PluginModule[graphql]" });
});

test("mounts twice when two registrations use distinct keys, and reads back ambiguously", async (): Promise<void> => {
  const SharedConfig = pathOf("shared-token");

  const first = GraphQLModule.register({
    configuration: SharedConfig,
    source: {},
    key: "graphql-first",
    useFactory: () => ({ typeDefs, resolvers }),
  });
  const second = GraphQLModule.register({
    configuration: SharedConfig,
    source: {},
    key: "graphql-second",
    useFactory: () => ({ typeDefs, resolvers }),
  });

  @Module({ imports: [first, second] })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });

  try {
    // The wrapped plugin's factory is unnamed, so Elysia does not deduplicate
    // the two mounts the way it does for a named plugin: two registrations
    // that resolve equal options mount twice — four routes, two per plugin —
    // where cors or openapi would mount once.
    expect(
      application.getNativeApplication().routes.filter((route) => route.path === "/graphql"),
    ).toHaveLength(4);

    // The two nodes are in the graph, which is the other half of the claim and
    // the half a route count cannot show: the boot got past the duplicate
    // refusal because the keys differ, so this is two declarations producing
    // two native mounts rather than one declaration.
    const moduleIds = inspectAponiaApplication(AppModule).modules.map((module) => module.id);

    expect(moduleIds.filter((id) => id.startsWith("PluginModule[graphql-")).toSorted()).toEqual([
      "PluginModule[graphql-first]",
      "PluginModule[graphql-second]",
    ]);

    const response = await application.handle(
      new Request("http://localhost/graphql?query={hello}"),
    );

    expect(response.status).toBe(200);

    // Both modules export the same configuration token, so reading it back is
    // the ambiguity the graph names rather than a winner it picks.
    let failure: unknown;

    try {
      application.get(SharedConfig);
    } catch (error) {
      failure = error;
    }

    expect(codeOf(failure)).toBe("AMBIGUOUS_PROVIDER");
  } finally {
    await application.close();
  }
});

test("lets a controller at the same method and path shadow the endpoint without a duplicate", async (): Promise<void> => {
  const GraphQLConfig = pathOf("shadowed");

  @Controller("graphql")
  class ShadowController {
    @Get("/")
    shadow(): string {
      return "controller-wins";
    }
  }

  @Module({
    imports: [
      GraphQLModule.register({
        configuration: GraphQLConfig,
        source: {},
        useFactory: () => ({ typeDefs, resolvers }),
      }),
    ],
    controllers: [ShadowController],
  })
  class AppModule {}

  // `yoga()` returns a synchronous function, so the plugin's routes are
  // already in the table when the controller pass registers the same
  // `(method, path)`. No `DUPLICATE_ROUTE` is raised: the boot succeeds and
  // the controller answers.
  const application = await AponiaFactory.create(AppModule, { logger: false });

  try {
    expect(
      application.getNativeApplication().routes.filter((route) => route.path === "/graphql"),
    ).toHaveLength(3);

    const response = await application.handle(
      new Request("http://localhost/graphql?query={hello}"),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("controller-wins");
  } finally {
    await application.close();
  }
});

test("exports only the module from its barrel", async (): Promise<void> => {
  const barrel = (await import("../src/index.ts")) as Record<string, unknown>;

  expect(Object.keys(barrel).toSorted()).toEqual(["GraphQLModule"]);
});
