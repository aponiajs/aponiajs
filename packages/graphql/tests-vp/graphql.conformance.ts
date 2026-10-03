import { Module, defineConfiguration, type ConfigurationToken } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import type { DynamicModule } from "@aponiajs/common";
import { z } from "zod";
import { GraphQLModule } from "../src/index.ts";
import type {
  GraphQLConfiguration,
  GraphQLModuleOptions,
  GraphQLSchemaOptions,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;

/**
 * The compile-time half of this lane: the contract a consumer writes against.
 *
 * The split between the configuration and the schema options is the whole of
 * this package's adapter claim, so it is what is pinned. `keyof
 * GraphQLModuleOptions` lists every field a registration accepts — the
 * configuration that carries the path, the `imports` and `inject` the factory
 * resolves, the `useFactory` that builds the schema from them, and the `source`
 * and `key` the other plugin packages carry. `keyof GraphQLConfiguration` is
 * the one field the endpoint is declared from, because the wrapped plugin's
 * own `path` and yoga's `graphqlEndpoint` have no field here: the module sets
 * both from this one value, which is what makes a non-default endpoint answer.
 *
 * `GraphQLSchemaOptions` is the wrapped plugin's own config with those two
 * fields removed — derived from the dependency rather than restated, so a
 * release that reshapes it fails `bun run check` instead of shipping an
 * endpoint the plugin refuses.
 */
type GraphQLContractAssertions = [
  Expect<
    Equals<
      keyof GraphQLModuleOptions,
      "configuration" | "imports" | "inject" | "useFactory" | "source" | "key"
    >
  >,
  Expect<Equals<GraphQLModuleOptions["configuration"], ConfigurationToken<GraphQLConfiguration>>>,
  Expect<Equals<GraphQLModuleOptions["source"], Readonly<Record<string, unknown>> | undefined>>,
  Expect<Equals<GraphQLModuleOptions["key"], string | undefined>>,
  Expect<Equals<keyof GraphQLConfiguration, "path">>,
  Expect<Equals<GraphQLConfiguration["path"], string>>,
  Expect<Equals<Extract<keyof GraphQLSchemaOptions, "path">, never>>,
  Expect<Equals<Extract<keyof GraphQLSchemaOptions, "graphqlEndpoint">, never>>,
  Expect<Equals<Extract<keyof GraphQLSchemaOptions, "typeDefs">, "typeDefs">>,
  Expect<Equals<ReturnType<typeof GraphQLModule.register>, DynamicModule>>,
];

/** The barrel as a consumer's `import` sees it. */
type GraphQLBarrel = typeof import("../src/index.ts");

/**
 * The exports this package must keep, named so a renamed or dropped one fails
 * this lane rather than an application.
 *
 * Only the value export is named here: `keyof typeof import(...)` holds the
 * values a consumer can import, and the three contracts are type-only exports. A
 * renamed or dropped type fails this file instead — its own `import type` at the
 * top is what would stop compiling.
 */
type GraphQLBarrelAssertions = [
  Expect<Equals<Extract<keyof GraphQLBarrel, "GraphQLModule">, "GraphQLModule">>,
];

const assertion: GraphQLContractAssertions = Array.from(
  { length: 10 },
  () => true,
) as GraphQLContractAssertions;

function pathOf(name: string) {
  return defineConfiguration(
    z
      .object({ GRAPHQL_PATH: z.string().min(1).default("/graphql") })
      .transform(({ GRAPHQL_PATH }) => ({ path: GRAPHQL_PATH })),
    `graphql.${name}`,
  );
}

const typeDefs = `type Query { hello: String }`;

const resolvers = { Query: { hello: (): string => "world" } };

test("keeps the contract assertions referenced", () => {
  expect(assertion).toHaveLength(10);
});

test("answers a query at the default path", async () => {
  const GraphQLConfig = pathOf("conformance.served");

  @Module({
    imports: [
      GraphQLModule.register({
        configuration: GraphQLConfig,
        source: {},
        useFactory: () => ({ typeDefs, resolvers }),
      }),
    ],
  })
  class ConformanceModule {}

  const application = await AponiaFactory.create(ConformanceModule, { logger: false });

  try {
    // `handle` rather than `listen`: this lane runs on Node, where Elysia 2 has
    // no adapter and a listen throws. A request never opens a port, and the
    // endpoint answers through `use()` either way. Yoga streams its answer as
    // a server-sent event under Node, where the Bun `Response` body helpers
    // report `"[object Response]"` instead of the payload, so this lane pins
    // the status and leaves the payload to the Bun lane. Cases that need a
    // body belong in the Bun lane.
    const response = await application.handle(
      new Request("http://localhost/graphql?query={hello}"),
    );

    expect(response.status).toBe(200);
  } finally {
    await application.close();
  }
});

test("answers a non-default path the configuration declared", async () => {
  const GraphQLConfig = pathOf("conformance.custom");

  @Module({
    imports: [
      GraphQLModule.register({
        configuration: GraphQLConfig,
        source: { GRAPHQL_PATH: "/gql" },
        useFactory: () => ({ typeDefs, resolvers }),
      }),
    ],
  })
  class ConformanceModule {}

  const application = await AponiaFactory.create(ConformanceModule, { logger: false });

  try {
    const response = await application.handle(new Request("http://localhost/gql?query={hello}"));

    expect(response.status).toBe(200);

    expect(
      (await application.handle(new Request("http://localhost/graphql?query={hello}"))).status,
    ).toBe(404);
  } finally {
    await application.close();
  }
});

test("refuses a boot whose declaration's schema rejects it", async () => {
  const GraphQLConfig = defineConfiguration(
    z.object({ GRAPHQL_PATH: z.string().min(1) }).transform(({ GRAPHQL_PATH }) => ({
      path: GRAPHQL_PATH,
    })),
    "graphql.conformance.required",
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
  class ConformanceModule {}

  let failure: unknown;

  try {
    await AponiaFactory.create(ConformanceModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  expect(failure).toMatchObject({
    code: "INVALID_CONFIGURATION_VALUE",
    details: { configuration: "graphql.conformance.required" },
  });
});

// A registration is a `DynamicModule`, which is the value an application's
// `imports` accepts. Held here so this lane compiles the shape without booting.
const registration = GraphQLModule.register({
  configuration: pathOf("conformance.registration"),
  source: {},
  useFactory: () => ({ typeDefs, resolvers }),
});

test("the registration is a module an application import accepts", () => {
  expect(registration.module).toBeDefined();
  expect(registration.providers?.length).toBeGreaterThan(0);

  const assertions: GraphQLBarrelAssertions = [true];
  expect(assertions).toHaveLength(1);
});
