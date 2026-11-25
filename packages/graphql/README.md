# @aponiajs/graphql

```bash
bun add @aponiajs/graphql
```

Serve a GraphQL endpoint for an Aponia application, with the mount path read
from a validated configuration.

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

A resolver reaches injected services through the factory closure. The endpoint
mounts through the module graph, so the application sees it in the same boot as
its controllers.

## Bootstrap

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule);
await application.listen(Number(Bun.env.PORT ?? 3000));
```

## Declaring an endpoint

`GraphQLModule.forRoot` returns a `DynamicModule`, which is what an `imports`
entry accepts:

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

`key` names the module's identity and defaults to `"graphql"`. Two registrations
that share one key are one module identity, which the graph refuses as
`DUPLICATE_MODULE` rather than mounting one and dropping the other.

A factory that names no `inject` receives nothing and returns a schema fixed in
source. A factory that returns `{ schema }` serves a prebuilt `GraphQLSchema`
unchanged. `imports` lists the modules whose exports the factory may inject: a
provider the factory names in `inject` is resolved against the module that
declares the registration, so a service a resolver uses has to be exported by a
module listed there.

## The validated configuration

The mount path comes from a configuration the application declares and the
module validates, not from a runtime's defaults:

```ts
import { defineConfiguration } from "@aponiajs/common";
import { z } from "zod";

export const GraphQLConfig = defineConfiguration(
  z
    .object({ GRAPHQL_PATH: z.string().min(1).default("/graphql") })
    .transform(({ GRAPHQL_PATH }) => ({ path: GRAPHQL_PATH })),
  "graphql.config",
);
```

| Field  | Required | Default    | Refused when                              |
| ------ | -------- | ---------- | ----------------------------------------- |
| `path` | yes      | `/graphql` | not a non-empty string beginning with `/` |

`GraphQLModule.forRoot` provides this token itself, from `process.env`, and
exports it, so the application reads the same validated value back:

```ts
const application = await AponiaFactory.create(AppModule);

application.get(GraphQLConfig); // the value the endpoint was built from
```

`source` overrides what the schema validates — a literal record instead of the
environment — which is what a test passes.

## The path pair

A raw yoga server needs the mount path stated as `graphqlEndpoint`; the
route, and yoga's `graphqlEndpoint` decides which requests the yoga handler
answers. The two default independently to `/graphql`, so an application that
sets one and not the other gets a route that answers `404` for every request.
Measured through `application.handle`, with only `path` set to `/gql`:

| Request        | Answer                                    |
| -------------- | ----------------------------------------- |
| `GET /gql`     | `404`, with an empty body                 |
| `GET /graphql` | `404`, because the route moved without it |

This package states the endpoint once, as `path`, and the module sets both
fields from it. Measured with `path: "/gql"` through the module:

| Request        | Answer                                              |
| -------------- | --------------------------------------------------- |
| `GET /gql`     | `200`, `{ "data": { ... } }`, plus `POST /gql`      |
| `GET /graphql` | `404`, because the default is not mounted beside it |

## What the endpoint answers

Measured through `application.handle`, with `path: "/graphql"` and a resolver
returning `"world"` for `hello`:

| Request                          | Answer                                                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /graphql?query={hello}`     | `200`, `{ "data": { "hello": "world" } }`                                                                                                                                                              |
| `POST /graphql` with `{ query }` | `200`, `{ "data": { "hello": "world" } }`                                                                                                                                                              |
| a resolver that throws           | `200`, with `data: { hello: null }` and one entry in `errors` whose `message` is masked (`"Unexpected error."`), whose `path` is `["hello"]`, and which carries neither the thrown message nor a stack |

A resolver failure is therefore a GraphQL error, not an HTTP one: the status
stays `200` and the partial data stays in the body.

## What never reaches the endpoint

The endpoint is a request policy, not a mounted route. Two consequences, both
measured:

- **No guard, interceptor, or exception filter reaches it.** A guard that
  refuses its own controller with `403` Problem Details still answers, while the
  query beside it answers `200`. An application that needs authorization on
  GraphQL enforces it inside its resolvers.
