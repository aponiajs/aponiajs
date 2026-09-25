# AponiaJS AOT and Pseudo-JIT Feasibility Research

- Generated: 2026-07-28
- Re-measured: 2026-09-25
- Question type: technical feasibility and performance ceiling
- Confidence: high for the warmed steady-state ceiling; medium for startup projections
- Scope: a single process on the same hardware, runtime, and workloads

## Implementation status

The current working implementation now provides:

- immutable decorated-route plans compiled during module lowering;
- cached fixed-arity controller invokers with direct context-property access and
  no request-time argument arrays or descriptor traversal;
- separate synchronous and Promise-capable handler shapes, using emitted
  decorator return metadata, and never from the handler's own source;
- direct root registration for decorated controllers and
  `defineElysiaController(..., { registerRoutes })` descriptors, while retaining
  `buildPlugin` as the native compatibility path;
- explicit `elysia.aot` and `elysia.precompile` bootstrap policy; and
- Bun and Vite+ source-shape, semantics, plugin, schema, descriptor, and
  compatibility tests.

A general build-time TypeScript source emitter, semantic-island selector, route
clustering, and PGO remain future work. Final throughput, latency, allocation,
startup, and memory measurements are intentionally left to the pinned external
benchmark run; no implementation claim should be derived from code shape alone.

### Re-measurement, 2026-09-25

The compiled invokers closed the gap this document was written to open. Measured
on Apple Silicon with Bun 1.3.14 and the Elysia 1.4.29 the workspace pinned at
the time, over 200 keep-alive connections, reporting the `median` of five
interleaved three-second rounds:

| Workload                   |  Elysia | AponiaJS | AponiaJS / Elysia |
| -------------------------- | ------: | -------: | ----------------: |
| Ping `GET /`               | 247,575 |  238,908 |             96.5% |
| Query `GET /id/:id?name=`  | 232,653 |  229,054 |             98.5% |
| Body `POST /json` + schema | 192,039 |  191,370 |             99.7% |

`AponiaFactory.create` costs 1–3 ms over raw Elysia bootstrap.

The baseline is Elysia under its default compilation policy. Every workload
therefore reaches or exceeds the 95% floor this document set as its acceptance
range. The remaining Ping difference is consistent with the one extra call frame
the compiled invoker needs to reach a controller method through
`handler.call(instance, ...)`; that frame is what routing to an arbitrary method
costs, and removing it would mean giving up controller methods entirely.

Two caveats keep this from being a published claim. The run used a local harness
rather than the pinned upstream benchmark, and it compares against default
Elysia rather than an explicitly labelled AOT build — the supplied results below
show those differ by 0.05–1.216%, so the comparison is close, but the pinned
harness rerun is still what a published number requires.

The workspace subsequently moved its Elysia pin to `^1.4.30`, a patch release
that leaves this comparison unchanged; re-run the numbers if a future bump
touches the request path.

The practical conclusion is that warmed throughput is no longer the open
problem. Optimization effort should move to startup and deployment work, and to
replacing the `Function()`-based invoker in
`packages/platform-elysia/src/routing/route-compiler.ts`, which is fragile for
reasons other than speed.

## Executive conclusion

With Bun and Elysia retained as the HTTP substrate, the hard ceiling measured by
the supplied benchmark is Elysia AOT at **68,334.31 average requests per
second**. A realistic AponiaJS target is 95–98% of that substrate:
**64,917.59–66,967.62 requests per second**, or **72.7–78.2% faster** than the
original AponiaJS result of 37,585.775 requests per second.

There is no hardware-independent maximum. The current public upstream benchmark,
measured on an Intel Core i7-13700K with Bun 1.3.14, reports Elysia AOT at
209,198.18 average requests per second. On that machine, the equivalent 95–98%
target would be approximately 198,738–205,014 requests per second.

