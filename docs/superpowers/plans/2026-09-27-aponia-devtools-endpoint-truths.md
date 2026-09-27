# Devtools endpoint truths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@aponiajs/devtools` stop answering questions with shapes that read as a different answer — seven of the sixteen stated limitations become facts instead of silences.

**Architecture:** Six changes across `packages/platform-elysia` and `packages/devtools`. Two are pure devtools edits (`#8`, `#3`), two are platform facts a mount can see and a record must carry (`#4`, `#10`), and two change the `/requests` record (`#6`/`#7`, `#9`). The wire contract moves from `1` to `2` in Task 3, which is the task that **breaks** the shape rather than the one that extends it: `status` changes type and one request becomes two entries, so a reader of `1` would misread it. Task 2's `levels` is additive and rides at `1`, because a reader of `1` reads a `1` payload correctly and ignores a field it does not know.

**Tech Stack:** Bun, TypeScript (strict, ESM, explicit `.ts` extensions), Elysia as a peer, `bun test` for the Bun lane, `vitest` under Vite+ for the conformance lane.

**Spec:** [`docs/superpowers/specs/2026-09-27-aponia-devtools-completeness-design.md`](../specs/2026-09-27-aponia-devtools-completeness-design.md)

## Global Constraints

- All repository content is English — code, comments, docs, test names. Scan with `rg -nP '[\x{0E00}-\x{0E7F}]' --glob '!node_modules/**' --glob '!dist/**' .` before finishing any task.
- **Every prose edit sweeps for the claim; it never edits a named list of lines.** Task 1 missed four files by trusting a list, and each round of correcting the wording produced a fresh instance of the same defect — three rounds running. A carry list is a list of the places somebody happened to see.
  - Search across `docs/` and every package's `README.md`, `AGENTS.md`, and `llms.txt`, with a **multiline-aware** pattern: a wrapped `"outside\n  it"` does not match `"outside it"`, so a line-anchored sweep reports silence it has not earned.
  - `rg` **skips symlinks**. `CLAUDE.md` and `GEMINI.md` are symlinks to `AGENTS.md` in every package; add `-L`, or confirm the real file and check that all three spellings agree.
  - Exclude `docs/superpowers/**`: the specs and this plan are the design record that mandates the changes, and they describe the pre-change state deliberately.
  - **Sweep a document's opening lines explicitly.** `docs/devtools.md:7` opened with "the requests it answered" and survived two consecutive sweeps of that same file while its endpoint table, its limitations list, and two sibling documents were all corrected — because the opener summarises in different words than the body uses. Grep the summary sentence, not just the claim's phrasing.
- **A change to one payload can falsify a claim about a different one.** Task 2's limitation sweep was clean and still left six false sentences: adding `levels` to `/logs` broke every statement that `/requests` "answers the same shape", because the two cursor endpoints had been identical down to their fields. Before finishing any task that adds, removes, or retypes a field, sweep for **parity claims** as well as for the claim the task is about — "the same shape", "answers the same contract", "`/routes`' reason", "for `X`'s reason" — across `docs/` and every package's `README.md`, `AGENTS.md`, and `llms.txt`.
- **When a claim needs a scope clause to be true, the boundary is in the wrong place.** Task 1 spent three rounds narrowing a sentence before moving the reading it described. A clause that exists only to make a statement accurate is a signal to move the thing being described.
- **A comment that asserts a guarantee is a claim, and the same rule binds it.** Task 2's per-level `catch` left the level _read_ outside the `try`, so a logger with a throwing accessor escaped `tapLogBuffer` at registration and failed the boot — while the comment two lines below it said "Nothing here may escape". This plan's tasks each add a `try`, a guard, or a fallback whose comment promises something; before finishing, read each comment against the code it sits above and make the code earn the sentence, or narrow the sentence. Ordinary prose sweeps do not cover code comments, so this check is per-task and manual.
- `src/index.ts` is the only public barrel per package. Type-only contracts are `*.types.ts` beside the owner. No `any`; narrow `unknown`.
- Type-only imports use `import type`. Public descriptors and metadata are returned frozen; caller-owned collections are copied before freezing.
- Public API edits are contract changes. `#4` and `#10` add fields to the `@internal` diagnostics record, which is a seam, not a public contract — devtools must keep reading it defensively so an older platform copy still answers.
- `routing/native-route.ts` in `packages/platform-elysia` stays the only module in the workspace that calls Elysia's route-registration API.
- A debugging aid must never fail a boot. Nothing added to an `onStart` path or an Elysia hook may throw.
- Required gates before any task is considered done: `bun run check`, `bun run test:coverage` (95% line and function floor), `bun run test:vite-plus`. Run the narrow command while iterating; the full gates are the delivery evidence.
- **Run `bun run build` before `bun run test:generated-app`, or that lane fails for a reason unrelated to this branch.** The CLI's `project-generator` reads `aponiaVersion` from `version.ts`, which is embedded at **build** time, so `bun pm pack` packs whatever `packages/*/dist` last held. The tree's `dist` artifacts still embed `0.6.0-alpha.22` while every manifest says `alpha.23`, so the packed CLI writes a stale version into a generated application and `generated-application.e2e.ts:156` fails comparing it against `workspaceManifest.version`. Task 3's implementer proved this failure predates its change. Build first, and remember the known side effect: a build leaves `.d.ts` files beside sources under `packages/*/src`, which must be cleaned before testing.
- **This branch has no version bump.** Tasks 1 through 6 all leave the synchronized workspace version alone, and the repository requires a push to raise it. The single bump belongs to the finishing step, before any push — CI's `verify` job fails when the version is unchanged, lower, invalid, or inconsistent across manifests or `bun.lock`.
- Every behavior change needs a Bun case and, when the public type or runtime behavior changes, a Vite+ conformance case.
- Coverage: every executable source under `packages/*/src/**/*.ts` must appear in LCOV. New runtime files are added to `scripts/coverage-gate.ts` discovery in the same change.

## Review Focus

Listed most likely to bite first. Each gets its test in the owning task.

1. **A pending entry that is never superseded must not read as an answered request.** A consumer polling `/requests` sees `status: null`; nothing may render that as `0`, `undefined`, or an omitted key, and the doc must say the absence means "no answer observed".
2. **A poller that already read a pending entry must be able to learn it was superseded.** Grouping by `id` is the whole mechanism; if `id` is unstable, missing, or differs between the two entries, the consumer holds a stale row forever.
3. **`capture: false` must still answer an empty record**, not no endpoint, and must not write pending entries. The distinction between the request policy and the logger option is load-bearing.
4. **A logger whose first assignment refuses must serve no `/logs`**, while one that refuses a later assignment must serve a stream naming the levels it reached. Both sides of that boundary need a case.
5. **A foreign or older diagnostics record must not make `/flow` or `/requests` throw.** Those handlers run inside `Bun.serve`, where a throw is a failed request; a record without `interceptorHalves` or without `mappedExceptions` must fall back, not crash.