- **A controller at the same method and path is reached only for paths the
  policy declines.** The policy answers the declared path before routing, so a
  controller at that path is shadowed without a `DUPLICATE_ROUTE`; the boot
  succeeds and the controller answers elsewhere.

## One registration per application

The endpoint is a request policy, so two registrations under distinct keys each
contribute one and the first matching policy answers. Two consequences, both
measured:

- **Two registrations under one key** are `DUPLICATE_MODULE`
  (`{"module":"GraphQLModule[graphql]"}`), whichever paths they declare.
- **Two registrations under distinct keys** each contribute a policy. Both
  modules export the same configuration token, so reading it back raises
  `AMBIGUOUS_PROVIDER` rather than picking a winner.

One registration per application is the supported shape.

## `aponia build`

A registration returns a `DynamicModule`, which is not a `@Module()` class that
`aponia build` can read from the project's own source, so **a module whose
`imports` name one is declined** — reported in the emitter's `declined` list,
with the artifact holding nothing for it.

The application is whole anyway: a boot handed an artifact with no declaration
for the root module it was given lowers that root from its decorators instead,
and the endpoint answers. What the decline costs is the lowering, not the
endpoint. `src/generated-descriptors.spec.ts` measures both halves.

No endpoint value can be exported beside the module: the policy is built from a
value the container resolves, so it exists only inside a boot. An application
that needs the compiled route table untouched by a registration mounts a raw
GraphQL plugin through `AponiaApplicationOptions.plugins` and gives up the
module and its validation to do it.

## Errors

A configuration this package refuses raises `AponiaError` with
`INVALID_CONFIGURATION_VALUE`, carrying `{ configuration, issues }`:

- when the schema rejects the value;
- when the value the schema produced is not an object with a usable `path`.

`INVALID_CONFIGURATION` covers a declaration that is not a Standard Schema, or
whose validation answers asynchronously, both of which
`provideConfiguration` already refuses for any configuration.

## Native escape hatch

The module above is the supported path. A raw GraphQL plugin remains available
when the module's validation, graph node, or configuration contract is not
wanted.

**This package serves no schema of its own.** Every field, every resolver
result, and every error shape is [GraphQL Yoga](https://the-guild.dev/graphql/yoga-server)'s,
which this package depends on directly. The schema is the application's —
`typeDefs` plus `resolvers`, or a prebuilt `GraphQLSchema` — built in the
module's factory, where a resolver can close over any provider the factory
injects. This package contributes two things:

- a module the endpoint is declared in, so the endpoint is a node in the
  compiled graph and is initialized in the boot's instance-loading pass;
- a validated configuration the mount path comes from, so a missing path or a
  relative one is a refused boot with a code and an issue list, rather than a
  route nobody answers.

**This is not a schema-first Aponia integration.** There is no decorator that
derives a schema from controllers, no code-first builder, and no mapping between
Aponia routes and GraphQL fields. A query is answered by the resolvers the
factory returned, and nothing else. An application that wants a raw Elysia mount
— a schema fixed in source and a path it sets itself — can install
[`@elysia/graphql-yoga`](https://www.npmjs.com/package/@elysia/graphql-yoga)
directly and mount it through `AponiaApplicationOptions.plugins`:

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { yoga } from "@elysia/graphql-yoga";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule, {
  plugins: [yoga({ typeDefs, resolvers, path: "/gql", graphqlEndpoint: "/gql" })],
});
```

Note the pair: the raw plugin needs `path` **and** `graphqlEndpoint` set
together, which is the footgun this package closes.

## Requirements

The package depends on `@aponiajs/common` and `@aponiajs/platform-core`, and on
`graphql-yoga` for the fetch handler. `graphql` is a peer dependency the
application installs. It has no Elysia dependency.

## Links

- [Package README](./README.md)
- [GraphQL Yoga](https://the-guild.dev/graphql/yoga-server)
- [Plugin package authoring](../../docs/tooling/plugin-packages.md)
- [Platform parity](../../docs/platforms/platform-parity.md)
- [Configuration](../../docs/build/configuration.md)
- [Published packages](../../docs/reference/packages.md)
