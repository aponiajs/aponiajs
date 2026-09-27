# Devtools completeness — closing the blind spots

Status: design. Supersedes the parts of
[`2026-09-26-aponia-devtools-design.md`](./2026-09-26-aponia-devtools-design.md) it
names, and leaves the rest of that document standing.

## Why this document

`@aponiajs/devtools` shipped with sixteen stated limitations. They are recorded in
`docs/devtools.md`, the package README, and `packages/devtools/AGENTS.md`, and
each was accepted deliberately. Reviewing them together surfaced the thing the
individual decisions hid: **most of them are not costs, they are silences.** A
debugging tool that omits a fact is usable. One that answers a question with a
shape that reads as a different answer is not — and three of the sixteen do
exactly that.

This document closes ten of the sixteen. Three are left deliberately — a
class-field-adjacent guess, making the build execute application code, and a
response body this package cannot observe — and three are not limitations at all:
the record being per boot, `onStart` needing `listen()`, and boot facts not
changing are each the correct behaviour, and changing them would make the tool
wrong rather than fuller.

The remaining gap — an application's providers logging through their own logger,
which `/logs` cannot see — is **not** addressed here. It needs an injectable
logger, which changes a documented `@aponiajs/core` invariant and is specified
separately as the logging-seam work.

## The governing rule

Every change below is chosen by one test, which is the test the package already
applies to itself:

> **An absence is true in every configuration; a false positive is true in one.**

Where a fact cannot be published, the endpoint states the absence rather than
publishing a shape that reads as a different fact. Where a fact can now be
published, it is published exactly as observed and never inferred.

The one place this document changes an existing answer is `/requests`, and it
changes it because the current answer violates the rule: a request that arrived
and was never answered produces **no entry**, which is indistinguishable from a
request that never arrived.

## What changes

| #   | Limitation today                                                    | Change                                                                                                       |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 3   | A partly patched logger's stream does not name the levels it missed | Publish the levels the tap reached; patch every level rather than stopping at the first refusal              |
| 4   | A class-field interceptor half is invisible to `/flow`              | Record each interceptor class's halves at mount, where the instance exists                                   |
| 6   | A request answered by a plugin's early `Response` leaves no entry   | Write the entry at arrival; supersede it at completion                                                       |
| 7   | A request the runtime never reached is not recorded                 | Follows from 6 for the plugin-refusal case; the server-rejected case stays unrecorded                        |
| 8   | `durationMs` includes this package's own reads                      | Take the closing stamp before the reads it currently encloses                                                |
| 9   | Response bodies are never captured                                  | **Withdrawn — see below.** The bytes the client received are not observable from where the record is written |
| 10  | `error` is never the exception                                      | The platform's own mapping records the exception it already sees                                             |
| 14  | A stale invoker artifact is served silently                         | A structural signature over the facts both sides compute identically                                         |
| 15a | `/aot` caches a failure until restart                               | Do not cache a failure                                                                                       |
| 15b | `/aot` mirrors the build's rules by hand                            | Share one pure analyzer with the CLI                                                                         |
| 16a | A build that emits nothing leaves a stale artifact silently         | Warn at build, naming the cause and the escape                                                               |

Limitations **not** changed, with reasons in the last section: the callback
route's missing handler name (5), lowering a call-expression import out of user
code (16b), and the three that are correct behaviour (11, 12, 13).

## Contract changes

Three surfaces change shape. Each is named here because a consumer outside this
repository reads them.

### 1. The wire contract moves to `2`

`devtoolsContractVersion` is one version for the whole surface
(`endpoints/payloads.types.ts:33`), so `/requests`' breaking change moves every
endpoint's `contract` to `2`. A reader that checks `contract` first — which the
payload doc says it must — refuses `1` and knows why.

`RequestRecord` gains and changes fields:

```ts
interface RequestRecord {
  /** The request this entry describes, stable across every entry for it. */
  readonly id: number;
  readonly method: string;
  readonly path: string;
  readonly url: string;
  /** The status the client received, or null when no answer was observed. */
  readonly status: number | null;
  /** The duration observed, or null when no answer was observed. */
  readonly durationMs: number | null;
  readonly timestamp: string;
  readonly error?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}
```