---

### Task 1: `durationMs` stops charging the application for this package's own reads

**Files:**

- Modify: `packages/devtools/src/requests/request-capture.ts:277-296` (`toRequestRecord`)
- Test: `packages/devtools/tests/requests.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `RequestCapture.complete(context: AnsweredRequest, completedAt: number): Promise<void>` and `toRequestRecord(context, capture, arrival, completedAt) => Promise<RequestRecord>`. Both are `@internal` and have one call site each. **Tasks 3, 4, and 5 build on this signature and must not re-take a reading.**

- [ ] **Step 1: Write the failing test**

Add to `packages/devtools/tests/requests.test.ts`. The case proves the closing reading is taken before the reads it currently encloses, by making those reads expensive and requiring the duration not to grow with them.

Read `packages/devtools/tests/requests.test.ts` first and use **its** fixture helpers —
the names and option shapes below are the assertion, not the API. Every task in this plan
that names a fixture means "the one the file already has"; do not add a helper for it.

```ts
test("a duration is not charged for the answer this package reads", async () => {
  // A body large enough that serializing it costs measurably more than the route
  // does. The route answers immediately, so every millisecond the record reports
  // beyond a small floor is this package's own read of the answer.
  const filler = "x".repeat(400_000);
  const application = await bootRequestsApplication({
    capture: { bodyLimit: 500_000 },
    answer: { filler },
  });

  await fetch(`${application.getUrl()}/bulk`);
  const [entry] = (await readRequests(application)).entries;

  expect(entry.status).toBe(200);
  expect(entry.durationMs).toBeLessThan(50);
});
```

The route that answers with the filler body is added to the file's existing fixture
route set, not through a new option. Calibrate the `< 50` bound against the observed
failure before the fix and the observed pass after it, and state both numbers in a
comment: a bound that the unfixed code also passes proves nothing.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/devtools/tests/requests.test.ts -t "not charged for the answer"`
Expected: FAIL — the marker the case keys on flips strictly between the opening stamp and the closing reading, which is unreachable while the closing reading follows the read it keys on.

**The premise this case was first written from is wrong, and the case must be rebuilt on the read that actually exists.** Response bodies are never captured, so a large _response_ body enlarges no enclosed read and the case as first sketched would pass unfixed. The enclosed reads are the parsed **request** body through `captureBody`, plus `routePattern` and `answerStatus`. Build the regression on `captureBody` over a large request body, with an observable marker that flips only when the serializer enumerates it.

- [ ] **Step 3: Move the closing reading to the boundary, not inside the function**

**The reading does not belong in `toRequestRecord` at all.** It is taken as the after-response hook's first statement and passed in, because `toRequestRecord` is not where the completion side begins: the hook reads `context.request`, `context.route`, `context.body`, `context.set.status`, and `context.responseValue` while assembling `complete()`'s argument, and a reading taken inside `toRequestRecord` follows all five. Every sentence saying the route, the status, and the parsed body are outside the measurement would then be false.

This was found the hard way: three rounds of narrowing the sentence produced a fresh instance of the same defect each time, so the boundary moved instead of the wording. Do not reintroduce a reading inside `toRequestRecord`, and do not re-scope the claim in the documents — with the boundary at hook entry the unconditional form is simply true.

`packages/devtools/src/module/devtools-module.ts` — the hook:

```ts
.onAfterResponse({ as: "global" }, async (context) => {
  // Taken before this hook reads anything off the context, so that every read the
  // completion side makes — the five below and everything toRequestRecord does with
  // them — is outside the measurement rather than merely most of it. Moving this
  // line below the argument object silently charges the application for this
  // package's own work.
  const completedAt = performance.now();
  await capture.complete(
    {
      request: context.request,
      route: context.route,
      body: context.body,
      status: context.set.status,
      answer: context.responseValue,
    },
    completedAt,
  );
})
```

`packages/devtools/src/requests/request-capture.ts` — `complete` takes the reading, and `toRequestRecord` takes it too:

```ts
async complete(context: AnsweredRequest, completedAt: number): Promise<void> {
  const arrival = arrivals.get(context.request);

  // A request this registration never saw, and an answer whose arrival was
  // spent by an earlier completion, leave nothing rather than a partial entry.
  if (arrival === undefined) {
    return;
  }

  arrivals.delete(context.request);
  arrival.record.write(await toRequestRecord(context, policy, arrival, completedAt));
},
```

```ts
export async function toRequestRecord(
  context: AnsweredRequest,
  capture: ResolvedCapture,
  arrival: RequestArrival,
  completedAt: number,
): Promise<RequestRecord> {
  // The reading arrives as an argument rather than being taken here: the
  // completion side begins at the hook, and a reading taken in this function
  // would follow the hook's own reads of the context. Everything below is this
  // package's own work and none of it is charged to the application — including
  // the single await, which reads a readable `5xx` answer's published body and
  // is the one exclusion that predates this change.
  const durationMs = completedAt - arrival.startedAt;
  const route = routePattern(context.route);
  const status = answerStatus(context);
  const body = capture.body ? captureBody(context.body, capture.bodyLimit) : undefined;
  const error = await failureMessage(status, context.answer);

  return Object.freeze({
    method: arrival.method,
    path: route ?? arrival.pathname,
    url: `${arrival.pathname}${arrival.search}`,
    status,
    durationMs,
    timestamp: arrival.timestamp,
    ...(arrival.headers === undefined ? {} : { headers: arrival.headers }),
    ...(body === undefined ? {} : { body }),
    ...(error === undefined ? {} : { error }),
  });
}
```

