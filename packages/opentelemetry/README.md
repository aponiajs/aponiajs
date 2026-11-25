# @aponiajs/opentelemetry

```bash
bun add @aponiajs/opentelemetry
```

Trace an Aponia application's routes with OpenTelemetry, with the policy read
from a validated configuration.

## Use it

Register tracing once, with the SDK pieces the application supplies:

```ts
import { Module } from "@aponiajs/common";
import { OpentelemetryModule } from "@aponiajs/opentelemetry";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OpentelemetryConfig } from "./config.ts";

const tracing = OpentelemetryModule.forRoot({
  configuration: OpentelemetryConfig,
  spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
});

@Module({ imports: [tracing] })
export class AppModule {}
```

Handlers and services read the active span through the hook's
`getCurrentSpan()`. The application owns the exporter, the processors, and the
instrumentations; this package owns the module, the validated configuration, and
the neutral `RequestLifecycleHook` that starts the span.

## Bootstrap

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule);
await application.listen(Number(Bun.env.PORT ?? 3000));
```

## What the tracing does

Stated because the spans are what an application reads, not this package's
summary of them:

- **A request is recorded as a root span**, named for the route, with the
  policy's per-stage child spans beside it.
- **The trace context is async-local**, so a handler, a service a handler calls,
  and a guard that runs before it all see the request's span through
  `getCurrentSpan()`. This is measured in both test lanes rather than asserted
  from documentation: each of the three reads the current span and reports
  whether it found one.
- **A refusal is recorded, and the root span is not marked failed.** A guard that
  throws `httpErrors.forbidden(...)` produces the platform's `403`
  `application/problem+json` answer, and the hook adds an `Error` child span
  for it; the root span for the route is left `UNSET` rather than `ERROR`.
- **An unhandled failure is marked failed.** A handler that throws produces the
  platform's `500` Problem Details answer — which never carries the thrown
  message, a stack, or a cause — and the hook sets that root span to `ERROR`
  with an `exception` event.

## One registration per process

**This is the sharpest limit in the package.**
The hook constructs a `NodeSDK` and calls `start()` on it, and `start()` sets the
process-global tracer provider. The hook checks `shouldStartNodeSDK` first, so
**the first registration in a process starts the SDK and every later one is
inert**.

Measured, in `src/module/opentelemetry-module.spec.ts`: a second application, with its
own `serviceName` and its own span processor, mounts, answers, and produces
spans — through the **first** registration's processor, carrying the **first**
registration's `service.name`, while the second registration's processor receives
nothing at all.

Two further facts follow, and both are measured rather than inferred:

- **A distinct `key` does not buy a second tracer.** The `NodeSDK` is
  process-global and the first registration wins, so two registrations are two
  graph nodes and one tracer, however different their configurations are.
- **`application.close()` does not stop the SDK.** The hook keeps its `NodeSDK`
  in a closure, so no lifecycle hook reaches it, and an application closed in a
  test process still traces the next application's requests.

What this package does about it: it states the limit here, and it stops what it
can. The module provides one provider that owns the span processors you declared
and flushes then shuts them down in `onApplicationShutdown` — so a processor you
handed over is flushed and stopped when the application closes, whether or not
the application ever called `listen()`. An application that constructs and
starts its own SDK passes the handle as `sdk`; the provider calls its
`forceFlush()` and `shutdown()` after the processors. Two things remain outside
that reach and are not implied to be inside it: a processor you built but did
not pass to `forRoot`, and an exporter `NodeSDK` the application neither owns
nor passes.

`AponiaApplicationOptions.plugins` is not a way around this. A raw tracing plugin
mounted there starts its own process-global SDK with the same first-call-wins
rule, and nothing about this package's registration changes.

## Declaring a policy

```ts
import { Module, defineConfiguration } from "@aponiajs/common";
import { OpentelemetryModule } from "@aponiajs/opentelemetry";
import { z } from "zod";

export const OpentelemetryConfig = defineConfiguration(
  z
    .object({
      OTEL_SERVICE_NAME: z.string().min(1),
      OTEL_RECORD_BODY: z.enum(["true", "false"]).default("false"),
    })
    .transform(({ OTEL_SERVICE_NAME, OTEL_RECORD_BODY }) => ({
      serviceName: OTEL_SERVICE_NAME,
      recordBody: OTEL_RECORD_BODY === "true",
    })),
  "opentelemetry",
);

const tracing = OpentelemetryModule.forRoot({ configuration: OpentelemetryConfig });