`id` is the arrival ordinal within the record — a counter this package owns, not
a UUID, because its only job is to let a consumer group one request's entries.
It is stable within one boot and never a cross-boot identity, for the same reason
the cursor is not.

### 2. The invoker artifact carries the emitted plan facts

`AponiaInvokerArtifact` gains a `plans` field: for each controller token it
covers, the facts the emitter decided. An artifact from this release always
carries it — the framework stamp already guarantees a same-release artifact — so
an artifact with a matching framework stamp and no `plans` is malformed and is
refused by the same rule that refuses a missing invoker map.

### 3. The diagnostics record gains one field

`AponiaApplicationDiagnostics` gains `interceptorHalves`, the per-class
interceptor half facts collected at mount. The record is an `@internal` seam
rather than a public contract, and devtools already reads every field
defensively, so this is additive: a reader that does not find it falls back to
the `prototype` probe it uses today.

### 4. The CLI gains one export and one result field

`@aponiajs/cli` exports a pure project analyzer — the function `generateInvokers`
already contains between its first line and its last analysis step. And
`GenerateInvokersResult` gains `descriptorEmitted: boolean`, which the emitter
already computes internally as `source === undefined` and the caller cannot
currently see.

## The changes

### 3 · A partly patched logger names the levels it reached

**Today.** `log-tap.ts:101` patches one level at a time in `recordableLevels`
order. A refusal stops the loop. If the refusal is the first assignment nothing
is installed and no endpoint is served; if it is a later one the stream is
published holding the levels reached — and the payload does not say which those
were. An absent `debug` line cannot be told from a `debug` level the tap never
patched.

**Change.** Two parts, and the second is what removes the silence:

- the loop catches each level's refusal and **continues** to the remaining
  levels, so a logger with one unwritable property loses that property rather
  than it and every level after it;
- the tap returns the levels it reached, and the `/logs` payload publishes them
  as `levels`.

The endpoint's rule is unchanged: `undefined` — no endpoint — exactly when no
level was patched. That is still the shape where a stream would announce a
silence the logger is not keeping.

`levels` is a new field on the `/logs` payload root beside `cursor` and
`entries`. It is the one fact that makes the stream readable: a consumer that
sees no `debug` line can now see whether `debug` was in the tap at all.

**Rejected.** Reporting a per-level boolean set is the same fact with more
shape; reporting the logger's own configured level filter is not this package's
to read (`LoggerService` has no notion of an enabled level, and the tap's
existing doc says so).

### 4 · `/flow` sees a class-field interceptor half

**Today.** `flow.ts:605` `declaresHalf` reads `token.prototype`. A half declared
as a field is an instance property, so the platform runs it
(`route-compiler.ts:608-610`) while the payload omits its stage. This is the one
place `/flow` is silent rather than stated.

**Change.** The platform records what it can only see where the instance exists.
`enhancer-resolver.ts:202-214` `resolveOnce` already builds a
`Map<ClassToken, TInstance>` and discards it down to its values — the pairing is
the only missing piece. Expose it, and at both resolution sites
(`application-bootstrap.ts:140` for global enhancers, `:199` per controller)
collect, per resolved interceptor class, which halves the **instance** declares.

The facts travel on the diagnostics record as `interceptorHalves`, a frozen
`ReadonlyMap<ClassToken<unknown>, InterceptorHalves>` where the value states
which halves the resolved instance declares. The map is keyed by the class token
rather than by controller or route, because a class resolved once serves every
route that names it and the fact is a property of the class, not of a mount. It
is a `Map` rather than an array because lookup happens per interceptor per route
while `/flow` assembles a payload. `/flow` reads it in place of the `prototype`
probe.

The probe stays as the fallback for a record that does not carry the field — an
older or foreign platform copy — so a reader never gets a worse answer than it
gets today.

**Why this is the right fix and not a workaround.** The decision belongs where
the instance is. Reading `prototype` is reading a different object than the one
the platform calls, which is why the answer was incomplete; the mount is the only
place both the token and the instance are in hand.

### 6 and 7 · A request that was never answered is recorded, and says so

**Today.** `arrive` stamps a `WeakMap<Request, RequestArrival>` and writes
nothing; `complete` is the only writer (`request-capture.ts:238`). A plugin that
returns a `Response` from its own `onRequest` means no later phase runs, so
`complete` never fires and the request leaves no trace.

