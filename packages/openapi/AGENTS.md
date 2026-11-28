# @aponiajs/openapi — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The module an application imports to serve an OpenAPI document for its own
routes, and the validated configuration the document's `info` is read from. The
document is built from the compiled route plans and served by a controller on the
application's own route table, so the same registration answers on every
platform. It is a leaf — nothing in the framework depends on it.

| Domain              | Owns                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `openapi.module.ts` | `OpenApiModule.forRoot`, `OpenApiModuleOptions`, and the `DynamicModule` one registration lowers into |
| `document/`         | the controller and document builder the registration mounts, plus the configuration guard             |
| `interfaces/`       | the module and document contracts                                                                     |

`src/index.ts` is the only public barrel. Type-only contracts live in
`interfaces/<name>.interface.ts`.

## Invariants

- **The document is generated from compiled route plans, and it describes routes;
  it does not enforce them.** `buildOpenApiDocument` walks the container's
  controllers and lowers each compiled plan into a path item; nothing here
  validates a request. A schema registry, a decorator of its own for tags or
  summaries, or a served Scalar UI is a different package, and the answer to
  "should this package generate that?" is no even when the answer would be
  convenient. Keep the README's statement that the document is a description,
  because a reader who assumes enforcement loses an integration.
- **`OpenApiInfo` is the document's own contract.** The three fields are the
  ones OpenAPI's Info Object names, and the document builder writes them from the
  validated configuration rather than from a generated placeholder.
  `test/openapi.conformance.ts` pins `keyof OpenApiModuleOptions` and the nested
  `info` shape, so widening it fails `bun run check` instead of shipping a
  document no tool parses.
- **The description this package serves is the one the application declared.**
  `title` and `version` are required, and an absent description is served as no
  description rather than as a generated sentence. The guard reads the
  configuration's value, not a merged document, so a document making a claim the
  application never declared cannot be served. `src/openapi-module.spec.ts` pins
  it, because the failure is invisible: a placeholder in a document looks like a
  document.
- **A registration is one `DynamicModule`, and one registration per application
  is the supported shape.** Two registrations with distinct keys produce two
  graph nodes and two controllers; each path serves the document its own
  configuration describes. Both modules export the same configuration token, so
  reading it back raises `AMBIGUOUS_PROVIDER` rather than picking a winner. A
  per-registration handle would remove the ambiguity and is deliberately not
  here, for the same reason cron gives. The Bun lane pins both halves.
- **Methods an OpenAPI path item cannot state are omitted.** `ALL`, `OPTIONS`,
  and `HEAD` are excluded by the document builder, and a WebSocket gateway is a
  gateway plan rather than an HTTP route, so neither reaches the document. The
  Bun lane pins a gateway's absence rather than leaving it to a default.
- **A mount path is a `TypeError`, not an `AponiaError`.** It is written in
  source, where a relative one is a programming mistake, while the metadata is
  data an environment supplies and is refused with a stable code and an issue
  list. The same split the CLI uses for its own arguments, and the Bun lane pins
  both halves.
- **Every refusal of the configuration is `AponiaError` with
  `INVALID_CONFIGURATION_VALUE` and `{ configuration, issues }`.** The shape a
  schema refusal already carries, so a caller reads one contract whichever half
  refused. The issue list is total: every field that fails is reported rather
  than the first, because a value the schema did not build can be wrong in more
  than one place and a boot that names one field at a time is a boot a
  maintainer runs three times.
- **`OpenApiConfiguration` declares `info`, not the three fields.** The key is
  where a later, additive option on the configuration finds a home — a `servers`
  list, say — without a breaking change to the value's shape, and it is what
  makes the guard's refusal name `"info"` rather than report that the whole
  value is the wrong type.
- **The module provides the configuration it consumes and exports it.** The
  module is registered by the application that also declares the configuration,
  so a design where the application declares the token and the module imports it
  would be a module cycle. Owning the declaration makes one module the whole
  story, and exporting it keeps `application.get(OpenApiConfig)` working for the
  application that wrote it. `source` exists because `provideConfiguration`
  accepts it: a test validates a literal rather than mutating the process
  environment, and no case in either lane touches `process.env`.

## Tests

`src/**/*.spec.ts` under Bun, `test/*.conformance.ts` under Vite+. Both lanes
run real boots through `AponiaFactory.create` and read the document through
`application.handle(new Request(...))`, because what this package promises is a
document and nothing less than parsing one proves it.

The Bun lane owns:

1. the document is served at `${path}/json`, the HTML index at `${path}`, and
   the metadata is the configuration's value;
2. every declared schema slot appears on the operation that declared it —
   `body`, `query`, `params`, `headers`, `cookie`, a single `response`, and a
   status-specific response map — and a route with no schema is still an
   operation;
3. an absent description is served as no description, not as a generated
   placeholder;
4. a WebSocket gateway's route is not in the document;
5. a schema refusal, a value only a runtime can produce, and a value that states
   no metadata at all each fail the boot with the code and the issue list;
6. a non-absolute mount path is refused while the registration runs, and the
   default is not;
7. two registrations sharing a key are `DUPLICATE_MODULE`, and two with distinct
   keys each serve the document their own configuration describes and raise
   `AMBIGUOUS_PROVIDER` on read-back of the shared token;
8. `src/generated-descriptors.spec.ts` reads the same graph two ways — from a
   module's decorators and from the descriptor artifact `aponia build` emits —
   and asserts the two documents are equal, which is the acceptance criterion
   the CLI's own integration test states for the artifact, restated for a
   document. It also pins what the emitter declines: a module whose `imports`
   name a registration is not lowerable in any spelling, the platform lowers such
   a root from its decorators, and the document is served anyway.

The Vite+ lane mirrors the contract compile-time: `keyof OpenApiModuleOptions`
and the nested `info` key. It must not call `listen()`: the lane runs on Node,
where Elysia 2 has no adapter and a listen throws. Cases that need a real port
belong in the Bun lane.