@Module({ imports: [tracing], controllers: [WidgetsController] })
export class AppModule {}
```

`key` defaults to `"opentelemetry"`, and two registrations sharing one are refused
as `DUPLICATE_MODULE`.

### The configuration

Four fields, all of them data an environment can state:

| Field                     | Default when omitted   | Meaning                                        |
| ------------------------- | ---------------------- | ---------------------------------------------- |
| `serviceName`             | **required**           | `service.name` on every exported span          |
| `recordBody`              | `false`                | Record request and/or response bodies on spans |
| `headersToSpanAttributes` | no headers             | Header names captured as attributes, by side   |
| `spanUrlRedaction`        | `userinfo` and its set | How server-side URL redaction is configured    |

`serviceName` is required because an unnamed resource cannot be told apart,
which is a name every service would have to overwrite to be told apart in a
trace. Refusing the omitted value removes the default rather than inheriting it.
An empty string is refused too, because `serviceName: ""` would reach the
resource as an empty name.

### What a configuration cannot carry

The module also accepts **span processors**, **instrumentations**, a
**context manager**, a **`checkIfShouldTrace` predicate**, and the rest of the
`NodeSDK` options — exporters, resources, samplers, and so on. All of them are
code or live objects: no environment variable holds a `BatchSpanProcessor`, and
this package's configuration has no field for one. They are properties of
`forRoot` instead, which is why the call above passes `spanProcessors` beside
`configuration`.

The runtime options are `NodeSDK`'s own options with the fields the configuration owns
configuration-owned fields removed, so there is exactly one place to set each
one: a caller cannot write a service name in two places and get whichever the
spread order happened to favor.

## Errors

`AponiaError` with `INVALID_CONFIGURATION_VALUE`, carrying `{ configuration,
issues }`, when the schema rejects the value, when a field is the wrong shape,
when `serviceName` is missing or empty, or when the cross-field rule below is
tripped. The issue list is total: every field that fails is reported at once, so
one boot names every field to fix.

### The one cross-field rule

**A recorded request body cannot be combined with a request header that carries
credentials.** `recordBody: { request: true }` puts the request body on the span;
`headersToSpanAttributes.request` naming `authorization`, `proxy-authorization`,
or `cookie` puts a live credential on the same span, and `"*"` captures all of
them. Both leave the process. The pair is refused at boot:

```text
"recordBody" cannot record the request while "headersToSpanAttributes.request" captures "authorization": both are recorded on the exported span
```

The rule is deliberately narrow. It is about the request side only — recording a
response body beside captured response headers is accepted — and about the three
header names a proxy, a browser, or a client library actually uses for a
credential. A longer list would be guessing at application-specific names, and a
rule a reader cannot predict is worse than the narrow rule it replaced.

`spanUrlRedaction: false` is accepted, and is the one setting this package cannot
make safe: `false` records URLs raw, which can leak
secrets carried in a query string or in credentials. It is a deliberate choice
for a local environment, and it is stated rather than silently enabled.

## `aponia build`

A registration is a `DynamicModule`, not a `@Module()` class the build can read
from source, so a module whose `imports` name one is declined — the build prints
`DECLINED module AppModule` — and the descriptor artifact holds nothing for it.
The application still boots: the platform lowers such a root from its decorators
and the tracing still serves. What the decline costs is the lowering, not the
tracing. `src/module/opentelemetry-module.spec.ts` pins all three halves of that,
including the contrast with a module the build does lower.

**No tracing value can be exported beside this module.** The hook is built from
a configuration the container resolves, so it exists only inside a boot. An
application that would rather keep the descriptor artifact untouched mounts the
raw `@elysia/opentelemetry` plugin through `AponiaApplicationOptions.plugins`
and gives up the module and its validation.

## OpenTelemetry and the request-context proposal

This package and the framework's request-context design are independent, and
neither replaces the other.

The spec designs an Aponia-owned `AsyncLocalStorage` store holding a
`RequestContextService.current()` for a correlation id and application-defined
request data. It records that Elysia's async-local context already propagates,
and it **explicitly rejects `traceparent` propagation** as its mechanism. Nothing
in it reads or writes the OpenTelemetry API, and nothing here reads or writes a
request-context store.

What the two do share is the propagation layer: both rely on the same async-local
context reaching handlers, providers, and guards. This package's tests verify
that for the trace context — a handler, a service, and a guard each report whether
`getCurrentSpan()` found a span — and the spec's own measurements state it for
its store.

Where the spec's design would add something this package does not: a store that
survives a long-lived `handle` caller, one correlation id usable without an
exported span, and request data an application defines rather than attributes
OpenTelemetry defines. Where this package adds something the spec does not: the
spans themselves, and their export.

## Errors, footnotes, and links

- [Package guide](./AGENTS.md) — the invariants this package is held to.
- [`@elysia/opentelemetry` on npm](https://www.npmjs.com/package/@elysia/opentelemetry)
- [Plugin package authoring](../../docs/tooling/plugin-packages.md)
- [Published packages](../../docs/reference/packages.md)

## Native escape hatch

The module above is the supported path. An application that wants its own tracing can wire `@opentelemetry/api` directly.

**This package is not a tracing backend, and it ships no exporter.** No OTLP
client, no Jaeger or Tempo or Honeycomb client, no collector configuration, no
storage, and no query surface. It records spans and hands them to whatever you
gave it.

**It also supplies no span processors, no exporters, and no instrumentations.**
Those are yours, and you pass them in:

```ts
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";

const tracing = OpentelemetryModule.forRoot({
  configuration: OpentelemetryConfig,
  spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
});
```

What this package contributes is exactly two things:

- a module the tracing hook is declared in, so it is a node in the compiled
  graph and is initialized in the boot's instance-loading pass;
- a validated configuration the policy comes from, so a missing service name, a
  wrong-typed body setting, or a request body recorded beside a credential-bearing
  header is a refused boot with a code and an issue list, rather than a span
  nobody inspects.

Everything else is this package's: the root span, the per-stage spans, the span
attributes, the propagation, and the `NodeSDK` startup. An application that
needs a different tracing implementation mounts
[`@elysia/opentelemetry`](https://www.npmjs.com/package/@elysia/opentelemetry)
through `AponiaApplicationOptions.plugins` and keeps its own configuration; that
is not a way to use this package.