**This is the one change that fixes a wrong answer rather than adding a fact.**
"No entry" is the record claiming a request never arrived. It arrived.

**Change.**

- `arrive` allocates the record's next arrival ordinal, writes a pending entry
  carrying `status: null` and `durationMs: null`, and keeps the ordinal in the
  stamp.
- `complete` writes a second entry with the **same** `id` and the observed
  answer.

A consumer reads the record by grouping on `id` and taking the last entry for it.
That rule is one sentence, it is stated in the payload doc, and it is the only
thing a consumer has to learn.

**Why a second entry rather than replacing the first.** The buffer's cursor is a
write count, and `since(cursor)` answers the entries written **after** it, as a
frozen copy. An entry mutated in place is therefore invisible to a poller whose
cursor is already past it: the poller holds a frozen snapshot of the pending
entry and is never told it changed. Replacing in place cannot propagate, by
construction. Appending a superseding entry keeps the cursor strictly monotonic,
which is the property `/logs` shares this buffer with, and it is the only option
that leaves both contracts intact.

**Capacity.** An answered request now consumes two slots, so the request buffer's
capacity doubles from `500` to `1000` and the window of _answered_ requests is
unchanged. Its doc states that it bounds entries rather than requests, because a
number that silently changed meaning is worse than a number that moved. The log
stream's own capacity is a separate constant and does not move.

**`capture: false` is unchanged.** `arrive` returns before stamping when the
policy records nothing, so a registration told to record nothing still serves an
empty record rather than no endpoint — the distinction the existing design draws
between the request policy and the logger option.

**What stays unrecorded.** A request the server itself rejected before Elysia saw
it. Nothing in this package runs, so there is nothing to record, and the record
still says what the application answered rather than everything that was asked.

**Documentation to reverse.** `docs/devtools.md`, the package README, and
`packages/devtools/AGENTS.md` all currently argue _for_ the old behaviour, and
the argument has to be replaced rather than deleted: the old text says the
fallback "would have to invent that status". It would not — it states the absence
— and that is the correction. The test at `requests.test.ts:368-390` is rewritten
alongside, and its name changes with the contract.

### 8 · `durationMs` measures the application, not this package

**Today.** The opening stamp is the first statement of `arrive`; the closing one
is taken after the completion hook has read the route, the status, and the parsed
body (`request-capture.ts:280`). Both of this package's own reads are inside the
measurement, so the field is not what its name suggests.

**Change.** Take the closing reading **before** the reads it currently encloses.
The field then measures from arrival to the completion hook's entry, which is
still not "the time the application spent on the route" — no hook this package
can install knows when the handler started — but it stops charging the
application for work this package did.

The doc already says the field is not route time; it is rewritten to say exactly
what it now is, because the honest description changes with the number.

**Rejected.** A global `onBeforeHandle`/`onAfterHandle` pair would measure the
route, and would also add a lifecycle stage to every route in every application
that enables devtools. The `packages/devtools/AGENTS.md` rule that a debugging
aid must not change what it observes forbids it.

### 9 · Response bodies — withdrawn

**This change was specified and then refused by probe, before any code was written. It is recorded here as a limitation that stands, with the mechanism, because the mechanism is what makes it a limitation rather than a gap someone should close later.**

**What was specified.** `capture.responseBody: boolean` (default `false`) and
`capture.responseBodyLimit`, publishing an optional `responseBody` on
`RequestRecord` through the same serializer and the same `[truncated]` /
`[unserializable]` literals the request body uses. Off by default, because
buffering every answer costs in proportion to traffic rather than to the question.

**Why it cannot be built.** The record is written from the after-response hook,
and that context exposes `responseValue`, which Elysia types as the route's
declared response — the **handler's return value**, not the bytes the client
received (`node_modules/elysia/dist/types.d.ts:547`). Projecting it is therefore
wrong for most answers rather than missing for some:

