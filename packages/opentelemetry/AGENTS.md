# @aponiajs/opentelemetry — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The module an application imports to trace its routes, and the validated
configuration the policy is read from. It wraps
[`@elysia/opentelemetry`](https://www.npmjs.com/package/@elysia/opentelemetry),
which supplies the root span, the per-stage spans, the attributes, the
propagation, and the `NodeSDK` startup. It is a leaf — nothing in the framework
depends on it.

| Domain     | Owns                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `module/`  | `OpentelemetryModule.register`, `OpentelemetryModuleOptions`, the `DynamicModule` one registration lowers into                        |
| `tracing/` | the plugin the registration mounts, the guard that reads a configuration value into options, the shutdown provider, and the contracts |

`src/index.ts` is the only public barrel. Keep `*.types.ts` colocated with the
runtime boundary it describes.

## Invariants

- **This package is not a tracing backend and ships no exporter, and no claim in
  it may imply one.** No OTLP client, no vendor client, no collector
  configuration, no storage, and no query surface. The span processors, the
  exporters, and the instrumentations are the application's, passed to `register`
  because they are live objects a configuration cannot carry. The README states
  the boundary before any usage section, and `tests/opentelemetry-module.test.ts`
  pins the barrel to a single value export so an exporter cannot arrive quietly.
- **The configuration carries data only, and the boundary is stated rather than
  widened.** `OpentelemetryConfiguration` has four fields, and the wrapped
  plugin's `ElysiaOpenTelemetryOptions` is deliberately not the configuration
  type. `tests-vp/opentelemetry.conformance.ts` pins `keyof
OpentelemetryConfiguration` field by field and pins that
  `serviceName`, `recordBody`, `headersToSpanAttributes`, and `spanUrlRedaction`
  are absent from the runtime options; a widening fails `bun run check` instead.
- **`serviceName` is required, and that is this adapter's own default and not the
  plugin's.** `@elysia/opentelemetry` defaults it to `"Elysia"`, which is a name
  every service would have to overwrite to be told apart in a trace. An empty
  string is refused as well, because the plugin's default applies only to
  `undefined` — `serviceName: ""` would reach the resource as an empty name. Do
  not restate the wrapped plugin's defaults as though they were this package's.
- **The one cross-field rule is about the request side, and it is narrow on
  purpose.** `recordBody` recording the request together with
  `headersToSpanAttributes.request` naming `authorization`,
  `proxy-authorization`, `cookie`, or `"*"` puts a live credential on the same
  exported span, so the pair is refused at boot. Recording a _response_ body
  beside captured response headers is accepted. `tests/opentelemetry-module.test.ts`
  carries a case on each side of the boundary, so loosening or tightening the
  rule has to change the README with it.
- **Every refusal of the configuration is `AponiaError` with
  `INVALID_CONFIGURATION_VALUE` and `{ configuration, issues }`.** The shape a
  schema refusal already carries, so a caller reads one contract whichever half
  refused. The issue list is total: every field that fails is reported rather
  than the first.
- **The wrapped plugin's `NodeSDK` is process-global, the first registration in a
  process owns it, and `application.close()` does not stop it.** The plugin
  constructs a `NodeSDK` and calls `start()`, guarded by `shouldStartNodeSDK`; the
  plugin names itself with no seed, so Elysia deduplicates every registration to
  one native mount; and the SDK lives in a closure no lifecycle hook reaches.
  Every one of those three is **measured in the Bun lane**, not inferred: a second
  application's spans land in the first registration's exporter with the first
  registration's `service.name` while its own processor receives nothing. The
  README states this as the sharpest limit in the package. Do not describe the
  module as giving an application its own tracer.
- **Which SDK owns the process must not be a premise of a test.** Every
  registration in this package boots in one Bun process, so a case that asserts
  on the span _list_ belongs beside the one registration that owns the process
  while a case that asserts through `getCurrentSpan()` does not depend on it.
  The generated-descriptor cases read the span from inside the handler for
  exactly that reason, and they live in the same file for it too: a second file
  booting a registration first would steal the SDK the first file's exporter
  depends on. A new case that needs its own exporter belongs beside the
  registration that owns the process, or must state what it does about the
  process.
- **Stopping is a provider hook, and what it can stop is bounded.** The module
  provides one `OpentelemetryShutdown` that owns the declared `spanProcessors` and
  shuts them down in `onApplicationShutdown`. It does not reach a processor the
  application built but did not pass to `register`, and it does not reach an
  exporter `NodeSDK` constructed from its own options; the README states both
  limits rather than implying a full teardown. The stop drops its handles, so a
  second `close()` stops nothing a second time — pinned, because a processor shut
  down twice would break another registration's SDK.
- **No plugin value can be exported beside the module.** `@aponiajs/devtools`
  exports `devtoolsPlugin`, because its plugin is built from options fixed in
  source. This one's plugin is built from a value the container resolves, so it
  exists only inside a boot — which is also why the module uses
  `PluginModule.registerAsync` rather than `PluginModule.register`. An application
  that needs the descriptor artifact untouched mounts the raw plugin through
  `AponiaApplicationOptions.plugins` and gives up the module.
- **The module provides the configuration it consumes and exports it.** The
  module is registered by the application that also declares the configuration, so
  a design where the application declares the token and the module imports it
  would be a module cycle. `source` exists because `provideConfiguration` accepts
  it: a test validates a literal rather than mutating the process environment, and
  no case in either lane touches `process.env`.
- **The runtime options are derived from the plugin's own options type, not
  restated.** `OpentelemetryRuntimeOptions` is
  `Omit<ElysiaOpenTelemetryOptions, …>`, so a release of the plugin that adds an
  option is accepted here without this package changing, and the four fields the
  configuration owns are removed from it. Spreading the configuration _after_ the
  runtime options in `buildOpentelemetryPlugin` is what makes the validated value
  authoritative.

## Tests

`tests/*.test.ts` under Bun, `tests-vp/*.conformance.ts` under Vite+. Both lanes
boot real applications through `AponiaFactory.create` and read real responses
through `application.handle(new Request(...))`, because what this package
promises is an answer and a recorded span and nothing less than both proves it.
No case asserts on a message string; the configuration refusals assert
`AponiaError.code` and `details.issues`.

The Bun lane owns:

1. a span the handler, an injected service, and a guard each report seeing
   through `getCurrentSpan()`, with the resource `service.name` the validated
   configuration declared;
2. a refusing guard: the platform's `403` `application/problem+json`, an `Error`
   child span, and a root span left `UNSET`;
3. an unhandled failure: the platform's `500` Problem Details answer carrying no
   thrown message or stack, and a root span set to `ERROR` with an `exception`
   event;
4. a schema refusal and a value only a runtime can produce, each naming every
   failing field in one boot;
5. the cross-field rule, and a response-only capture that is accepted;
6. the process-global facts: a second registration's spans land in the first
   registration's exporter under the first registration's service name while its
   own processor receives nothing;
7. the shutdown provider, including that a second `close()` stops nothing twice;
8. two registrations under one key being refused as `DUPLICATE_MODULE`;
9. `listen()` over a real socket, on an application of its own so the rest of the
   file keeps its own;
10. the `aponia build` consequence, in the same file for the process-global
    reason above: a module whose `imports` name a registration is declined, the
    artifact holds nothing for it, the application boots and traces anyway
    because the platform lowers the root from its decorators, and a module the
    build _does_ lower is traced only when it imports the registration.

The Vite+ lane mirrors the contract and the observable answers. It must not call
`listen()`: the lane runs on Node, where Elysia 2 has no adapter and a listen
throws. `application.handle` answers without opening a port, and the spans and
the response are recorded either way, so everything this package promises is
observable there. Cases that need a real port belong in the Bun lane.