**Every later task in this plan that edits `toRequestRecord` inherits this signature.** Tasks 3, 4, and 5 each add to this function; each takes `completedAt` for granted and must not add a reading of its own.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/devtools/tests/requests.test.ts -t "not charged for the answer"`
Expected: PASS.

- [ ] **Step 5: Correct the prose that describes the old behaviour**

`docs/devtools.md` currently says the duration "includes this package's own synchronous reads of the request and the answer". Replace that paragraph with what is now true.

**Write the unconditional claim, and make sure the code earns it.** With the reading taken at the hook's first statement, it precedes _every_ read the completion side makes: the hook's five context reads, `complete`'s `arrivals.get` and `arrivals.delete`, and everything `toRequestRecord` does — including the one `await` that reads a readable `5xx` body. Say that, without a scope clause: a leftover "the reads of the answer" qualifier was needed only while the reading sat inside `toRequestRecord`, and leaving it behind misleads the next reader about why it is there.

What stays inside is the arrival hook's own work — `performance.now()`, `requestUrl`, `request.method`, and `captureHeaders` all follow the opening stamp — because that stamp must precede the reads that need the request while it is whole. That half of the sentence is right and stays.

**Sweep for the claim rather than editing the lines named here.** This repository has a recorded history of this exact failure — a carry list is a list of the places somebody happened to see. Search the whole published set for the old claim rather than trusting the two paths above:

```
rg -n "own synchronous reads|application took|took to answer|after this package has read|after the completion hook has read" docs packages --glob '!docs/superpowers/**'
```

`docs/learn/`, the package `AGENTS.md`, `llms.txt`, and `request-buffer.types.ts`'s own `durationMs` doc have all been missed at least once on this task already. Excluding `docs/superpowers/**` is deliberate: the spec and plan are the design record that mandates the change and describe the pre-change state on purpose.

- [ ] **Step 6: Run the gates**

Run: `bun run check && bun test packages/devtools && bun run test:vite-plus`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add packages/devtools/src/requests/request-capture.ts packages/devtools/tests/requests.test.ts docs/devtools.md packages/devtools/README.md
git commit -m "fix(devtools): stop charging the application for the answer this package reads"
```

---

### Task 2: The log stream names the levels it reached

**Files:**

- Modify: `packages/devtools/src/logging/log-tap.ts`
- Modify: `packages/devtools/src/endpoints/payloads.types.ts:153-158` (`AponiaLogsPayload`)
- Modify: `packages/devtools/src/endpoints/logs.ts:17-21`
- Modify: `packages/devtools/src/module/devtools-module.ts:158, 237-243`
- Modify: `packages/devtools/src/server/devtools-server.ts` and `src/server/request-router.ts` (wherever `buildLogsPayload` is called)
- Test: `packages/devtools/tests/logs.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:
  - `interface TappedLogStream { readonly buffer: LogBuffer; readonly levels: readonly LogLevel[] }`
  - `tapLogBuffer(logger: LoggerService, buffer: LogBuffer): TappedLogStream | undefined`
  - `buildLogsPayload(buffer: LogBuffer, since: number, levels: readonly LogLevel[]): AponiaLogsPayload`
  - `AponiaLogsPayload` gains `readonly levels: readonly string[]`

- [ ] **Step 1: Write the failing test**

````ts
Read `packages/common/src/logging/logger.ts` first: whether the concrete `Logger` carries
every `LoggerService` level as an own, writable property decides how these cases are set
up. Assert membership rather than an exact array, so a case does not break when a level
is added to the interface.

```ts
test("a stream names the levels the tap reached", async () => {
  const logger = new Logger("Test", { timestamp: false });
  // A level the object does not carry is a level the tap cannot reach, and the
  // payload has to say so rather than leave it to be inferred from an absence.
  delete (logger as { debug?: unknown }).debug;

  const application = await bootLogsApplication({ logger });
  const payload = await readLogs(application);

  expect(payload.levels).toContain("log");
  expect(payload.levels).not.toContain("debug");
});

test("a level that refuses its assignment does not cost the levels after it", async () => {
  const logger = new Logger("Test", { timestamp: false });
  // `error` is made unwritable, which is the one shape that refuses a patch while
  // later levels would still accept one. The levels after it must still be
  // reached, and the payload must not name the level that refused.
  Object.defineProperty(logger, "error", {
    value: logger.error,
    writable: false,
    configurable: true,
  });

  const application = await bootLogsApplication({ logger });
  const payload = await readLogs(application);

  expect(payload.levels).toContain("log");
  expect(payload.levels).not.toContain("error");
  expect(payload.levels).toContain("verbose");
});
````

`recordableLevels` order is `log, fatal, error, warn, debug, verbose`, so `error`
refusing leaves `warn`, `debug`, and `verbose` after it — the levels that prove the loop
continued. Confirm `verbose` is actually present on the concrete `Logger` before
asserting it; if it is not, assert on `warn` instead and say why in the case.

test("a logger whose first assignment refuses serves no endpoint", async () => {
const logger = Object.freeze(new Logger("Test", { timestamp: false }));
const application = await bootLogsApplication({ logger });

expect(await fetch(`${application.getUrl()}${devtoolsPrefix}/logs`)).toHaveProperty(
"status",
404,
);
});

````

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/devtools/tests/logs.test.ts -t "levels the tap reached"`
Expected: FAIL — `payload.levels` is `undefined`.

- [ ] **Step 3: Patch every level, remembering what was reached**

Rewrite `tapLogBuffer` in `packages/devtools/src/logging/log-tap.ts`. The refusal boundary keeps its meaning — `undefined` exactly when **no** level was patched — but a refusal now costs one level rather than that level and every one after it.

```ts
/** A tapped logger's stream and the levels the tap reached on it. */
export interface TappedLogStream {
  readonly buffer: LogBuffer;
  readonly levels: readonly LogLevel[];
}

const tappedLoggers = new WeakMap<object, TappedLogStream>();

export function tapLogBuffer(
  logger: LoggerService,
  buffer: LogBuffer,
): TappedLogStream | undefined {
  const tapped = tappedLoggers.get(logger);

  if (tapped !== undefined) {
    return tapped;
  }

  const target = logger as unknown as Record<string, unknown>;
  const levels: LogLevel[] = [];

  // Each level is patched on its own, and one that refuses costs only itself:
  // this order decides nothing, because every level is attempted whatever
  // happened to the ones before it. What the refusal still decides is the whole
  // answer below — a tap that reached no level at all has no stream to publish.
  for (const level of recordableLevels) {
    const write = logger[level];
    if (write === undefined) {
      continue;
    }

    try {
      target[level] = (message: unknown, ...optionalParameters: unknown[]): void => {
        buffer.write(createLogEntry(level, message, optionalParameters));
        write.call(logger, message, ...optionalParameters);
      };
      levels.push(level);
    } catch {
      // This level keeps the method it had. The remaining levels are still
      // attempted, which is what makes the payload's `levels` the whole truth
      // about what the stream can hold.
    }
  }

  if (levels.length === 0) {
    return undefined;
  }

  const stream = Object.freeze({ buffer, levels: Object.freeze(levels) });
  rememberTap(logger, stream);

  return stream;
}

function rememberTap(logger: LoggerService, stream: TappedLogStream): void {
  try {
    tappedLoggers.set(logger, stream);
  } catch {
    // Not an object, so there is nothing to remember it by.
  }
}
````

