# @aponiajs/graphql — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The module an application imports to serve a GraphQL endpoint, and the
validated configuration the mount path is read from. It wraps [`graphql-yoga`](https://www.npmjs.com/package/graphql-yoga), which
supplies the schema execution, the resolver results, and the error shapes, and
serves it through a neutral `HttpPolicy`. It is a leaf — nothing in the
framework depends on it.

| Domain              | Owns                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `graphql.module.ts` | `GraphQLModule.forRoot`, `GraphQLModuleOptions`, and the `DynamicModule` one registration lowers into |
| `endpoint/`         | the `HttpPolicy` endpoint and the guard that reads a configuration value into a path                  |
| `interfaces/`       | the module and endpoint contracts                                                                     |

`src/index.ts` is the only public barrel. Type-only contracts live in
`interfaces/<name>.interface.ts`.

## Invariants

- **This package serves no schema, and no claim in it may imply one.** The
  fields, the resolver results, and the error shapes are GraphQL Yoga's. What is
  contributed is a module a registration belongs in, a validated configuration
  the mount path comes from, and the neutral `HttpPolicy` that delegates to
  Yoga's fetch handler. A feature that would make this package more than an
  adapter — a decorator that derives a schema from controllers, a code-first
  builder, a mapping between Aponia routes and GraphQL fields — is a different
  package, and the answer to "should the adapter do this?" is no even when the
  answer would be convenient. The README leads with module registration and
  keeps the schema boundary and raw-plugin alternative in its final Native
  escape hatch section.
- **The configuration carries the path only, and the policy sets the pair Yoga
  needs.** Yoga needs `graphqlEndpoint` for the handler, and the policy matches
  the same declared path, defaulting independently in a raw mount; setting only
  one answers `404` at the declared path. `GraphQLConfiguration` has one field,
  and `buildGraphQLPolicy` sets the policy path and `graphqlEndpoint` from it,
  which is what makes a non-default endpoint answer.
  `src/graphql-module.spec.ts` boots both sides of the boundary — the module
  answering `200` where a raw mount with only one half set answers `404` — so a
  change that drops one half of the pair has to change the README with it.
- **The schema options are derived from Yoga's own config, not restated.**
  `GraphQLSchemaOptions` is a distributive `Omit` of `createYoga`'s parameter
  over `"path" | "graphqlEndpoint"`, so a release of Yoga that adds an option is
  accepted here without this package changing, and the two fields the
  configuration owns are removed from it. The `Omit` is distributive because the
  config is a union — one arm carries `typeDefs` + `resolvers`, the other
  carries `schema` — and collapsing it would erase which fields a given arm
  requires. `test/graphql.conformance.ts` pins that `path` and `graphqlEndpoint`
  are absent and that `typeDefs` is present, so the widening fails
  `bun run check` instead.
- **The endpoint is a request policy, not a mounted route.** It answers the
  declared path before routing, so it runs on every platform and every method;
  a controller at the same path is reached only for paths the policy declines.
  No `DUPLICATE_ROUTE` is raised, and the Bun lane pins the precedence.
- **One registration per application is the supported shape.** Two
  registrations sharing a key are `DUPLICATE_MODULE`; two under distinct keys
  each contribute a policy, and the first matching policy answers. Both modules
  export the same configuration token, so reading it back raises
  `AMBIGUOUS_PROVIDER`. The Bun lane pins the ambiguity.
- **Every refusal of the configuration is `AponiaError` with
  `INVALID_CONFIGURATION_VALUE` and `{ configuration, issues }`.** The shape a
  schema refusal already carries, so a caller reads one contract whichever half
  refused. The list is total: every field that fails is reported rather than
  the first.
- **The module provides the configuration it consumes and exports it.** The
  module is registered by the application that also declares the configuration,
  so a design where the application declares the token and the module imports it
  would be a module cycle. Owning the declaration makes one module the whole
  story, and exporting it keeps `application.get(GraphQLConfig)` working for the
  application that wrote it. `source` exists because `provideConfiguration`
  accepts it: a test validates a literal rather than mutating the process
  environment, and no case in either lane touches `process.env`.
- **No endpoint value can be exported beside the module.** The endpoint is built
  from a value the container resolves, so it exists only inside a boot. An
  application that needs the descriptor artifact untouched mounts the raw
  `@elysia/graphql-yoga` plugin through `AponiaApplicationOptions.plugins` and
  gives up the module and its validated path.
- **Resolvers reach providers through `useFactory` injection.** `imports`
  lists the modules whose exports the factory may inject, and `inject` names
  the tokens it receives, so a resolver closes over a service the container
  constructed rather than a module-level constant. The Bun lane pins a resolver
  served by an injected service, and the prebuilt-`schema` arm beside it, so a
  change that moves schema construction out of the factory has to change the
  README with it.

## Tests

`src/**/*.spec.ts` under Bun, `test/*.conformance.ts` under Vite+. Both lanes
boot real applications through `AponiaFactory.create` and read real responses
through `application.handle(new Request(...))`, because what this package
promises is an answered query and nothing less than one proves it. No case
asserts on a message string; the configuration refusals assert
`AponiaError.code` and `details.issues`. No case touches `process.env`, and no
case calls `listen()`: the Bun lane uses `handle` throughout.

The Bun lane owns:

1. a query at the default path answered by a resolver served by an injected
   service, over both `GET` and `POST`, with a controller beside it still
   answering and the configuration read back;
2. a non-default path answering `200` over `GET` and `POST` while the default
   is not mounted, beside the raw-plugin control that answers `404` with only
   `path` set — the path-pair footgun the package closes;
3. a prebuilt `GraphQLSchema` served unchanged;
4. the enhancer exclusion: a refusing guard answers `403` Problem Details on
   its own controller while the query beside it answers `200`;
5. a resolver failure probed, not guessed: `200`, partial `data`, one entry in
   `errors` with `path: ["hello"]`, and neither the thrown message nor a stack
   in the body;
6. a schema refusal, a value only a runtime can produce, and a value that
   states no endpoint, each failing the boot with the code and the issue list;
7. the double-mount behaviour, both profiles — the same key is
   `DUPLICATE_MODULE` (`GraphQLModule[graphql]`), distinct keys each contribute
   a policy, the first matching policy answers, and the shared token reads back
   as `AMBIGUOUS_PROVIDER`;
8. the shadowing profile: a controller at the same method and path is reached
   only for paths the policy declines, with no `DUPLICATE_ROUTE`;
9. the barrel holding a single value export, so a second export cannot arrive
   quietly;
10. `src/generated-descriptors.spec.ts` pins the `aponia build` consequence: a
    module whose `imports` name a registration is declined, the artifact holds
    nothing for it, and the application boots and answers anyway because the
    platform lowers the root from its decorators.

The Vite+ lane mirrors the contract and the observable answers. It must not call
`listen()`: the lane runs on Node, where Elysia 2 has no adapter and a listen
throws. It must not assert on a GraphQL response body either: under Node, yoga
streams its answer where the Bun `Response` body helpers report
`"[object Response]"` instead of the payload, so that lane pins the status and
leaves the payload to the Bun lane. Cases that need a body belong in the Bun
lane.