| The answer                                                       | `captureBody(context.responseValue, limit)` produces                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| a plain object, a string, or `void`                              | correct — 3 of the 9 shapes this package's own fixtures exercise                                   |
| a handler's own `Response`, Elysia's `404`, a thrown `HttpError` | **`"{}"`** — `JSON.stringify` of a `Response`, which is a false statement about the answer         |
| `@Status()(201, …)`                                              | the `{ code, response }` wrapper, a documented feature and the route the fixtures already exercise |
| the platform's unhandled-failure mapping                         | absent, though the client did receive a body                                                       |

A `Response`-aware reader does not close the gap: whether a `Response` is still
readable varies per answer with no property to distinguish the cases — one
fixture's answer is readable (`bodyUsed === false`) while its neighbours are not,
and the existing suite already documents the disturbed half
(`packages/devtools/tests/requests.test.ts`). A field present for some routes and
absent for others, with no way to tell why, is the false-completeness shape this
document exists to remove. **Present and wrong is worse than absent**, which is
the whole argument.

**The second reason, which is independent.** Every other option under `capture`
is an opt-**out**, and seven documents say so as a property of the option group
(`packages/devtools/AGENTS.md`, `devtools-module.types.ts`, `docs/devtools.md`,
the package README, and `llms.txt`). A field defaulting to `false` would be the
first opt-in and would falsify all seven at once.

**What would make it possible.** Reading the answer the client actually received
at the moment it is sent, rather than the value the handler returned — a
different hook and a different boundary from the one this record is written at.
That is a platform change evaluated on its own merit, not a devtools feature, and
this document does not take it.

### 10 · `error` carries the exception the platform already caught

**Today.** `error` is what the answer published. Two `5xx` shapes carry none: the
platform's mapping for an unhandled failure, whose `Response` is not on the
after-response context, and a `5xx` a handler built itself. The exception is
reported only in the log stream.

**Change.** The platform's default exception filter already receives the
exception — that is what it builds the Problem Details body from. It records the
message into a per-request place the after-response hook can read, and the record
folds it into `error`.

**Why the platform and not a devtools hook.** A hook contributed here would sit
in the application's error path, where precedence is registration order and the
platform's own mapping is deliberately last in every route's `error` array
(`AGENTS.md`, Errors). A second observer in that path is a second chance to
change which handler answers. The filter that already runs is the seam with no
precedence risk at all.

**What does not change.** The message, never a stack — the existing rule that a
stream a page reads is no place for a stack still holds. A `4xx` still carries no
`error`, because a `4xx` is an answer rather than a failure. And the recorded
message is the exception the platform saw, which is the application's own text
reaching a loopback-only endpoint by default — the exposure rule the `host`
option already states covers it.

### 14 · A stale invoker artifact is refused

**Today.** The artifact is stamped with the framework release and the Elysia
version. A release mismatch is refused. A **source** change — a handler's
parameter decorators edited without regenerating — is not, and the platform binds
the handler's arguments as the old source described.

**Change.** The artifact records, per controller it covers, the plan facts the
emitter decided: the property key, the method, the joined path, and each
parameter's `{ index, kind, property }`. After `compileRootModule`, in one pass
over the compiled graph and before any controller mounts, the runtime recomputes
those facts from `controller.compiledRoutes` and compares. A mismatch refuses the
artifact, whole, with one log line naming the count and the first mismatch.

**Only facts both sides compute identically may enter the signature.** Comparable:
method, joined path, property key, parameter `{ index, kind, property }`.
**Not** comparable, and excluded: schema slot values (the emitter holds source
text, the runtime holds validator objects), `capabilities` (runtime-only),
`declaredParameterCount` and promise-capability (the runtime reads emitted
metadata; the emitter uses source heuristics it documents as not equivalent), and
enhancers (the emitter does not analyze them at all). A signature containing any
of those produces refusals for controllers that did not change.

**Why a wrong signature is acceptable here.** A refusal is not an error: the
fallback is the compilation the platform would have done without the option, so
being too eager costs a cold start and one log line, never wrong behaviour. That
is what makes this change safe to make and what makes the excluded facts
acceptable to exclude.

**Where the check runs.** Today the selection happens before `compileRootModule`
(`application-bootstrap.ts:60-64`). The stated reason for resolving early is "one
log line rather than one lookup per controller" — which permits moving the check
to a **single** pass after compilation and still before the mount loop, and
forbids moving it into the loop. The check moves; the reason is preserved.

