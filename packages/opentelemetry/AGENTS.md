# @aponiajs/opentelemetry — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The module an application imports to trace its routes, and the validated
configuration the policy is read from. Tracing is a neutral
`RequestLifecycleHook`: one server span per request, active for the handler, the
guards, and every service they call, built on `@opentelemetry/api` and started
with `@opentelemetry/sdk-node`. It is a leaf — nothing in the framework depends
on it.

| Domain        | Owns                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------- |
| `module/`     | `OpentelemetryModule.forRoot`, `OpentelemetryModuleOptions`, and the `DynamicModule` one registration lowers into |
| `tracing/`    | the neutral hook, the guard that reads a configuration value into the policy, and the shutdown provider           |
| `interfaces/` | The module and tracing contracts                                                                                  |

`src/index.ts` is the only public barrel. Type-only contracts live in
`interfaces/<name>.interface.ts`.

## Invariants

- **This package is not a tracing backend and ships no exporter, and no claim in
  it may imply one.** No OTLP client, no vendor client, no collector
  configuration, no storage, and no query surface. The span processors, the
  exporters, and the instrumentations are the application's, passed to `forRoot`
  because they are live objects a configuration cannot carry. The README leads
  with module registration and states the boundary in its final Native escape
  hatch section, and `src/module/opentelemetry-module.spec.ts` pins the barrel to a
  single value export so an exporter cannot arrive quietly.
- **The configuration carries data only, and the boundary is stated rather than
  widened.** `OpentelemetryConfiguration` has four fields, and the `NodeSDK`
  configuration is deliberately not the configuration type.
  `test/opentelemetry.conformance.ts` pins `keyof OpentelemetryConfiguration`
  field by field and pins that `serviceName`, `recordBody`,
  `headersToSpanAttributes`, and `spanUrlRedaction` are absent from the runtime
  options; a widening fails `bun run check` instead.
- **`serviceName` is required, and that is this package's own default and not
  the SDK's.** A `NodeSDK` resource without a name is unnamed, which is a value
  every service would have to overwrite to be told apart in a trace. An empty
  string is refused as well, because `serviceName: ""` would reach the resource as
  an empty name. Do not restate a library default as though it were this
  package's.
- **The one cross-field rule is about the request side, and it is narrow on
  purpose.** `recordBody` recording the request together with
  `headersToSpanAttributes.request` naming `authorization`,
  `proxy-authorization`, `cookie`, or `"*"` puts a live credential on the same
  exported span, so the pair is refused at boot. Recording a _response_ body
  beside captured response headers is accepted. `src/module/opentelemetry-module.spec.ts`
  carries a case on each side of the boundary, so loosening or tightening the
  rule has to change the README with it.
- **Every refusal of the configuration is `AponiaError` with
  `INVALID_CONFIGURATION_VALUE` and `{ configuration, issues }`.** The shape a
  schema refusal already carries, so a caller reads one contract whichever half
  refused. The issue list is total: every field that fails is reported rather
  than the first.
- **The `NodeSDK` is process-global, the first registration in a process owns it,
  and `application.close()` does not stop it.** The hook constructs a `NodeSDK`
  and calls `start()`, guarded by `shouldStartNodeSDK`; the SDK lives in a
  closure no lifecycle hook reaches, so a second registration observes the first
  one's provider.
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
  flushes then shuts them down in `onApplicationShutdown`; an application-owned
  SDK handle passed as `sdk` is flushed and shut down after them. It does not
  reach a processor the application built but did not pass to `forRoot`, and it
  does not reach an exporter `NodeSDK` the application neither owns nor passes;
  the README states both limits rather than implying a full teardown. The stop
  drops its handles, so a second `close()` stops nothing a second time — pinned,
  because a processor shut down twice would break another registration's SDK.
- **No tracing value can be exported beside the module.** The hook is built from
  a value the container resolves, so it exists only inside a boot. An application
  that needs the descriptor artifact untouched mounts the raw
  `@elysia/opentelemetry` plugin through `AponiaApplicationOptions.plugins` and
  gives up the module and its validation.
- **The module provides the configuration it consumes and exports it.** The
  module is registered by the application that also declares the configuration, so
  a design where the application declares the token and the module imports it
  would be a module cycle. `source` exists because `provideConfiguration` accepts
  it: a test validates a literal rather than mutating the process environment, and
  no case in either lane touches `process.env`.
- **The runtime options are derived from the SDK's own options type, not
  restated.** `OpentelemetryRuntimeOptions` is a `Partial<NodeSDKConfiguration>`
  with the fields the configuration owns removed, so a release of the SDK that
  adds an option is accepted here without this package changing. Spreading the
  configuration _after_ the
  runtime options in `buildOpentelemetryPlugin` is what makes the validated value
  authoritative.

## Tests

`src/**/*.spec.ts` under Bun, `test/*.conformance.ts` under Vite+. Both lanes
boot real applications through `AponiaFactory.create` and read real responses
through `application.handle(new Request(...))`, because what this package
promises is an answer and a recorded span and nothing less than both proves it.
No case asserts on a message string; the configuration refusals assert
`AponiaError.code` and `details.issues`.

The Bun lane owns: one server span per request, active for the handler, a guard,
and an injected service; the resource `service.name` the configuration declared;
the request method, URL, route template, status, and captured header attributes;
a guard's `403` and an unhandled `500`, each with the span status the answer
implies; body recording, header capture, and URL redaction; every configuration
refusal, including the credential-cross-field rule; and the shutdown provider,
including that a second `close()` stops nothing twice. `test/platform-parity.spec.ts`
boots the same registration on `platform-elysia`, `platform-hono`, `platform-h3`,
and the `serverless` Web Fetch handler.

The SDK is process-global, so the span assertions live in one file beside the
registration that owns the exporter, and a registration that declares no
processor starts no SDK.

The Vite+ lane mirrors the contract and the observable answers. It must not call
`listen()`: the lane runs on Node, where Elysia 2 has no adapter and a listen
throws. `application.handle` answers without opening a port, and the spans and
the response are recorded either way, so everything this package promises is
observable there. Cases that need a real port belong in the Bun lane.
