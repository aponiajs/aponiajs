# @aponiajs/graphql — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The module an application imports to serve a GraphQL endpoint, and the
validated configuration the mount path is read from. It wraps
[`@elysia/graphql-yoga`](https://www.npmjs.com/package/@elysia/graphql-yoga),
which wraps Yoga and supplies the schema execution, the resolver results, and
the error shapes. It is a leaf — nothing in the framework depends on it.

| Domain      | Owns                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| `module/`   | `GraphQLModule.register`, `GraphQLModuleOptions`, the `DynamicModule` one registration lowers into            |
| `endpoint/` | the plugin the registration mounts, the guard that reads a configuration value into a path, and the contracts |

`src/index.ts` is the only public barrel. Keep `*.types.ts` colocated with the
runtime boundary it describes.

## Invariants

- **This package serves no schema, and no claim in it may imply one.** The
  fields, the resolver results, and the error shapes are
  `@elysia/graphql-yoga`'s. What is contributed is a module a registration
  belongs in and a validated configuration the mount path comes from. A feature
  that would make this package more than an adapter — a decorator that derives
  a schema from controllers, a code-first builder, a mapping between Aponia
  routes and GraphQL fields — is a different package, and the answer to
  "should the adapter do this?" is no even when the answer would be convenient.
  The README says so in the reader's words, states plainly that a schema fixed
  in source needs no package at all, and links the raw plugin. Keep that
  paragraph: a package that oversells a thin adapter is the defect this
  repository cares most about.
- **The configuration carries the path only, and the module sets the pair the
  raw plugin needs.** The wrapped plugin needs `path` for the Elysia route and
  yoga's `graphqlEndpoint` for the handler, defaulting independently; setting
  only one answers `404` at the declared path. `GraphQLConfiguration` has one
  field, and `buildGraphQLPlugin` sets both from it, which is what makes a
  non-default endpoint answer. `tests/graphql-module.test.ts` boots both sides
  of the boundary — the module answering `200` where the raw plugin with only
  `path` set answers `404` — so a change that drops one half of the pair has
  to change the README with it.
- **The schema options are derived from the plugin's own config, not restated.**
  `GraphQLSchemaOptions` is a distributive `Omit` of the `yoga` parameter over
  `"path" | "graphqlEndpoint"`, so a release of the plugin that adds a yoga
  option is accepted here without this package changing, and the two fields the
  configuration owns are removed from it. The `Omit` is distributive because
  the config is a union — one arm carries `typeDefs` + `resolvers`, the other
  carries `schema` — and collapsing it would erase which fields a given arm
  requires. `tests-vp/graphql.conformance.ts` pins that `path` and
  `graphqlEndpoint` are absent and that `typeDefs` is present, so the widening
  fails `bun run check` instead.
- **The endpoint mounts through `use()`, outside the compiled route table, and
  both halves are pinned.** No guard, interceptor, or exception filter reaches
  it, and a controller declaring the same `(method, path)` shadows it silently
  with no `DUPLICATE_ROUTE` — because `yoga()` returns a synchronous function,
  the plugin's routes are already in the table when the controller pass runs.
  The Bun lane pins the guard half and the shadowing half (three routes, the
  controller's answer), so a change that routes enhancers to the endpoint has
  to change the README with it.
- **One registration per application is the supported shape, and both halves
  are pinned.** Two registrations sharing a key are `DUPLICATE_MODULE`
  (`PluginModule[graphql]`); two under distinct keys both mount — four routes,
  two per plugin — even when they resolve the same path, because the plugin's
  factory is **unnamed** and Elysia does not deduplicate it, unlike the named
  cors and openapi plugins that collapse. Both modules export the same
  configuration token, so reading it back raises `AMBIGUOUS_PROVIDER`. The Bun
  lane pins the four-route mount and the ambiguity, so a change that lifts the
  limitation has to change the README with it.
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
- **No plugin value can be exported beside the module.** `@aponiajs/devtools`
  exports `devtoolsPlugin`, because its plugin is built from options fixed in
  source. This one's plugin is built from a value the container resolves, so it
  exists only inside a boot — which is also why the module uses
  `PluginModule.registerAsync` rather than `PluginModule.register`. An
  application that needs the descriptor artifact untouched mounts the raw plugin
  through `AponiaApplicationOptions.plugins` and gives up the module.
- **Resolvers reach providers through `useFactory` injection.** `imports`
  lists the modules whose exports the factory may inject, and `inject` names
  the tokens it receives, so a resolver closes over a service the container
  constructed rather than a module-level constant. The Bun lane pins a resolver
  served by an injected service, and the prebuilt-`schema` arm beside it, so a
  change that moves schema construction out of the factory has to change the
  README with it.

## Tests

`tests/*.test.ts` under Bun, `tests-vp/*.conformance.ts` under Vite+. Both lanes
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
   `DUPLICATE_MODULE` (`PluginModule[graphql]`), distinct keys mount twice
   (four routes, counted in the native route table and in the inspected graph)
   and read back as `AMBIGUOUS_PROVIDER`;
8. the shadowing profile: a controller at the same method and path registers
   after the synchronous plugin and answers, with no `DUPLICATE_ROUTE` and
   three routes in the table;
9. the barrel holding a single value export, so a second export cannot arrive
   quietly;
10. `tests/generated-descriptors.test.ts` pins the `aponia build` consequence: a
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