- [ ] **Step 4: Publish the levels**

`endpoints/payloads.types.ts` — add to `AponiaLogsPayload`:

```ts
  /**
   * The `LoggerService` levels this stream records, as the tap reached them.
   *
   * A logger that declared no `debug`, or whose `debug` property refused the
   * patch, is stated here rather than left to be inferred from an absence in
   * `entries`: a stream that never holds a `debug` line and a stream whose tap
   * never reached `debug` are different facts, and only this field tells them
   * apart.
   */
  readonly levels: readonly string[];
```

`endpoints/logs.ts`:

```ts
export function buildLogsPayload(
  buffer: LogBuffer,
  since: number,
  levels: readonly LogLevel[],
): AponiaLogsPayload {
  const read = buffer.since(since);

  return Object.freeze({
    cursor: read.cursor,
    entries: read.entries,
    levels: Object.freeze([...levels]),
  });
}
```

- [ ] **Step 5: Carry the stream instead of the bare buffer**

`module/devtools-module.ts:237-243` — `createLogStream` returns `TappedLogStream | undefined`:

```ts
function createLogStream(source: DevtoolsOptions["logger"]): TappedLogStream | undefined {
  if (!isRecordableLogger(source)) {
    return undefined;
  }

  return tapLogBuffer(source, createLogBuffer(defaultLogBufferCapacity));
}
```

Every consumer that held a `LogBuffer` now holds `TappedLogStream`: `module/devtools-module.ts:158` and the call site of `buildLogsPayload` in the server. Pass `stream.levels` through to `buildLogsPayload`. Update the doc comment at `devtools-module.ts:212-236` — the two-outcome rule it states is unchanged, but the "a partly patched logger" sentence must now say the payload names the levels reached, and the `logger: false` reasoning stays exactly as written.

- [ ] **Step 6: Run the tests**

Run: `bun test packages/devtools/tests/logs.test.ts`
Expected: PASS, including the three new cases.

- [ ] **Step 7: Reverse the limitation in the docs**

`docs/devtools.md` carries "A partly patched logger's stream does not name the levels it missed" in its limitations list, with a link to `/logs`. Replace it: the stream now names what it reached, and the remaining limitation is only that `LoggerService` has no notion of an enabled level, so a level the logger's own filter would print nothing for is still recorded. Make the same edit in `packages/devtools/README.md` and the `packages/devtools/AGENTS.md` bullet beginning "A partly patched logger publishes a stream and does not say what it missed."

- [ ] **Step 8: Add the Vite+ conformance case**

`packages/devtools/tests-vp/*.conformance.ts` mirrors the payload types. Add `levels: readonly string[]` to the mirrored `AponiaLogsPayload` and reference it so `bun run check` cannot drop the assertion as unused.

- [ ] **Step 9: Run the gates**

Run: `bun run check && bun run test:coverage && bun run test:vite-plus`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add packages/devtools/src packages/devtools/tests packages/devtools/tests-vp docs/devtools.md packages/devtools/README.md packages/devtools/AGENTS.md
git commit -m "feat(devtools): name the log levels the tap reached"
```

---

### Task 3: A request that was never answered is recorded, and says so

This task carries the wire contract bump. `#7`'s first row — a request that reached the route table and matched nothing — already works and is asserted; what changes is the case where no later phase ran at all.

**Files:**

- Modify: `packages/devtools/src/requests/request-buffer.types.ts:19-45` (`RequestRecord`)
- Modify: `packages/devtools/src/requests/request-capture.ts` (`arrive`, `complete`, new `toPendingRecord`)
- Modify: `packages/devtools/src/requests/request-buffer.ts:15` (capacity)
- Modify: `packages/devtools/src/endpoints/payloads.types.ts:31-45, 175-180` (contract, `/requests` doc)
- Modify: the module holding `devtoolsContractVersion` (find it: `rg -n "devtoolsContractVersion" packages/devtools/src`)
- Test: `packages/devtools/tests/requests.test.ts:368-390` rewritten, plus new cases

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:
  - `RequestRecord` gains `readonly id: number`; `status` becomes `number | null`; `durationMs` becomes `number | null`
  - `createRequestCapture` gains an internal arrival counter; `arrive` writes a pending entry
  - `defaultRequestBufferCapacity` moves from `500` to `1000`

- [ ] **Step 1: Write the failing tests**

Replace the case at `packages/devtools/tests/requests.test.ts:368-390` — its name states the contract being reversed — with:

```ts
test("a request a plugin answers with an early response is recorded as unanswered", async () => {
  const application = await bootRequestsApplication({ plugin: gatePlugin });

  await fetch(`${application.getUrl()}/early-refusal`);
  const payload = await readRequests(application);

  expect(payload.cursor).toBe(1);
  expect(payload.entries.map((entry) => entry.url)).toEqual(["/early-refusal"]);
  expect(payload.entries[0].status).toBeNull();
  expect(payload.entries[0].durationMs).toBeNull();
});

test("an answered request carries one id across a pending entry and its answer", async () => {
  const application = await bootRequestsApplication({ plugin: gatePlugin });

  await fetch(`${application.getUrl()}/users/42`);
  const payload = await readRequests(application);

  expect(payload.entries).toHaveLength(2);
  const [pending, answered] = payload.entries;
  expect(pending.id).toBe(answered.id);
  expect(pending.status).toBeNull();
  expect(answered.status).toBe(200);
  expect(answered.durationMs).toBeGreaterThanOrEqual(0);
});

test("a poll whose cursor sits between a request's two entries is served the answer", async () => {
  const application = await bootRequestsApplication({ plugin: gatePlugin });

  await fetch(`${application.getUrl()}/users/42`);
  const whole = await readRequests(application);
  expect(whole.entries).toHaveLength(2);

  // The cursor a poller would hold after reading the pending entry and nothing
  // after it. The answer was written next, so this read is the superseding
  // entry — which is the property that makes grouping by `id` work: a poller is
  // never stuck holding the pending shape.
  const between = await readRequests(application, whole.cursor - 1);

  expect(between.entries).toHaveLength(1);
  expect(between.entries[0].id).toBe(whole.entries[0].id);
  expect(between.entries[0].status).toBe(200);
});

test("a registration told to capture nothing still writes no pending entry", async () => {
  const application = await bootRequestsApplication({ capture: false });

  await fetch(`${application.getUrl()}/users/42`);
  const payload = await readRequests(application);

  expect(payload).toMatchObject({ cursor: 0, entries: [] });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/devtools/tests/requests.test.ts -t "early response is recorded"`