Pseudo-JIT specialization is the mechanism most likely to produce a large
steady-state throughput gain. Once it brings AponiaJS close to direct Elysia,
build-time AOT should primarily improve cold startup, first-hit latency, bundle
loading, and deployment predictability. It is unlikely to add a large warmed
throughput gain by itself.

## Supplied benchmark evidence

| Workload |   AponiaJS | Elysia AOT | AponiaJS / Elysia AOT |
| -------- | ---------: | ---------: | --------------------: |
| Ping     |  49,432.10 | 120,108.28 |                 41.2% |
| Query    |  55,499.38 |  79,669.33 |                 69.7% |
| Body     |  44,911.91 |  73,032.16 |                 61.5% |
| Video    |     499.71 |     527.47 |                 94.7% |
| Average  | 37,585.775 |  68,334.31 |                 55.0% |

The same-stack hard upper-bound speedup is:

```text
68,334.31 / 37,585.775 = 1.82x
```

This is an 81.8% maximum improvement if AponiaJS could remove all measurable
framework overhead while retaining identical Elysia behavior.

The benchmark's `Average` is descriptive rather than a normalized aggregate.
The upstream protocol uses a 14.1 MB video file at concurrency 10, while the
core HTTP routes run at concurrency 500. Per-workload results must therefore
remain the primary evidence.

## How the runtime behaves