**Additive artifact data.** The artifact does not carry its emitted key set today
— invokers are lazy factories invoked per controller at mount. The emitter
already computes the set (`controller-invokers.ts:60-76`), so `plans` is
additive data rather than a new computation.

### 15a · `/aot` does not cache a failure

**Today.** The analyzer's result is cached as the promise, and a failure is
cached the same way: one row per process, but a project fixed on disk keeps
reading as unreadable until restart.

**Change.** Cache success, not failure. A failure is retried on the next poll and
reports one row each time it fails. The cost that bought the cache — a walk per
poll — is paid only while the project is genuinely broken, which is exactly when
the reader is watching.

### 15b · One analyzer, not two copies

**Today.** `packages/devtools/src/endpoints/aot.ts` re-implements six of the
build's rules by hand — the configuration file, the source root and its escape
guard, the ignore list, the sorted walk, the duplicate class name, and the import
specifier — because the command writes files and refuses a project it cannot
build. The two copies must be kept in step by hand.

**Change.** Extract `invoker-generator.ts:55-128` — everything before
`formatGeneratedSource`, which is where the first side effect is — into an
exported pure analyzer. `generateInvokers` becomes: analyze, format, write,
return, with observably identical behaviour. `/aot` calls the analyzer instead of
mirroring it.

The dynamic import stays dynamic: `@aponiajs/cli` carries `ts-morph` and a
formatter, and an application that never polls `/aot` must not load either.

**What this deletes.** Not just the duplicated rules but the tests that exist to
prove the mirror faithful — the case that reads the refusal sentences back out of
`generateInvokers` becomes unnecessary when one function produces both.
`packages/devtools/AGENTS.md`'s invariant "mirrors … instead of calling it"
becomes "calls the shared analyzer", and the hand-sync cost leaves the
limitations list rather than shrinking in it.

### 16a · The build says when it wrote nothing

**Today.** When a build declines the root and can lower nothing else — the
single-module project, which is the starter — it writes no descriptor file, so a
committed `descriptors.generated.ts` keeps serving a graph the registration is
not in. The runtime accepts it by every rule it can apply, the startup log
reports the declared graph served the application, and the devtools never mounts.
Nothing reports the absence.

**Change.** `GenerateInvokersResult` gains `descriptorEmitted`, which the emitter
already computes as `source === undefined` and the caller cannot see. When the
build emitted no descriptor **and** a module was declined, `formatBuildReport`
prints a warning naming both the cause and the escape — the `plugins` option —
and the build still exits successfully.

`formatBuildReport` is the one function both entrypoints share
(`run-cli.ts:33-35` and `bundler/aponia-build-plugin.ts:63-65`), which is why the
warning belongs there: one seam covers both, and a warning that fires on only one
of them would be worse than none.

**Both decline paths must be covered.** `readCollectionReason` handles
non-array-literal collections; a call expression does **not** go through it —
`isCopyableExpression` returns `true` for a call, so the entry reaches
`readEntryReference` instead (`descriptor-emitter.ts:563-589`). A warning built on
one path would miss the case this change exists for.

**`dryRun` gets its own wording**, because nothing was written and the "kept
artifact" framing would be false.

**Rejected.** Failing the build. A decline is the supported state the decorated
path exists for, and failing would block work that has nothing to do with
devtools. A warning that names the consequence is enough, and the consequence is
the thing nobody could see.

## Delivery order

Five phases, ordered so that each lands on a settled base and the risky work is
last.

1. **Silences and small corrections** — 3, 8, 15a, 16a. No interface changes
   outside the CLI's own result type. Every one of these is a fact that was
   already computed and not published.
2. **The record learns what only the mount knows** — 4. One additive field, one
   consumer, one fallback.
3. **The request record** — 6, 7. The only wire-breaking change, and it is
   one change: the entry written at arrival.
4. **The exception** — 10. A platform recording seam with no precedence risk.
5. **AOT integrity** — 14, 15b. The artifact contract and the analyzer split.

Phases 1 and 2 are independent of each other and of everything after. Phase 3
must land whole — a pending entry with no superseding entry would be a worse
answer than today's. Phase 5 is last because the artifact field is the only
change that a previously committed artifact can be on the wrong side of.

## What remains limited, deliberately