Expected: FAIL — the refusal still leaves no entry, so `entries` is empty.

- [ ] **Step 3: Widen the record**

`packages/devtools/src/requests/request-buffer.types.ts`:

```ts
export interface RequestRecord {
  /**
   * The request this entry describes. One request produces one entry when it
   * arrived and a second when it was answered, and both carry this id, so a
   * consumer groups by it and takes the last entry for each.
   *
   * The counter belongs to the **capture**, not to a record: it keeps counting
   * across a second `listen()` in the same process, so an id never repeats there
   * and a consumer that polled through a restart cannot group two different
   * requests under one id. It is not a cross-process or cross-boot identity —
   * within one record the first arrival's id is whatever the capture had reached.
   */
  readonly id: number;
  /** The request's method, as it arrived. */
  readonly method: string;
  /** The route pattern that matched, or the path that arrived when nothing did. */
  readonly path: string;
  /** The path and query string as they arrived, which no pattern carries. */
  readonly url: string;
  /**
   * The status the client received, or `null` when no answer was observed.
   *
   * `null` states an absence rather than a failure: the request arrived, this
   * record saw it, and nothing ran afterwards that could report what the
   * application answered. It is never `0` and never an omitted key.
   */
  readonly status: number | null;
  /** From this package's arrival hook to the answer's completion, in milliseconds, or `null` when no answer was observed. */
  readonly durationMs: number | null;
  readonly timestamp: string;
  readonly error?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}
```

Also update the interface's doc paragraph: it says "One request the application answered"; it now describes every request that arrived.

- [ ] **Step 4: Write the pending entry at arrival**

`packages/devtools/src/requests/request-capture.ts`. Add `readonly id: number` to `RequestArrival`, and an arrival counter in the closure. `arrive` allocates the id, stamps it, and writes the pending entry. `complete` writes the final entry with the same id.

```ts
    arrive(request: Request, application: ApplicationIdentity): void {
      const open = records.get(application);

      if (!policy.enabled || open === undefined) {
        return;
      }

      const startedAt = performance.now();
      const arrived = requestUrl(request);
      const arrival = Object.freeze({
        id: (arrivalOrdinal += 1),
        record: open,
        timestamp: new Date().toISOString(),
        startedAt,
        method: request.method,
        pathname: arrived.pathname,
        search: arrived.search,
        ...(policy.headers ? { headers: captureHeaders(request.headers, policy.redact) } : {}),
      });

      arrivals.set(request, arrival);
      // The record is written here, not at completion, because a request whose
      // answer never reaches this package would otherwise leave no trace at all —
      // indistinguishable from one that never arrived. The entry states the
      // absence of an answer rather than inventing one.
      open.write(toPendingRecord(arrival));
    },
```

Declare `let arrivalOrdinal = 0;` in `createRequestCapture`'s closure, beside `records` and `arrivals`, with a comment stating why it is a counter of its own rather than the buffer's write count: the buffer's cursor counts **entries**, and one request now writes two, so an id read from it would change between the request's two entries.

The counter is per capture, not per record, so ids are unique across the capture rather than restarting per boot. That is deliberate and must be stated: an id that repeated across two records in one process would let a consumer that polled through a `listen()` group two different requests. Two entries for one request carry the same `id`;

```ts
/** The entry written when a request arrives, before anything can state an answer. */
function toPendingRecord(arrival: RequestArrival): RequestRecord {
  return Object.freeze({
    id: arrival.id,
    method: arrival.method,
    path: arrival.pathname,
    url: `${arrival.pathname}${arrival.search}`,
    status: null,
    durationMs: null,
    timestamp: arrival.timestamp,
    ...(arrival.headers === undefined ? {} : { headers: arrival.headers }),
  });
}
```

`toRequestRecord` gains `id: arrival.id` in the object it returns, and its `status`/`durationMs` stay as computed — the completion path always observed an answer.

- [ ] **Step 5: Double the capacity and state what it bounds**

`packages/devtools/src/requests/request-buffer.ts:15` — `defaultRequestBufferCapacity` becomes `1000`, and the comment must state what the bound actually covers rather than a rounding of it. The constant bounds **entries, not requests**, and a request nothing answered costs one entry rather than two — so the same bound holds **more** requests the more of those a boot records, up to the full `1000` when nothing is answered at all. An earlier draft of this plan said "the window of answered requests is unchanged", which is true only in the all-answered configuration; Task 3's review caught it as a comment asserting a guarantee that holds in one configuration. The log stream's own capacity constant is separate and does not move.

- [ ] **Step 6: Bump the contract**

`endpoints/payloads.types.ts` — `contract` becomes `2` in `AponiaMetaPayload`. Find the constant the payloads are stamped with (`rg -n "devtoolsContractVersion" packages/devtools/src`) and move it to `2` too. Rewrite the `/requests` payload doc to state the grouping rule:

```ts
/**
 * ... A request appears once when it arrived and again when it was answered, and
 * both entries carry the same `id`, so a consumer groups by `id` and takes the
 * last entry for each request. An entry whose `status` is `null` is a request
 * this record saw arrive and never saw answered — a plugin that answered from
 * its own `onRequest` before any later phase ran. The absence is stated rather
 * than filled: an entry written at completion alone would make that request
 * indistinguishable from one that never arrived.
 */
```

- [ ] **Step 7: Run the tests**

Run: `bun test packages/devtools/tests/requests.test.ts`
Expected: PASS, including every case the file already had.

- [ ] **Step 8: Reverse the documented contract**

Three places argue for the old behaviour and must now argue for the new one — the argument is replaced, not deleted, because the old text's claim ("the fallback would have to invent that status") is the thing that was wrong:

- `docs/devtools.md` — the `/requests` section's "One refusal produces no entry at all" paragraph, and the limitations-list bullet about the record not being complete.
- `packages/devtools/README.md` — the same statements.
- `packages/devtools/AGENTS.md` — the bullet beginning "The pair of hooks is two answers a maintainer may not merge", specifically its final sentence.

Add the grouping rule wherever a `/requests` consumer reads the payload shape.

- [ ] **Step 9: Run the gates**