Elysia's pseudo-JIT reads handler source through `Function.prototype.toString`,
uses Sucrose to determine which context properties a handler needs, and
generates a tailored handler with `new Function`. This lets it omit unused
parsing and dispatch work and use Bun's native-route fast paths where possible.
See [Elysia's JIT compiler internals](https://elysiajs.com/internal/jit-compiler).

In the supplied results, Elysia AOT is only 1.216% faster than normal Elysia. In
the current public upstream result, Elysia AOT at 209,198.18 and regular Elysia
at 209,096.655 differ by only 0.049%. These warmed differences are small enough
to overlap normal benchmark noise. Eager compilation is therefore more
important for cold routes and startup work placement than for peak warmed
throughput. See the
[upstream Bun HTTP framework benchmark](https://github.com/SaltyAom/bun-http-framework-benchmark).

Inspection of the locally installed Elysia 1.4.29 dependency confirms that
`aot` defaults to enabled and that `precompile` is a separate option. AponiaJS
can expose or select these capabilities, but merely renaming Elysia's existing
compilation as an AponiaJS AOT mode would not remove AponiaJS-specific dispatch
overhead.

JavaScriptCore executes JavaScript through several tiers: LLInt, Baseline JIT,
DFG, and FTL. Bun build-time bytecode caching skips parsing work, but it does not
turn application JavaScript into permanently ahead-of-time native machine code;
execution still proceeds through the interpreter and JIT tiers. See
[JavaScriptCore's execution model](https://docs.webkit.org/Deep%20Dive/JSC/JavaScriptCore.html)
and [Bun bytecode documentation](https://bun.com/docs/bundler/bytecode).

Within AponiaJS, module graph compilation, dependency resolution, and controller
construction occur during bootstrap in
`packages/platform-elysia/src/application/aponia-factory.ts`. The
request-critical boundary is the generated invoker in
`packages/platform-elysia/src/routing/route-compiler.ts`.
Optimization should therefore focus on generating a direct, stable invoker at
bootstrap or build time rather than repeatedly optimizing graph and container
work that is not on the hot path.

## Local empirical evidence

Superseded by the 2026-09-25 re-measurement above; the figures below record the
experiment that motivated the compiled invoker and predate it. Ping in
particular has since moved from 90.4% to 96.5%.

A controlled experiment with a specialized compiled parameter binder reached
approximately 97.2% of direct Elysia throughput across Ping, Query, and Body
after warm-up.

| Variant                     |   Ping |  Query |   Body | Three-route average |
| --------------------------- | -----: | -----: | -----: | ------------------: |
| Original decorated dispatch | 53,836 | 41,363 | 33,632 |              42,944 |
| Specialized dispatch        | 58,033 | 58,767 | 50,242 |              55,681 |

The specialized path improved the three-route average by 29.7%. In a repeated
six-second run, it averaged 55,248 requests per second against direct Elysia at
56,853, or 97.2% of the substrate. Query and Body were within benchmark noise;
Ping remained at approximately 90.4%, making it the main remaining hot-path
investigation.

These measurements establish feasibility, not a replacement for the supplied
benchmark table. The exact AponiaJS adapter used by that upstream table is not
retained in the current workspace and the public harness has since changed.
Before publishing a claim, rerun a pinned copy of the exact harness, workloads,
Bun version, Elysia version, and machine configuration.

## Theoretical targets on the supplied machine

| Scenario                     | Average requests/s | Gain over supplied AponiaJS |
| ---------------------------- | -----------------: | --------------------------: |
| Supplied AponiaJS baseline   |         37,585.775 |                           — |
| 90% of Elysia AOT            |         61,500.879 |                      +63.6% |
| 95% of Elysia AOT            |         64,917.595 |                      +72.7% |
| 98% of Elysia AOT            |         66,967.624 |                      +78.2% |
| 100% same-stack hard ceiling |         68,334.310 |                      +81.8% |

### Per-workload acceptance range

| Workload |  95% target |  98% target | Same-stack ceiling |
| -------- | ----------: | ----------: | -----------------: |
| Ping     | 114,102.866 | 117,706.114 |        120,108.280 |
| Query    |  75,685.864 |  78,075.943 |         79,669.330 |
| Body     |  69,380.552 |  71,571.517 |         73,032.160 |
| Video    |     501.097 |     516.921 |            527.470 |
| Average  |  64,917.595 |  66,967.624 |         68,334.310 |

The 100% value is a substrate ceiling, not a credible engineering commitment.
A framework must retain public contracts, controller calls, dependency
injection, parameter decorators, hooks, error behavior, and native escape
hatches. The 95% target is defensible; 98% is an ambitious stretch target.

## Technique assessment

| Technique                                        | Expected warmed effect                          | Other effect                                 | Feasibility                   |
| ------------------------------------------------ | ----------------------------------------------- | -------------------------------------------- | ----------------------------- |
| Bootstrap pseudo-JIT route and parameter invoker | Large when it removes generic dispatch          | Small compile cost during bootstrap          | High                          |
| Elysia route precompilation                      | Approximately 0–1% once warm                    | Removes first-route compilation              | High                          |
| Build-time module, DI, and route manifest        | Inferred 0–3% after pseudo-JIT                  | Potentially substantial startup reduction    | Medium-high                   |
| Bun bytecode cache                               | Near zero warmed throughput effect              | Reduces source parsing and load time         | High, but tied to Bun version |
| Static-response specialization                   | Large for literal Ping-like handlers only       | Narrow applicability                         | Medium                        |
| uWebSockets or another native adapter            | Could exceed the Elysia ceiling                 | Different runtime semantics and tradeoffs    | Outside AOT scope             |
| True native machine-code AOT                     | Not available as a normal Bun framework feature | Would require native adapter or runtime work | Low within current scope      |

The supplied uWebSockets result is 85,863.89 average requests per second, and
the current public upstream result is approximately 263,814. That is evidence
that a different HTTP substrate can raise the ceiling. It is not evidence that
AOT alone can make the Elysia adapter reach that result. The supplied
uWebSockets video result is also much lower, so it is not a universal win.

## Recommended architecture

Use a hybrid design that keeps the current descriptor-based public architecture:

1. A default bootstrap pseudo-JIT mode should generate specialized route
   invokers with direct context-property access, cached route factories, stable
   monomorphic shapes, and optional Elysia precompilation for production.
2. An opt-in build-time AOT mode should emit a versioned immutable manifest for
   the module graph, provider factories, controller dependencies, route
   descriptors, and invoker source.
3. The runtime should verify the manifest's framework version, Elysia version,
   Bun compatibility, and content hash, then fall back safely to descriptor
   compilation and pseudo-JIT when it is missing or stale.
4. Both paths must preserve hand-written descriptors, decorators,
   `configureNative`, plugin modules, and native Elysia escape hatches.

Use precise terminology in the public API and documentation:

- **Framework source generation** for build-time generated invokers and
  manifests.
- **Route precompilation** for eager Elysia handler compilation.
- **Bytecode caching** for Bun's parse-time cache.
- **JSC JIT** for JavaScriptCore's runtime machine-code tiers.

Do not describe Bun `--compile` or bytecode caching as true native AOT.

### Build-time route codegen

The measurements above rule throughput out as a reason to generate code. AponiaJS
already matches a hand-written method-dispatch closure, which is the floor for any
framework whose handlers are controller methods, so a faster compiler does not
exist to be written. The case for codegen is correctness and deployment instead:

- the compiled invoker is built with `new Function`, which any Content Security
  Policy without `unsafe-eval` blocks;
- whether a handler is async, and whether it wants the context at all, is inferred
  by scanning `Function.prototype.toString` output with regular expressions, so
  minification, bundling, `bind`, and class-field arrows can each change the
  answer;
- both run at bootstrap, on every cold start, in every process.

Emitting the invoker as source removes all three. Stage it so each step ships on
its own:

1. **Introspection.** `@aponiajs/platform-elysia` projects a root module into
   frozen, JSON-serializable data. It generates nothing; it is the read model the
   later stages, the inspection script, and the package tooling all share.
2. **Route codegen.** A build step imports the application's root module, runs the
   existing compiler, and emits a source file whose route registration is written
   as literal functions. This deletes `new Function` and every source heuristic
   from the request path while decorators still run.
3. **Descriptor codegen.** The same step also emits explicit `defineModule` and
   `defineElysiaController` calls, so `reflect-metadata` leaves the production
   path. Decorators stay the authoring surface in source.
4. **Bun plugin.** Stages 2 and 3 run from the bundler instead of a separate
   command.

The generated artifact is **source, not a serialized manifest**: it imports the
application's own classes and validators, so it cannot drift from them, and Elysia
can still read each generated handler's source for its own compilation. Reading a
handler's source stays acceptable because the generated functions are literal and
stable; the fragile part was inferring bindings from source that the author wrote
for other reasons.

Keep the verification contract from the recommendation above. The generated file
carries the framework version, the Elysia version, and a content hash; the runtime
refuses a stale artifact and compiles from descriptors instead. Both authoring
paths, `configureNative`, plugin modules, and the native escape hatches must
behave identically with and without the artifact.

Acceptance for each stage:

- an application with and without the generated artifact answers identically,
  including validation failures, error responses, and gateway behaviour;
- no generated path calls `new Function` or infers a binding from an author's
  source;
- a stale or mismatched artifact is refused and the descriptor path produces the
  same route table;
- measured throughput stays inside the 95% floor with the artifact in place.

Stage 2's analyzer is already in place:
`packages/cli/src/generation/controller-routes.ts` reads a controller file with
`ts-morph` and returns its routes, paths, parameter bindings, and whether each
handler is Promise-capable. The emitter is not written yet, and the question
that held it up now has an answer.

An emitted invoker passes context values into a handler the application typed,
so `instance.create(context.body)` has to typecheck against whatever `create`
declared, and the analyzer reports only each binding's _kind_ and _property_, not
the declared type of the parameter it fills. Typing the emitted context as
`unknown` fails under this repository's strict settings, and casting the value at
the call site is the untyped escape the style rules forbid.

**Type each bound value from the handler's own signature.** The emitted module
imports the controller it is generating for and reads the parameter type back
out of it:

```ts
import type { UsersController } from "./users.controller.ts";

type CreateContext = { readonly body: Parameters<UsersController["create"]>[0] };

export const controllerInvokers = Object.freeze({
  UsersController: (instance: UsersController) =>
    Object.freeze([
      (context: CreateContext) => {
        const result = instance.create(context.body);
        return result;
      },
    ]),
});
```

This needs no analyzer change, no second import for the parameter's type, and no
cast: `Parameters<...>[index]` is the application's own annotation, resolved by
the type checker rather than by source text, so aliases, unions, and generics
follow for free. The one property it does not give is the shape of the container
the value is read from — `context.params`, `context.query` — which the emitter
declares itself from the binding kinds the analyzer already reports. `@Ctx()`,
`@Req()`, `@Set()`, and `@Status()` bind a platform value rather than a field, so
their parameters keep the platform's own type.

The emitted JavaScript is unchanged by any of this; the annotations exist so the
generated module compiles against the application that produced it.

Generated invokers must keep the synchronous and Promise-capable shapes the
route compiler already emits. Collapsing them into one synchronous invoker looks
free and is not. Elysia awaits a returned Promise when it builds the response, so
the response body is correct either way — measured across both handler kinds the
synchronous invoker was never slower (257,907 to 263,379 requests per second over
four combinations). What breaks is the lifecycle: with a synchronous invoker
`onAfterHandle` observes the raw `Promise` instead of the resolved value, because
nothing awaited it before the hook ran. `tests/route-dispatch.test.ts` asserts
the resolved value, and it fails on the collapsed shape. The split costs about
1.4% on a route whose handler is synchronous but classified Promise-capable,
which is the price of correct hook semantics.

## Acceptance and benchmarking gates

- Each of Ping, Query, Body, and Video should reach at least 95% of direct Elysia
  AOT under the identical harness; 98% is the stretch target. The 2026-09-25
  re-measurement reaches 96.5%, 98.5%, and 99.7% on Ping, Query, and Body, but
  under a local harness and without a Video workload, so the gate is met on
  evidence rather than closed.
- Responses must preserve status, body, headers, validation, dynamic query and
  parameter extraction, error behavior, and streamed video behavior.
- The hot path should not allocate an AponiaJS argument array or invoke a
  generic context mapper for every request.
- A provisional startup target is 55–70 ms on the supplied machine. This is a
  hypothesis and must be measured before becoming a public claim.
- Run randomized repeated trials with explicit warm-up and report confidence
  intervals, not only the best run.
- Pin Bun, Elysia, benchmark harness commits, CPU governor, core affinity, and
  machine configuration.
- Record throughput, p50/p95/p99 latency, CPU utilization, allocations, RSS,
  cold first-hit latency, startup time, and bundle size.
- Use Bombardier, Oha, or Bun's recommended HTTP benchmark tooling, and use
  `bun --cpu-prof-md` to validate that optimization targets measured hot code.
  See [Bun's benchmarking guide](https://bun.sh/docs/project/benchmarking).

If build-time AOT improves warmed throughput by less than 2% after pseudo-JIT is
enabled, position it as a startup and deployment feature rather than a
throughput mode.

## Monitoring rule

The ceiling must be remeasured whenever Bun, JavaScriptCore, Elysia, compiler
settings, or the benchmark harness changes, and on a regular scheduled cadence.
There is no permanent universal requests-per-second maximum.

## Sources

- [Elysia JIT compiler internals](https://elysiajs.com/internal/jit-compiler)
- [Bun HTTP framework benchmark](https://github.com/SaltyAom/bun-http-framework-benchmark)
- [JavaScriptCore execution tiers](https://docs.webkit.org/Deep%20Dive/JSC/JavaScriptCore.html)
- [Bun bytecode documentation](https://bun.com/docs/bundler/bytecode)
- [Bun benchmarking guide](https://bun.sh/docs/project/benchmarking)
