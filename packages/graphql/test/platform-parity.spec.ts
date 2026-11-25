import { expect, test } from "bun:test";
import { Module, defineConfiguration } from "@aponiajs/common";
import { AponiaFactory as ElysiaFactory } from "@aponiajs/platform-elysia";
import { createPlatformFactory } from "@aponiajs/platform-core";
import { h3Adapter } from "@aponiajs/platform-h3";
import { honoAdapter } from "@aponiajs/platform-hono";
import { toFetchHandler } from "@aponiajs/serverless";
import { z } from "zod";
import { GraphQLModule } from "../src/index.ts";

const GraphQLConfig = defineConfiguration(
  z
    .object({ GRAPHQL_PATH: z.string().min(1).default("/graphql") })
    .transform(({ GRAPHQL_PATH }) => ({
      path: GRAPHQL_PATH,
    })),
  "graphql.parity",
);

const typeDefs = /* GraphQL */ `
  type Query {
    hello: String!
  }
`;

const resolvers = { Query: { hello: () => "world" } };

@Module({
  imports: [
    GraphQLModule.forRoot({
      configuration: GraphQLConfig,
      source: {},
      useFactory: () => ({ typeDefs, resolvers }),
    }),
  ],
})
class ElysiaModule {}

@Module({
  imports: [
    GraphQLModule.forRoot({
      configuration: GraphQLConfig,
      source: {},
      useFactory: () => ({ typeDefs, resolvers }),
    }),
  ],
})
class HonoModule {}

@Module({
  imports: [
    GraphQLModule.forRoot({
      configuration: GraphQLConfig,
      source: {},
      useFactory: () => ({ typeDefs, resolvers }),
    }),
  ],
})
class H3Module {}

async function observe(
  fetch: (request: Request) => Response | Promise<Response>,
): Promise<{ get: unknown; post: unknown; missing: number }> {
  const get = await fetch(new Request("http://localhost/graphql?query={hello}"));
  const post = await fetch(
    new Request("http://localhost/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "{hello}" }),
    }),
  );
  const missing = await fetch(new Request("http://localhost/graphqls?query={hello}"));
  return {
    get: await get.json(),
    post: await post.json(),
    missing: missing.status,
  };
}

test("the same GraphQL registration answers identically on every platform", async () => {
  const elysia = await ElysiaFactory.create(ElysiaModule, { logger: false });
  const hono = await createPlatformFactory(honoAdapter()).create(HonoModule, { logger: false });
  const h3 = await createPlatformFactory(h3Adapter()).create(H3Module, { logger: false });

  try {
    const answers = {
      elysia: await observe((request) => elysia.handle(request)),
      hono: await observe((request) => hono.handle(request)),
      h3: await observe((request) => h3.handle(request)),
      serverless: await observe(toFetchHandler(hono)),
    };
    for (const observed of Object.values(answers)) {
      expect(observed.get).toEqual({ data: { hello: "world" } });
      expect(observed.post).toEqual({ data: { hello: "world" } });
      expect(observed.missing).toBe(404);
    }
  } finally {
    await elysia.close();
    await hono.close();
    await h3.close();
  }
});