- **A callback route still names no handler.** Recovering the property key would
  mean matching a registered handler's identity against the instance's own
  properties, which fails for a bound handler and is ambiguous for two alike. The
  package's rule is that it never guesses, and a wrong name is worse than an
  empty one.
- **A call-expression import cannot be lowered.** Making the build evaluate user
  code to resolve it would make the build execute the application. The escape is
  the `plugins` option, and 16a is what makes the escape discoverable.
- **The record is per boot, `onStart` needs `listen()`, and boot facts do not
  change.** These are correct: the first is what keeps two applications' traffic
  apart, the second is Elysia's lifecycle, and the third is that a boot is a
  thing that happened.
- **A request the server rejected is not recorded.** Nothing in the application
  ran, so there is no observation to publish.
- **A response body is not recorded, and cannot be from here.** The record is
  written from the after-response hook, whose `responseValue` is the handler's
  return value rather than the bytes the client received, so a `responseBody`
  field would be present and wrong for every `Response`-backed answer instead of
  merely absent. Section 9 gives the mechanism in full. It is listed here as well
  as there because a reader looking for what the record does not hold should not
  have to find the change that was withdrawn.
- **Providers still cannot inject a logger.** `/logs` holds the platform's lines
  and whatever was written through the object handed over. Closing this needs an
  injectable `LOGGER` token, which changes `ModuleGraph`'s documented visibility
  rule, and is specified separately.

## Testing

Bun is the primary lane and the contract is HTTP, so every endpoint change is
asserted over the socket rather than against a builder.

- **3** — a logger whose second level refuses records the first and publishes
  `levels` naming it; a logger whose first refuses serves no endpoint; a logger
  with a gap in the middle records every level it can and names them.
- **4** — a decorated application whose interceptor declares its halves as
  **class fields** publishes both stages; the same class with prototype methods
  publishes the same stages; a record with no `interceptorHalves` falls back to
  the prototype probe, asserted against a hand-attached foreign record.
- **6, 7** — a request a plugin answers with an early `Response` appears with
  `status: null` and an `id`; the request that follows it appears with the same
  `id` discipline and a real status; a poller that reads the pending entry and
  polls again at its cursor receives the superseding entry; an answered request
  produces exactly two entries sharing one `id`; `capture: false` still answers
  an empty record.
- **8** — a route whose handler does work reports a duration that does not grow
  with the size of the answer this package reads.
- **9** — withdrawn, so it has no case. The limitation stands, and the number is
  kept so a reader can follow it from the table above to the section that gives
  the mechanism.
- **10** — an unhandled failure carries `error` with the exception's message and
  never a stack; a `404`, a validation `422`, and an `HttpError` still carry
  none; a handler's own `5xx` still carries none.
- **14** — an artifact whose recorded parameter facts disagree with the compiled
  plan is refused with one line; an artifact that agrees is adopted; a controller
  whose schema, enhancers, and promise-capability differ from the emitter's
  analysis is **not** refused, which is the case that pins the excluded facts.
- **15a** — a failing project that is then fixed on disk answers successfully on
  the next poll.
- **15b** — `/aot`'s verdicts and `generateInvokers`' decisions agree over the
  same temporary project, including the ignored-file and source-root cases; the
  analyzer is still not loaded before the first request, asserted in a child
  process.
- **16a** — a build over the starter's shape prints the warning and exits `0`; a
  build whose other modules still emit prints the decline and no warning; a
  `dryRun` prints the dry-run wording.

Every case carries a mutation that makes it fail alone. The Vite+ lane mirrors
the payload types, including `status: number | null` and the new fields.

## Why the whole wire moves for one endpoint's change

`/logs`' new `levels` is additive and a consumer could ignore it; `/requests`'
change is breaking and a consumer cannot. The wire carries **one** contract
version, so the bump is paid by both.

**The bump is taken.** A reader that checks `contract` first is the reader the
field exists for, and the failure this package exists not to have is a consumer
answering a question from a shape it did not understand. An unchanged number over
a changed shape is that failure with the tool's own name on it.

**Rejected.** Per-endpoint versions, which would let `/logs` stay at `1`. It
would make "which contract does this server speak" a question with seven answers,
and the `/meta` payload that states the version is read once, before any endpoint
is called.
