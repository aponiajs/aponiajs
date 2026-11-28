# GraphQL

`@aponiajs/graphql` serves a GraphQL endpoint for an Aponia application, with the
mount path read from a validated configuration. The endpoint is a neutral
`HttpPolicy`: `graphql-yoga` owns the schema, the resolver results, the error
shapes, and GraphiQL, and the policy matches the declared path and delegates the
request, so the same registration answers the same query on every platform.

## Use it

Register the endpoint in the module that owns the schema, and inject the
providers its resolvers need:

```ts
import { Module } from "@aponiajs/common";
import { GraphQLModule } from "@aponiajs/graphql";
import { GraphQLConfig } from "./config.ts";
import { UserService } from "./users.service.ts";

const graphql = GraphQLModule.forRoot({
  configuration: GraphQLConfig,
  inject: [UserService],
  useFactory: (users) => ({
    typeDefs: `type Query { users: [String] }`,
    resolvers: { Query: { users: () => users.all() } },
  }),
});

@Module({ imports: [graphql] })
export class AppModule {}
```

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule);
await application.listen(Number(Bun.env.PORT ?? 3000));
```

A resolver reaches injected services through the factory closure, so a query is
served by a provider the container constructed rather than a module-level
constant. `imports` lists the modules whose exports the factory may inject, and
`inject` names the tokens it receives.

## The validated configuration

The configuration carries one field, `path`, and the module sets the plugin's
`path` and yoga's `graphqlEndpoint` from it. A non-default endpoint is declared
once, so the `404` a raw plugin answers when only one of the two is set cannot
happen through this package.

```ts
import { defineConfiguration } from "@aponiajs/common";
import { z } from "zod";

export const GraphQLConfig = defineConfiguration(
  z
    .object({ GRAPHQL_PATH: z.string().startsWith("/").default("/graphql") })
    .transform(({ GRAPHQL_PATH }) => ({ path: GRAPHQL_PATH })),
  "graphql.config",
);
```

The module provides this token itself and exports it, so the application reads
the same validated value back through `application.get(GraphQLConfig)`. `source`
overrides what the schema validates — a literal record instead of the
environment — which is what a test passes.

## Endpoint precedence

The endpoint is a request policy, not a mounted route. It answers the declared
path before routing, so it runs on every platform and every method. A controller
at the same path is reached only for paths the policy declines; no
`DUPLICATE_ROUTE` is raised.

## One registration per application

A registration is one graph node with one identity. Two registrations sharing a
key are `DUPLICATE_MODULE`; two under distinct keys each contribute a policy, and
the first matching policy answers. Both modules export the same configuration
token, so reading it back raises `AMBIGUOUS_PROVIDER`. One registration per
application is the supported shape.

`aponia build` declines a module whose `imports` name a registration — a
`DynamicModule` is a runtime value rather than a declared class — and the boot
lowers that root from its decorators. The endpoint still serves; what the decline
costs is the lowering, not the query.

## Errors

Every refusal of the configuration is `AponiaError` with
`INVALID_CONFIGURATION_VALUE` and `{ configuration, issues }`. The issue list is
total: every field that fails is reported rather than the first. A resolver
failure is yoga's own answer: a `200` with partial `data` and an `errors` entry,
and neither the thrown message nor a stack outside the payload yoga declares.

## Verification

```bash
bun test packages/graphql
bun run test:vite-plus
bun run check
```

[Package README](../../packages/graphql/README.md) ·
[Platform parity](../platforms/platform-parity.md)
