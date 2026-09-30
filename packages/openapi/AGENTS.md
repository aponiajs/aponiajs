# @aponiajs/openapi — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The module an application imports to serve an OpenAPI document for its own
routes, and the validated configuration the document's `info` is read from. It
wraps [`@elysia/openapi`](https://www.npmjs.com/package/@elysia/openapi), which
builds the document from the route table Elysia compiled. It is a leaf — nothing
in the framework depends on it.

| Domain      | Owns                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------- |
| `module/`   | `OpenApiModule.register`, `OpenApiModuleOptions`, the `DynamicModule` one registration lowers into                  |
| `document/` | the plugin the registration mounts, the guard that reads a configuration value into `OpenApiInfo`, and the contract |

`src/index.ts` is the only public barrel. Keep `*.types.ts` colocated with the
runtime boundary it describes.

## Invariants

- **This package adds no document generator, and no claim in it may imply one.**
  The generator is `@elysia/openapi`'s and its output is a reading of the route
  table the platform compiled. What is contributed is a module a registration
  belongs in and a validated configuration the metadata comes from. A feature
  that would make this package more than an adapter — a schema registry, a
  decorator of its own for tags or summaries, a served interface of its own — is
  a different package, and the answer to "should this package generate that?" is
  no even when the answer would be convenient. The README says so in the
  reader's words and links to the raw plugin; keep that paragraph, because a
  reader who assumes the document is enforced loses an integration, and no
  option here makes that assumption true.
- **`OpenApiInfo` is derived from the plugin's own `documentation.info`, never
  restated.** The metadata is handed to `@elysia/openapi` unchanged, so a
  package that restated the shape would keep compiling after a release that
  reshaped it, and the failure would be a document no tool parses.
  `tests-vp/openapi.conformance.ts` asserts the assignment against
  `ElysiaOpenAPIConfig` — derived from the dependency rather than copied — so a
  release that moves it fails `bun run check` instead of shipping.
- **The description this package serves is the one the application declared.**
  The wrapped plugin defaults `documentation.info` to a placeholder — a title,
  `"0.0.0"`, and the description `"Development documentation"` — and it
  shallow-merges what it is given over that. Passing a key explicitly as
  `undefined` overrides the placeholder with an absent description; omitting the
  key inherits it. The guard reads the configuration's value, not the merged
  document, so a document making a claim the application never declared cannot
  be served. `tests/openapi-module.test.ts` pins it, because the failure is
  invisible: a placeholder in a document looks like a document.
- **A registration is one `DynamicModule`, and one registration per application
  is the supported shape.** Elysia mounts a _named_ plugin once — it identifies a
  mounted plugin by a hash derived from its name — and this plugin is named, so
  two registrations with distinct keys produce two graph nodes and one document:
  whichever mounted first, at that registration's path. The second path answers
  `404`, and both modules export the same configuration token, so reading it back
  raises `AMBIGUOUS_PROVIDER` rather than picking a winner. A per-registration
  handle would remove the ambiguity and is deliberately not here, for the same
  reason cron gives. Both halves are pinned in the Bun lane, so a change that
  lifts the limitation has to change the README with it.
- **A `ws` route is excluded, and the exclusion is this package's to state.** The
  platform mounts a WebSocket gateway as a route whose method really is `ws`,
  which is not an OpenAPI path-item field: left in, the document carries a path
  item no validator accepts. The registration mounts the plugin with
  `exclude.methods: ["options", "ws"]`, and the Bun lane pins a gateway's
  absence rather than leaving it to the plugin's defaults. `options` is excluded
  beside it for the reason the plugin excludes it by default.
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

`tests/*.test.ts` under Bun, `tests-vp/*.conformance.ts` under Vite+. Both lanes
run real boots through `AponiaFactory.create` and read the document through
`application.handle(new Request(...))`, because what this package promises is a
document and nothing less than parsing one proves it.

The Bun lane owns:

1. the document is served at the registration's path, the interface is served at
   the path beside it, the plugin's default path is not mounted, and the
   metadata is the configuration's value;
2. every declared schema slot appears on the operation that declared it —
   `body`, `query`, `params`, `headers`, `cookie`, a single `response`, and a
   status-specific response map — and a route with no schema is still an
   operation;
3. an absent description is served as no description, which is what proves the
   plugin's placeholder was overridden;
4. a WebSocket gateway's route is not in the document;
5. a schema refusal, a value only a runtime can produce, and a value that states
   no metadata at all each fail the boot with the code and the issue list;
6. a non-absolute mount path is refused while the registration runs, and the
   default is not;
7. two registrations sharing a key are `DUPLICATE_MODULE`, and two with distinct
   keys produce one document, a `404` at the second path, and
   `AMBIGUOUS_PROVIDER` on read-back;
8. `tests/generated-descriptors.test.ts` reads the same graph two ways — from a
   module's decorators and from the descriptor artifact `aponia build` emits —
   and asserts the two documents are equal, which is the acceptance criterion
   the CLI's own integration test states for the artifact, restated for a
   document. It also pins what the emitter declines: a module whose `imports`
   name a registration is not lowerable in any spelling, the platform lowers such
   a root from its decorators, and the document is served anyway.

The Vite+ lane mirrors the contract compile-time: `keyof OpenApiModuleOptions`,
the nested `info` key, and the assignability of `OpenApiInfo` into the plugin's
own `documentation.info`. It must not call `listen()`: the lane runs on Node,
where Elysia 2 has no adapter and a listen throws. Cases that need a real port
belong in the Bun lane.