Run: `bun run check && bun run test:coverage && bun run test:vite-plus`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add packages/devtools docs/devtools.md packages/devtools/README.md packages/devtools/AGENTS.md
git commit -m "feat(devtools)!: record a request that was never answered"
```

---

### Task 4: Response bodies, off by default

**Files:**

- Modify: `packages/devtools/src/module/devtools-module.types.ts` (`capture` option)
- Modify: `packages/devtools/src/requests/request-capture.ts` (`ResolvedCapture`, `resolveCapture`, `toRequestRecord`)
- Modify: `packages/devtools/src/requests/request-buffer.types.ts` (`RequestRecord.responseBody`)
- Test: `packages/devtools/tests/requests.test.ts`

**Interfaces:**

- Consumes: `RequestRecord` from Task 3.
- Produces: `capture.responseBody?: boolean` (default `false`), `capture.responseBodyLimit?: number` (default the existing body limit); `RequestRecord` gains `readonly responseBody?: string`.

- [ ] **Step 1: Write the failing tests**

```ts
test("a response body is absent unless the policy captures one", async () => {
  const application = await bootRequestsApplication();

  await fetch(`${application.getUrl()}/users/42`);
  const [entry] = (await readRequests(application)).entries.slice(-1);

  expect(entry).not.toHaveProperty("responseBody");
});

test("a captured response body is cut at its own limit and marked", async () => {
  const application = await bootRequestsApplication({
    capture: { responseBody: true, responseBodyLimit: 8 },
  });

  await fetch(`${application.getUrl()}/users/42`);
  const [entry] = (await readRequests(application)).entries.slice(-1);

  // The marker is appended to what was kept, exactly as the request body's limit
  // does it, so the assertion is on the marker's presence rather than on the
  // whole value.
  expect(entry.responseBody).toContain("[truncated]");
});

test("a response body this package cannot serialize is stated, not dropped", async () => {
  const application = await bootRequestsApplication({
    capture: { responseBody: true },
    answer: { cyclic: true },
  });

  await fetch(`${application.getUrl()}/cyclic`);
  const [entry] = (await readRequests(application)).entries.slice(-1);

  expect(entry.responseBody).toBe("[unserializable]");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/devtools/tests/requests.test.ts -t "response body"`
Expected: FAIL — `responseBody` is not a known option and is never published.

- [ ] **Step 3: Widen the option and the policy**

`module/devtools-module.types.ts` — add to the `capture` option object, in the same shape as the existing opt-outs:

```ts
  /**
   * Include the response body. Default false.
   *
   * Off by default because buffering every answer costs in proportion to the
   * traffic rather than to the question being asked, and the request is usually
   * what is being debugged. A registered exception filter or a handler's own
   * `Response` is stored as text through the same serializer the request body
   * uses, so a body that cannot be serialized reads as `[unserializable]`
   * rather than as a missing field.
   */
  readonly responseBody?: boolean;
  /** Maximum characters stored for a response body. Defaults to `bodyLimit`. */
  readonly responseBodyLimit?: number;
```

`resolveCapture` resolves both: `responseBody` defaults `false`, `responseBodyLimit` defaults to the resolved `bodyLimit`. Add both to `ResolvedCapture`.

- [ ] **Step 4: Publish it**

`RequestRecord` gains:

```ts
  /**
   * The answer's body, when the policy captures one: cut at its limit and
   * marked when it was, or `[unserializable]` when the serializer refused it.
   * Absent when the policy captures none, and absent for an entry written
   * before an answer was observed.
   */
  readonly responseBody?: string;
```

In `toRequestRecord`, read it through the same `captureBody` helper and the same literals the request body uses. There is no stamp in this function to read it "after" — Task 1 moved the closing reading to the hook, and `durationMs` arrives as the `completedAt` argument. Everything this function does is outside the measurement, which is the point.

```ts
const responseBody =
  capture.responseBody && context.responseValue !== undefined
    ? captureBody(context.responseValue, capture.responseBodyLimit)
    : undefined;
```

Spread it in the returned object the way `body` already is.

**Confirm what the after-response context actually exposes for the answer before relying
on `responseValue`.** The request-side facts are read at arrival because that context
stops stating them; the answer side is read here, so whatever field carries the answer —
a value, a `Response`, or nothing at all for an answer Elysia composed — decides whether
this change is possible as written. If the context carries no readable answer for every
route, say so in the task report rather than publishing a `responseBody` that is present
for some answers and not others: a field that appears for one route and not another, with
no way to tell why, is the false-completeness shape this plan exists to remove.

- [ ] **Step 5: Run the tests**

Run: `bun test packages/devtools/tests/requests.test.ts`
Expected: PASS.

- [ ] **Step 6: Document the option**

Add it to the `capture` table in `docs/devtools.md`, the option list in `packages/devtools/README.md`, and the `llms.txt` for the package if it enumerates options. State the default plainly and state that capture is per answer, so the cost is proportional to the traffic captured.

- [ ] **Step 7: Vite+ conformance**

Mirror the two new option fields and `responseBody` in the payload types the conformance lane asserts.

- [ ] **Step 8: Run the gates**

Run: `bun run check && bun run test:coverage && bun run test:vite-plus`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add packages/devtools docs/devtools.md
git commit -m "feat(devtools): capture response bodies behind an opt-in"
```

---

### Task 5: `/requests` carries the exception the platform already mapped

**Files:**

- Modify: `packages/platform-elysia/src/errors/default-exception-filter.ts:64-73`
- Modify: `packages/platform-elysia/src/application/application-bootstrap.ts:164-173, 265-284`
- Modify: `packages/platform-elysia/src/application/application-diagnostics.ts:53-77` and `.types.ts`
- Modify: `packages/devtools/src/requests/request-capture.ts` (`beginBoot`, `toRequestRecord`)
- Modify: `packages/devtools/src/module/devtools-module.ts:181`
- Test: `packages/platform-elysia/tests/application-diagnostics.test.ts`, `packages/devtools/tests/requests.test.ts`

**Interfaces:**

- Consumes: `RequestRecord.error` from Task 3 (unchanged shape).
- Produces:
  - `createDefaultExceptionFilter(logger: LoggerService | undefined, mappedExceptions: WeakMap<Request, string>): ElysiaErrorHook`
  - `AponiaApplicationDiagnostics` gains `readonly mappedExceptions: WeakMap<Request, string>`
  - `RequestCapture.beginBoot(application: ApplicationIdentity, mappedExceptions?: WeakMap<Request, string>): RequestBuffer`

- [ ] **Step 1: Write the failing test**

```ts
test("an unhandled failure carries the exception the platform mapped", async () => {
  const application = await bootRequestsApplication({
    routes: [
      [
        "get",
        "/boom",
        () => {
          throw new Error("the connection string was rejected");
        },
      ],
    ],
  });

  await fetch(`${application.getUrl()}/boom`);
  const [entry] = (await readRequests(application)).entries.slice(-1);

  expect(entry.status).toBe(500);
  // The same projection the log stream uses: the name and the message, never the
  // stack. `/logs` reports this exception today under `ExceptionsHandler`, and
  // the two surfaces must not disagree about what the exception said.
  expect(entry.error).toBe("Error: the connection string was rejected");
});

test("an exception's stack is never published", async () => {
  const application = await bootRequestsApplication({
    routes: [
      [
        "get",
        "/boom",
        () => {
          throw new Error("x");
        },
      ],
    ],
  });

  await fetch(`${application.getUrl()}/boom`);
  const [entry] = (await readRequests(application)).entries.slice(-1);

  expect(entry.error).not.toContain("at ");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/devtools/tests/requests.test.ts -t "exception the platform mapped"`
Expected: FAIL — `entry.error` is absent for every mapped failure.

- [ ] **Step 3: Record what the mapping already sees**

`default-exception-filter.ts` — the mapping already receives the exception and already reports it on the log channel. It now also records the message where the after-response hook can read it.

```ts
export function createDefaultExceptionFilter(
  logger: LoggerService | undefined,
  mappedExceptions: WeakMap<Request, string>,
): ElysiaErrorHook {
  return ({ error, set, request }) => {
    if (elysiaAnswersThis(error, set.status)) {
      return undefined;
    }

    logger?.error(error, "ExceptionsHandler");
    // The message, never the stack: a stream a page reads is no place for one,
    // and this is the same projector the log stream uses. Recorded here rather
    // than by a second hook because this one already runs, and an observer added
    // to the application's error path is a second chance to change which handler
    // answers — precedence there is registration order.
    mappedExceptions.set(request, exceptionMessage(error));
    return httpErrors.internalServerError(unhandledFailureDetail).toResponse();
  };
}

function exceptionMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}
```

Confirm the error hook's context exposes `request` for the Elysia release in the peer range before relying on it; the hook is route-local and is only read while Elysia composes ahead of time.

- [ ] **Step 4: Publish the map on the record**

`application-bootstrap.ts` — create the map beside the exception handling it belongs to, pass it in, and publish it:

```ts
// A live map rather than a frozen copy, and the one field of this record that
// is: what it holds is not a decision the boot made but a fact the boot keeps
// producing, exactly like the mounted route table. A reader that finds no such
// field — an older or foreign platform copy — reads no exception, which is the
// answer it gave before this field existed.
const mappedExceptions = new WeakMap<Request, string>();
const exceptionHandling: MountedExceptionHandling = Object.freeze({
  defaultFilter: createDefaultExceptionFilter(logger, mappedExceptions),
  logger,
});
```

Add `mappedExceptions` to the `createApplicationDiagnostics` facts and to the record, and to `AponiaApplicationDiagnostics` with a doc comment stating that it is live, per boot, and keyed by the request object.

- [ ] **Step 5: Hand it to the capture**

`RequestCapture.beginBoot` takes the map optionally and stores it **per application
identity**, beside the buffer — a second `WeakMap<ApplicationIdentity, WeakMap<Request,
string>>`. It is not carried on the arrival stamp: the map belongs to the boot, and a
request's stamp is a fact about the request. `complete` looks the map up by the arrival's
record, exactly as `arrive` looks up the buffer.

```ts
// The platform's own mapping recorded this exception when it answered, and the
// answer's published body cannot be read from here for the two shapes that carry
// none. The map is consulted only where the answer published nothing readable, so
// it never overwrites what the client received.
const error =
  (await failureMessage(status, context.answer)) ?? mappedExceptions?.get(context.request);
```

`toRequestRecord`'s signature gains a fifth parameter for the map, after Task 1's `completedAt`, which stays `@internal`. Keep the parameter order the one Task 1 established and append; do not reorder the existing four.

`module/devtools-module.ts:181` — read the record at `onStart` and pass the field:

```ts
const diagnostics = readApplicationDiagnostics(parent);
requests: capture.beginBoot(application.store, diagnostics?.mappedExceptions),
```

`readApplicationDiagnostics` is `@internal` and off the platform's barrel. If the import is unavailable to devtools, read the symbol-keyed property directly the way `/graph` already does, and say so in a comment.

- [ ] **Step 6: Run the tests**

Run: `bun test packages/devtools/tests/requests.test.ts packages/platform-elysia/tests/application-diagnostics.test.ts`
Expected: PASS, including the two new cases.

- [ ] **Step 7: Correct the documented behaviour**

`docs/devtools.md` and the package README currently state that two `5xx` shapes carry no `error` — the platform's mapping for an unhandled failure, and a handler's own. One of the two now carries one. Keep the sentence for the handler's own `5xx` (its body is the one the client already holds) and correct the other. The rule that a stack is never published stays as written.

- [ ] **Step 8: Run the gates**

Run: `bun run check && bun run test:coverage && bun run test:vite-plus`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add packages/platform-elysia packages/devtools docs/devtools.md
git commit -m "feat(devtools): publish the exception the platform mapped"
```

---

### Task 6: `/flow` sees a class-field interceptor half

**Files:**

- Modify: `packages/platform-elysia/src/controllers/enhancer-resolver.ts:128-175`
- Modify: `packages/platform-elysia/src/application/application-bootstrap.ts:135-144, 199-211, 265-284`
- Modify: `packages/platform-elysia/src/application/application-diagnostics.ts` and `.types.ts`
- Modify: `packages/devtools/src/endpoints/flow.ts:581-613`
- Test: `packages/platform-elysia/tests/application-diagnostics.test.ts`, `packages/devtools/tests/flow.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:
  - `interface InterceptorHalves { readonly before: boolean; readonly after: boolean }`
  - `ResolvedControllerEnhancers` gains `readonly halves: ReadonlyMap<ClassToken<unknown>, InterceptorHalves>`
  - `AponiaApplicationDiagnostics` gains `readonly interceptorHalves: ReadonlyMap<ClassToken<unknown>, InterceptorHalves>`

- [ ] **Step 1: Write the failing test**

In `packages/devtools/tests/flow.test.ts`. The existing case at `:613` uses prototype-method interceptors; this one uses fields, which is the shape that is currently invisible.

```ts
test("an interceptor half declared as a class field is published as a stage", async () => {
  class FieldInterceptor {
    interceptBefore = () => {};
    interceptAfter = () => {};
  }

  const application = await bootFlowApplication({ interceptor: FieldInterceptor });
  const stages = await readFlowStages(application, "get", "/flow-probe");

  // The two stages are asserted by kind and by the class they name rather than
  // by the whole stage list, because the list also carries whatever the fixture
  // route declares — a bound parameter, an invoker, a validation slot. Read the
  // fixture before writing this case and narrow it to the stages in question.
  const halves = stages.filter((stage) => stage.kind.startsWith("intercept"));

  expect(halves.map((stage) => stage.kind)).toEqual(["interceptBefore", "interceptAfter"]);
  expect(halves.map((stage) => stage.enhancer)).toEqual(["FieldInterceptor", "FieldInterceptor"]);
  // The order is the contract: the before half runs ahead of the handler and the
  // after half behind it, so the two are not adjacent unless the fixture route
  // declares nothing that runs between them.
  expect(stages.indexOf(halves[1])).toBeGreaterThan(stages.indexOf(halves[0]));
});

test("a record with no interceptor halves still answers from the prototype", async () => {
  const application = await bootFlowApplication({
    interceptor: PrototypeInterceptor,
    foreignRecord: true,
  });

  expect((await readFlowStages(application, "get", "/flow-probe")).length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/devtools/tests/flow.test.ts -t "declared as a class field"`
Expected: FAIL — the class-field stages are absent, because `declaresHalf` reads `prototype`.

- [ ] **Step 3: Read the halves off the instance**

`enhancer-resolver.ts` — `resolveEnhancers` already holds the token↔instance map inside `resolveOnce` and discards it. Compute the halves from the instances and return them beside the lists.

```ts
/** Which halves of the interceptor lifecycle a resolved class implements. */
export interface InterceptorHalves {
  readonly before: boolean;
  readonly after: boolean;
}

/**
 * Whether one interceptor **instance** implements one half.
 *
 * The instance, not the class's `prototype`: the platform calls
 * `interceptor.interceptBefore?.(…)` on the instance, so a half written as a
 * class field is an own property the prototype never carries. A reader that
 * asks the prototype misses exactly that shape.
 */
function halvesOf(instance: AponiaInterceptor): InterceptorHalves {
  return Object.freeze({
    before: typeof instance.interceptBefore === "function",
    after: typeof instance.interceptAfter === "function",
  });
}
```

Inside `resolveEnhancers`, build `const halves = new Map<ClassToken<unknown>, InterceptorHalves>()` from `interceptors.entries()` and add it to the returned frozen object.

- [ ] **Step 4: Collect both scopes into the record**

`application-bootstrap.ts` — beside `generatedInvokers` and `callbackRoutes`, collect into one map:

```ts
const interceptorHalves = new Map<ClassToken<unknown>, InterceptorHalves>();
```

After `globalEnhancers` resolves at `:140`, merge its `halves`; inside the controller loop after `resolvedEnhancers` at `:199`, merge that controller's `halves`. A class resolved at both scopes declares one set of halves, so a later merge overwrites with an identical value — state that in a comment rather than guarding it.

- [ ] **Step 5: Publish it**

`application-diagnostics.ts` — add `interceptorHalves: ReadonlyMap<ClassToken<unknown>, InterceptorHalves>` to the facts and to the record, as a frozen copy (a new `Map` over the same entries). The record's other fields are copied from caller-owned objects for the same reason; this one holds no caller object, only the boot's own map, so a shallow copy is the whole requirement.

Add the field to `AponiaApplicationDiagnostics` with a doc comment stating it is keyed by the class token because a class resolved once serves every route that names it, and that a reader must treat a missing field as "no halves recorded" rather than as "no halves declared".

- [ ] **Step 6: Read it in `/flow`**

`endpoints/flow.ts` — `declaresHalf` consults the record first and keeps the prototype probe as the fallback:

```ts
/**
 * Whether a class declares one half of the interceptor lifecycle.
 *
 * The recorded halves are the instance's own, which is what the platform calls,
 * so they answer for a half written as a class field. The `prototype` probe
 * below is the fallback for a record that carries no halves — an older or
 * foreign platform copy — and it is the narrower answer: it misses a field
 * declared half rather than reporting a stage the route does not run.
 */
function declaresHalf(
  token: ClassToken<unknown>,
  half: InterceptorHalf,
  recorded: ReadonlyMap<ClassToken<unknown>, InterceptorHalves> | undefined,
): boolean {
  const halves = recorded?.get(token);
  if (halves !== undefined) {
    return half === "interceptBefore" ? halves.before : halves.after;
  }

  const members = (token as { readonly prototype?: unknown }).prototype;

  return (
    typeof members === "object" &&
    members !== null &&
    typeof (members as Record<string, unknown>)[half] === "function"
  );
}
```

Thread `recorded` from wherever `declaringHalf` is called; it is available from the boot record the payload is already built against. The field is `unknown` at the boundary — validate it is a `Map` before use, the way the endpoint's other record reads are validated.

- [ ] **Step 7: Run the tests**

Run: `bun test packages/devtools/tests/flow.test.ts packages/platform-elysia/tests/application-diagnostics.test.ts`
Expected: PASS.

- [ ] **Step 8: Strike the limitation**

`docs/devtools.md` says the class-field gap "is the one part of this endpoint that is silent rather than stated". Remove that paragraph from the `/flow` section and its bullet from the limitations list, and remove the matching bullet in `packages/devtools/README.md` and the `AGENTS.md` bullet beginning "A half declared as a class **field** is invisible to `/flow`". Replace the `AGENTS.md` bullet with the rule that keeps the fallback honest: a record without the field falls back to the prototype, and a stage is never derived from a token that does not declare one.

- [ ] **Step 9: Run the gates**

Run: `bun run check && bun run test:coverage && bun run test:vite-plus`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add packages/platform-elysia packages/devtools docs/devtools.md
git commit -m "feat(flow): read interceptor halves from the mount, not the prototype"
```

---

## Self-review

**Spec coverage.** `#3` → Task 2. `#4` → Task 6. `#6` and `#7` → Task 3. `#8` → Task 1. `#9` → Task 4. `#10` → Task 5. The spec's contract changes: the wire bump is Task 3 Step 6; the diagnostics record fields are Task 5 Step 4 and Task 6 Step 5. The spec's "what remains limited" list is unchanged by this plan and is restated in the docs tasks. `#14`, `#15a`, `#15b`, and `#16a` are not here — they belong to the AOT plan.

**Review Focus coverage.** (1) Task 3 Step 1 asserts `status` is `null` and the doc step states the meaning. (2) Task 3 Step 1 asserts one `id` across two entries and a poller's superseding read. (3) Task 3 Step 1 asserts an empty record under `capture: false`. (4) Task 2 Step 1 asserts both sides of the refusal boundary. (5) Task 5 Step 1 and Task 6 Step 1 each assert a foreign/absent record still answers.

**Ordering.** Task 1 is independent. Task 2 is independent. Task 3 carries the contract bump, so it lands before Tasks 4 and 5, which extend the same record. Task 4 depends on Task 3's `RequestRecord`. Task 5 depends on Task 3's completion path. Task 6 is independent of all of them.
