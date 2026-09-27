# Logger rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The built-in logger renders every value it is handed or states that it could not; the
framework's error path answers its Problem Details response whether or not the configured logger
throws; and the account a thrown value is stated as has one definition in `@aponiajs/common`
instead of copies kept in step by hand.

**Architecture:** `common`'s logging domain gains the literal a value that refuses is stated as, and
one guarded function that renders a value into text. The platform's route-local `error` mapping and
the devtools log tap both call that function, so the two surfaces cannot disagree about one failure;
the console logger keeps its own `inspect`-based text form and shares only the literal, because the
two forms are written for different readers.

**Tech Stack:** TypeScript (strict, ESM, `#private`), Bun test, Vite+ conformance, Elysia 1.4.

**Spec:** `docs/superpowers/specs/2026-09-27-aponia-logger-rendering-design.md`

## Corrections the spec needs, settled before Task 1

Three claims in the spec are not true of the code, and a plan that argues from them would put the
error into tasks. Each is settled here, with what was checked.

**1. Change #3 names the wrong pair.** The spec says "`packages/devtools`' `projectMessage` and
`ConsoleLogger#stringify` are two implementations of the same idea … Task 5 on the devtools branch
made them identical branch for branch, including the literal, and pinned that with a parity test."
They are not identical, and Task 5 never touched the console logger (`git log --oneline --
packages/common/src/logging/console-logger.ts` stops at `62e9926`):

| Function                                       | Package           | Branches                                                                                                                                                    |
| ---------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ConsoleLogger#stringify`                      | `common`          | string → itself; function → `name \|\| toString()`; else `inspect(...)`                                                                                     |
| `log-tap.ts#projectMessage`                    | `devtools`        | string → itself; function → `name \|\| "(anonymous)"`; `Error` → `name: message`; else `JSON.stringify(x) ?? String(x)`; then `String(x)`; then the literal |
| `default-exception-filter.ts#exceptionMessage` | `platform-elysia` | **identical to `projectMessage`, branch for branch, literal included**                                                                                      |

The pinned pair is `devtools` ↔ `platform-elysia`. `docs/devtools.md:575` says so in as many words
("duplicated across two packages … `@aponiajs/platform-elysia` restates the devtools log stream's
projection branch for branch"), the parity case is
`packages/devtools/tests/requests.test.ts:982` ("the exception the record reports is the one the log
stream states"), and the spec's own Testing section agrees: "one case asserts the exported function
is what both surfaces call" — the two surfaces are `/requests` and `/logs`, not the console. So
Task 3 exports the projection `devtools` and `platform-elysia` both restate, and the console logger
keeps `inspect`. Unifying the console form with the wire form would replace `inspect` with
`JSON.stringify` in every application's console output — a visible behavior change the spec's "What
this does not change" section does not contemplate, and one that would delete the reason
`ConsoleLoggerOptions.compact` and `.depth` exist.

**2. Change #1 describes branches `#stringify` does not have.** It says "the function-name branch,
the `Error` branch, `inspect`, and the `String` floor all move inside one `try`". `#stringify` has no
`Error` branch and no `String` floor; those belong to the projection. Task 1 states `#stringify`'s
real branches, and guards the whole body in one `try` because `inspect` runs whatever a value
declared for itself through its own hooks — the branch somebody noticed first is not the only one
that can refuse.

**3. The "literal's family" testing bullet is not implementable as written.** It asks for a case
asserting `[unrenderable]` "sits beside its four siblings where the published documents list them".
No published document lists them: `docs/devtools.md` names `[redacted]` at `:425`,
`[unserializable]` at `:429`, and `[unprojectable]` at `:452`, each where its own field is described.
Task 4 implements the intent — a reader meets one family and not two conventions — as a guard that no
published surface still states a literal this release retired. That guard is also the only thing that
catches a missed rename, which is exactly the defect class this branch has been closing.

## Global Constraints

- Every file, comment, and document is English. Before finishing a task:
  `rg -nP '[\x{0E00}-\x{0E7F}]' --glob '!node_modules/**' --glob '!dist/**' .`
- **Do not push, and do not bump the version.** This branch is unpushed and the version gate is a
  push-time step (`docs/releasing.md`); `bun run version:alpha` runs when this work is pushed.
- **The console logger keeps `inspect`.** Its text form is for a terminal reader and the shared
  rendering is for a wire reader. Do not route `#stringify` through `renderLogValue`.
- **`renderLogValue` is the shipped projection moved, not redesigned.** Its branches must match
  `projectMessage`/`exceptionMessage` as they stand today, branch for branch. The only wire change in
  this plan is the literal.
- **The literal is `[unrenderable]`.** No other literal changes word: `[redacted]`, `[truncated]`, and
  `[unserializable]` stay exactly as they are.
- Gates before each task's commit: `bun run check` plus the lanes that task names. Whole-branch
  verification runs `bun run check`, `bun run test:coverage`, `bun run test:vite-plus`, and
  `bun run release:dry-run` (the barrel gains an export, so published contents change), then
  `bun run build` followed by `bun run test:generated-app`. After any `bun run build`, delete the
  declarations it leaves beside sources before a test lane:
  `find packages -name '*.d.ts' -path '*/src/*' -delete`.
- Commit bodies explain why the change is right, in the style of the commits already on this branch,
  and end with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- `bun run check` reformats Markdown. Match the on-disk text (`_emphasis_`, not `*emphasis*`) when
  editing a document by hand.

## Review Focus

Five input classes the spec implies and no task's prose would otherwise cover. Each line's test is in
the task named beside it.

1. **A logger whose `error` throws while reporting an unhandled failure.** A reasonable person
   expects the client to receive the `500` Problem Details answer, the exception still to be recorded,
   and the logger's own failure to be visible somewhere. (Task 2)
2. **A logger whose `log` throws while the boot logs its routes.** The boot fails, loudly, and that is
   the boundary rather than an oversight: the error path is the only call site whose failure would
   cost an answer, so it is the only one guarded. (Task 2)
3. **A value that refuses `JSON.stringify` under `json: true`** — a cyclic object, or one carrying a
   `BigInt`, which is what a database identifier is. One parseable line whose `message` is
   `[unrenderable]`, not a missing line and not a thrown error. (Task 1)
4. **A value that refuses `inspect`'s own reads.** The text path renders `{}` rather than the literal,
   and does not throw — the negative case, so no guard is written for a shape that cannot throw.
   (Task 1)
5. **A value that refuses the plain string form as well.** `/logs` and `/requests` state the same
   word, `[unrenderable]`, and neither throws; a value that refuses only `JSON.stringify` falls
   through to the plain string form rather than to the literal. (Task 4)

---

### Task 1: The built-in logger cannot throw

**Files:**

- Create: `packages/common/src/logging/log-value.ts`
- Modify: `packages/common/src/logging/console-logger.ts`
- Modify: `packages/devtools/tests/requests.test.ts:386-396` (a comment that this task falsifies)
- Test: `packages/common/tests/console-logger.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `unrenderableValue` — `const unrenderableValue = "[unrenderable]"`, exported from
  `packages/common/src/logging/log-value.ts` and **not** from the package barrel. Task 3 adds
  `renderLogValue` to the same file and exports it; Task 4 moves both consumers onto it.

- [ ] **Step 1: Create the module that owns the literal**

`packages/common/src/logging/log-value.ts`:

```ts
/**
 * How a logged value is stated in text, and what a value this release cannot
 * state is stated as instead.
 */

/**
 * The literal a value this release cannot render is stated as.
 *
 * A value's place states that the tool could not turn it into text, rather than
 * the field being absent or the line failing. An absent field reads as a value
 * the caller never passed, and a thrown error is a different fact entirely. It
 * joins `[redacted]`, `[truncated]`, and `[unserializable]` as the family of
 * literals this framework states in a value's place.
 */
export const unrenderableValue = "[unrenderable]";
```

- [ ] **Step 2: Write the failing tests**

Append these three cases inside the existing `describe("ConsoleLogger", …)` block in
`packages/common/tests/console-logger.test.ts`:

```ts
test.serial("states a value it cannot render instead of throwing", () => {
  const stdout: string[] = [];
  const stdoutWrite = spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });

  try {
    // The read the projection makes of the value itself: a function is named by
    // a property that can be declared as a getter that throws.
    const refusal = function refusingName(): void {};
    Object.defineProperty(refusal, "name", {
      get() {
        throw new TypeError("this value refuses to be named");
      },
    });

    new ConsoleLogger({ colors: false }).log(refusal);

    // The line is the assertion, not the absence of a throw: a logger that threw
    // wrote nothing, and a logger that wrote nothing would satisfy a bare
    // "did not throw" on its own.
    expect(stdout).toHaveLength(1);
    expect(stdout[0]).toContain("[unrenderable]");
  } finally {
    stdoutWrite.mockRestore();
  }
});

test.serial("states a JSON line for a value it cannot serialize", () => {
  const stderr: string[] = [];
  const stderrWrite = spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });

  try {
    const logger = new ConsoleLogger({ json: true });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    // Two shapes, because they refuse the same call for different reasons: a
    // value that refers to itself, and a `BigInt`, which is what a database
    // identifier is.
    logger.error(cyclic);
    logger.error({ id: 1n });

    const records = stderr.map(parseJsonRecord) as readonly Record<string, unknown>[];

    // A real line with the literal in the field, rather than no line at all: a
    // consumer parsing the stream cannot tell a dropped message from one the
    // caller never passed.
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      level: "error",
      pid: process.pid,
      message: "[unrenderable]",
    });
    expect(records[1]).toMatchObject({ level: "error", message: "[unrenderable]" });
  } finally {
    stderrWrite.mockRestore();
  }
});

test.serial("renders a value that refuses inspection as an empty object", () => {
  const stdout: string[] = [];
  const stdoutWrite = spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });

  try {
    // The negative case, and the reason this plan's guard is one `try` rather
    // than a list: `util.inspect` absorbs a refusing trap and renders `{}`, so
    // this shape cannot reach the literal and no guard belongs here for it.
    const refusal = new Proxy(
      {},
      {
        get() {
          throw new TypeError("this value refuses to be read");
        },
        ownKeys() {
          throw new TypeError("this value refuses to be enumerated");
        },
        getOwnPropertyDescriptor() {
          throw new TypeError("this value refuses to describe itself");
        },
      },
    );

    new ConsoleLogger({ colors: false }).log(refusal);

    expect(stdout).toHaveLength(1);
    expect(stdout[0]).toContain("{}");
    expect(stdout[0]).not.toContain("[unrenderable]");
  } finally {
    stdoutWrite.mockRestore();
  }
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test packages/common/tests/console-logger.test.ts`
Expected: the first two fail — the function-name case throws `TypeError: this value refuses to be
named` out of `logger.log`, and the JSON case throws
`TypeError: JSON.stringify cannot serialize cyclic structures.` The third passes already.

- [ ] **Step 4: Guard both rendering paths**

In `packages/common/src/logging/console-logger.ts`, add the import beside the existing type import:

```ts
import { unrenderableValue } from "./log-value.ts";
```

Replace `#formatJson` with:

```ts
  /**
   * One JSON line, or a line that states the value could not be serialized.
   *
   * `JSON.stringify` refuses two shapes an application logs in the ordinary
   * course of things: an object that refers to itself — any parent and child
   * that point at each other — and one carrying a `BigInt`, which is what a
   * database identifier is. The fallback is a real line with the literal in the
   * `message` field rather than no line at all, because a consumer parsing the
   * stream cannot tell a message that was dropped from one the caller never
   * passed. It cannot refuse in turn: every field it carries is a primitive this
   * logger read from its own configuration.
   */
  #formatJson(level: LogLevel, message: unknown, context: string, timestamp: number): string {
    const record = { level, pid: process.pid, timestamp, message, ...(context ? { context } : {}) };

    try {
      return JSON.stringify(record);
    } catch {
      return JSON.stringify({ ...record, message: unrenderableValue });
    }
  }
```

Replace `#stringify` with:

```ts
  /**
   * The text this logger states a value as, or the literal when the value
   * refuses every read.
   *
   * The whole body is inside one `try` rather than a guard per read: a function's
   * `name` can be a getter that throws, and `inspect` runs whatever the value
   * declared for itself, so the branch that was noticed first is not the only one
   * that can refuse. One guard makes "this cannot throw" true by construction
   * instead of true for the shapes somebody thought of.
   */
  #stringify(message: unknown): string {
    try {
      if (typeof message === "string") {
        return message;
      }
      if (typeof message === "function") {
        return message.name || message.toString();
      }

      return inspect(message, {
        colors: this.#options.colors,
        compact: this.#options.compact ?? true,
        depth: this.#options.depth ?? 5,
        breakLength: Number.POSITIVE_INFINITY,
      });
    } catch {
      return unrenderableValue;
    }
  }
```

- [ ] **Step 5: Correct the comment in the devtools lane that this falsifies**

`packages/devtools/tests/requests.test.ts:386-396` documents `silentFailureLogger` with a claim about
the console logger that this step makes false — it says the console logger "restates a projection of
its own … and its function branch reads `name` exactly as this package's does, so a value that
refuses to be named throws out of that read as readily as out of this one." Replace that doc comment
with:

```ts
/**
 * A logger that writes nothing, for the case that has to isolate the projection.
 *
 * A boot reports a failure through the logger it was handed, and this package's
 * tap records the line before handing the call on, so a logger double keeps the
 * case about the projection: the failure is reported through it, the tap states
 * the value, and nothing below the tap reads the value a second time.
 */
```

The double is kept rather than replaced with the framework's own logger: with it, the case asserts
this package's projection and nothing about the logger beneath it.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test packages/common/tests/console-logger.test.ts packages/devtools/tests/requests.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the gates and commit**

```bash
bun run check
bun run test:coverage
bun run test:vite-plus
git add packages/common/src/logging/log-value.ts packages/common/src/logging/console-logger.ts \
  packages/common/tests/console-logger.test.ts packages/devtools/tests/requests.test.ts
git commit
```

Commit subject: `fix(common): render a value the logger cannot read instead of throwing`

Body states: `ConsoleLogger` read a logged value with no `try` in the file, so a value that refused
the read — a function whose `name` is a throwing getter, or under `json: true` any object that refers
to itself or carries a `BigInt` — made `logger.error(value)` throw instead of logging. Both paths now
take one outer `try`, and a refusal is stated as `[unrenderable]` rather than as an absent line.

---

### Task 2: The error path does not depend on the logger

**Files:**

- Modify: `packages/common/src/logging/logger.types.ts`
- Modify: `packages/platform-elysia/src/errors/default-exception-filter.ts`
- Modify: `packages/platform-elysia/AGENTS.md` (the default-mapping bullet)
- Modify: `docs/logging.md` ("Custom logger", a paragraph at the end of the section)
- Test: `packages/platform-elysia/tests/application-diagnostics.test.ts:426-448` (flipped) and the
  new boot-boundary case
- Test: `packages/platform-elysia/tests-vp/platform.conformance.ts`

**Interfaces:**

- Consumes: `unrenderableValue` (Task 1) — not directly; this task keeps the file's own
  `exceptionMessage` and `plainString` and moves them onto the shared function in Task 4.
- Produces: `createDefaultExceptionFilter` keeps its signature
  `(logger: LoggerService | undefined, mappedExceptions: WeakMap<Request, string>) => ElysiaErrorHook`.
  A logger that throws no longer escapes the hook.

- [ ] **Step 1: Write the failing test (the regression, flipped)**

`packages/platform-elysia/tests/application-diagnostics.test.ts:426-448` currently asserts the
defect: its case is named "a logger that throws as it reports the failure does not take the record
with it", and its body wraps `await application.handle(request)` in `try { … } catch { }` because the
logger's throw leaves the hook. Replace the whole case with:

```ts
test("a logger that throws as it reports the failure leaves the answer and the record intact", async () => {
  const logger = new ThrowingErrorLogger();
  const application = await AponiaFactory.create(FailingDiagnosticsModule, { logger });
  const diagnostics = readApplicationDiagnostics(application.getNativeApplication());
  const request = new Request("http://localhost/explodes");
  const stderr: string[] = [];
  const stderrWrite = spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });

  try {
    const response = await application.handle(request);
    await response.text();

    // The answer first, and it is the whole defect: this hook's return value is
    // what the client receives, so a throw out of it replaces the application's
    // Problem Details response with the engine's own page. `LoggerService` is a
    // public interface an application implements, and the framework may not
    // depend on the one property that keeps this safe.
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    // The record survives too — it is the only place `/requests` can read the
    // failure's message from, because the `Response` above is not on the
    // after-response context.
    expect(logger.reported).toBe(true);
    expect(diagnostics?.mappedExceptions.get(request)).toBe(
      "Error: the connection string was rejected",
    );
    // And the logger's own failure is stated rather than swallowed: the channel
    // that would normally carry it is the one that just failed, so an application
    // whose logger throws on every line would otherwise see neither its logs nor
    // any sign that its logger is broken.
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toContain("[ExceptionsHandler]");
    expect(stderr[0]).toContain("the configured logger threw");
    expect(stderr[0]).toContain("the logger refused to report the failure");
  } finally {
    stderrWrite.mockRestore();
    await application.close();
  }
});
```

Add the boot-boundary case below it, and add the fixture it needs beside `ThrowingErrorLogger`
(`packages/platform-elysia/tests/application-diagnostics.test.ts:175-188`):

```ts
/** A logger that refuses where the boot writes its own lines. */
class ThrowingBootLogger implements LoggerService {
  log(): void {
    throw new Error("the logger refused to report the boot's routes");
  }

  fatal(): void {}
  error(): void {}
  warn(): void {}
  debug(): void {}
  verbose(): void {}
}
```

```ts
test("a logger that throws while the boot logs its routes fails the boot", async () => {
  // The boundary, pinned rather than left to be discovered. The error path guards
  // its logger call because the response depends on it; no other framework call
  // site does, and the boot's own lines are where a throw is loud at the one
  // moment there is no answer to lose. A boot that started anyway would be an
  // application whose logger is broken and whose silence nothing reports.
  await expect(
    AponiaFactory.create(FailingDiagnosticsModule, { logger: new ThrowingBootLogger() }),
  ).rejects.toThrow("the logger refused to report the boot's routes");
});
```

`spyOn` is imported from `bun:test` at the top of that file (`import { expect, spyOn, test }`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test packages/platform-elysia/tests/application-diagnostics.test.ts`
Expected: the flipped case fails on `expect(response.status).toBe(500)` — the request rejects with
the logger's `Error` instead of answering. The boot-boundary case passes already.

- [ ] **Step 3: Guard the call and report a logger that refuses**

In `packages/platform-elysia/src/errors/default-exception-filter.ts`, replace the hook body and the
comment above it:

```ts
export function createDefaultExceptionFilter(
  logger: LoggerService | undefined,
  mappedExceptions: WeakMap<Request, string>,
): ElysiaErrorHook {
  return ({ error, request, set }) => {
    if (elysiaAnswersThis(error, set.status)) {
      return undefined;
    }

    // The record is written before the logger is called, and the call is guarded.
    // The record is the only place `/requests` can read this failure's message
    // from, because the `Response` below is not on the after-response context, and
    // the guard is what keeps a throw out of a hook whose return value is the
    // client's answer — see `reportUnhandledFailure`.
    recordMappedException(mappedExceptions, request, error);
    reportUnhandledFailure(logger, error);
    return httpErrors.internalServerError(unhandledFailureDetail).toResponse();
  };
}

/**
 * Reports an unhandled failure through the application's logger, and never lets
 * the logger's own failure become the client's answer.
 *
 * `LoggerService` is a public interface and an application's implementation of it
 * may throw, so the framework may not read a call as a promise the interface
 * makes. This is the one call site where that costs an answer: the hook this runs
 * in returns the response the client receives, so a throw here would replace the
 * application's Problem Details answer with the engine's own page. The built-in
 * logger no longer refuses any value, which is why this guard is not the whole
 * story — it is the half that holds for a logger this framework did not build.
 *
 * A logger that refuses is reported rather than swallowed, on `stderr` by a direct
 * write, because the channel that would normally carry the diagnostic is the one
 * that just failed. This is the only place this package writes a process stream,
 * and the layering cost is real — logging is `common`'s domain — and it is
 * accepted because the alternative is a logger that is broken and invisible.
 */
function reportUnhandledFailure(logger: LoggerService | undefined, error: unknown): void {
  try {
    logger?.error(error, "ExceptionsHandler");
  } catch (loggerFailure) {
    announceLoggerFailure(loggerFailure);
  }
}

/**
 * States a logger's own failure where a reader will see it.
 *
 * Guarded for the same reason the call above is: an application can be writing to
 * a closed stream, and a throw out of this one would leave the error hook with no
 * response at all — the outcome this whole path exists to prevent. A stderr write
 * that refuses leaves nothing further to report to, so the absence is accepted at
 * the last line rather than taken out on the client's answer.
 */
function announceLoggerFailure(loggerFailure: unknown): void {
  try {
    process.stderr.write(
      `[Aponia] ${process.pid} - ERROR [ExceptionsHandler] the configured logger threw while ` +
        `reporting an unhandled failure: ${exceptionMessage(loggerFailure)}\n`,
    );
  } catch {
    // Nothing left to report to.
  }
}
```

Also update `createDefaultExceptionFilter`'s own doc block (`:71-73`) — after "The system logger
receives the exception it maps, so an unhandled failure is still reported where an application reads
its logs.", append:

```
 * The call is guarded, and a logger that refuses is reported on `stderr` instead:
 * `LoggerService` is a public interface an application implements, so a throw is
 * not this mapping's to depend on, and the response above is not the logger's to
 * replace.
```

- [ ] **Step 4: State the contract the change settles**

In `packages/common/src/logging/logger.types.ts`, put this doc block above `interface LoggerService`:

```ts
/**
 * The logger contract a boot and an application both write through.
 *
 * A method may throw. This interface is public and an application's own
 * implementation answers for itself, so the framework never reads a successful
 * call as a promise the interface makes. `ConsoleLogger`, the one this framework
 * builds, does not throw: it renders every value it is handed, or states that it
 * could not. That is a property of that class rather than of this contract, and
 * both halves are needed — a caller that must not be harmed by a throw guards for
 * itself, and an application that hands over a logger gets one that cannot cost
 * it a response.
 *
 * One call site needs that guard: the platform's default mapping reports an
 * unhandled failure through `error` from inside the hook whose return value is
 * the response, so it guards the call and answers whatever the logger does, and
 * reports a logger that refused on `stderr`. Everywhere else a throw is a throw —
 * a logger that fails while the boot logs its routes fails the boot, which is
 * loud at the one moment there is no answer to lose.
 */
```

- [ ] **Step 5: Add the Vite+ conformance case**

Append to `packages/platform-elysia/tests-vp/platform.conformance.ts`, and add `type LoggerService`
to its `@aponiajs/common` import list:

```ts
@Controller("exploding")
class ExplodingController {
  @Get()
  explode(): never {
    throw new Error("the raw exception");
  }
}

@Module({ controllers: [ExplodingController] })
class ExplodingModule {}

/** A logger whose `error` refuses, supplied by an application rather than built by the framework. */
const refusingLogger: LoggerService = {
  log(): void {},
  fatal(): void {},
  warn(): void {},
  error(): void {
    throw new Error("the logger refused to report the failure");
  },
};

test("the Vite+ lane answers Problem Details when the configured logger throws", async () => {
  const application = await AponiaFactory.create(ExplodingModule, { logger: refusingLogger });

  const response = await application.handle(new Request("http://localhost/exploding"));

  expect(response.status).toBe(500);
  expect(response.headers.get("content-type")).toContain("application/problem+json");
  await application.close();
});
```

This case writes one `[Aponia] … the configured logger threw …` line to `stderr` when it runs, because
the framework reports a refusing logger rather than swallowing it. That line is the behavior, not
noise from the test.

- [ ] **Step 6: Update the platform guide**

In `packages/platform-elysia/AGENTS.md`, the default-mapping bullet contains this sentence: "The
record is written before the logger is called, because a logger that throws as it reports the failure
would otherwise take that record with it; the other order costs the logger nothing, because it is
handed the exception either way." Replace it with:

```
  The record is written before the logger is called, and the call is guarded: a
  logger that throws as it reports the failure leaves both the record and the
  Problem Details answer intact, because the response depends on the hook returning
  and a logger an application supplies may throw. Such a logger is reported on
  `stderr` by a direct write — the only place this package writes a process
  stream — because the channel that would normally carry the diagnostic is the one
  that failed. No other framework call site is guarded: a logger that throws while
  the boot logs its routes fails the boot.
```

- [ ] **Step 7: Document the contract for an application that writes its own logger**

At the end of the "Custom logger" section in `docs/logging.md` — after the paragraph "System events
pass their subsystem name as the final parameter, allowing custom loggers to preserve contextual
filtering." — add:

```markdown
A method of your logger may throw. The framework never reads a successful call as a promise this
contract makes, so it guards the one call site where a throw would cost an answer: an unhandled
failure is reported through `error` from inside the route's error hook, whose return value is the
response the client receives, and that call is guarded so the Problem Details response is returned
whether or not the logger reported the failure. A logger that refuses there is reported on `stderr`
by a direct write rather than swallowed, because the channel that would normally carry the diagnostic
is the one that failed. Everywhere else a throw is a throw — a logger that fails while the boot logs
its routes fails the boot. The framework's own logger needs no such care: `ConsoleLogger` renders
every value it is handed, or states `[unrenderable]`.
```

- [ ] **Step 8: Run the gates and commit**

Run: `bun test packages/platform-elysia/tests/application-diagnostics.test.ts`, then

```bash
bun run check
bun run test:coverage
bun run test:vite-plus
git add docs/logging.md packages/common/src/logging/logger.types.ts \
  packages/platform-elysia/src/errors/default-exception-filter.ts \
  packages/platform-elysia/AGENTS.md \
  packages/platform-elysia/tests/application-diagnostics.test.ts \
  packages/platform-elysia/tests-vp/platform.conformance.ts
git commit
```

Commit subject: `fix(platform-elysia): answer problem details when the logger throws`

Body states: the default mapping reported an unhandled failure through `logger.error(...)` from inside
the route-local hook whose return value is the response, so a value the configured logger refused
replaced the application's Problem Details answer with the engine's page. The call is guarded, the
refusal is reported on `stderr`, and the contract `LoggerService` never declared is stated on the
interface: the built-in logger does not throw, and the framework does not rely on that.

---

### Task 3: `common` exports the rendering

**Files:**

- Modify: `packages/common/src/logging/log-value.ts` (add `renderLogValue`)
- Modify: `packages/common/src/index.ts:50-51`
- Modify: `packages/common/llms.txt:35`
- Modify: `docs/logging.md` (a new section at the end)
- Test: `packages/common/tests/log-value.test.ts` (create)
- Test: `packages/common/tests-vp/contracts.conformance.ts`

**Interfaces:**

- Consumes: `unrenderableValue` (Task 1).
- Produces: `renderLogValue(value: unknown): string`, exported from `@aponiajs/common`. Task 4 calls
  it from `packages/platform-elysia/src/errors/default-exception-filter.ts` and
  `packages/devtools/src/logging/log-tap.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/common/tests/log-value.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { renderLogValue } from "../src/index.ts";

/** A value that refers to itself, so `JSON.stringify` refuses it. */
function cyclicRefusal(): Record<string, unknown> {
  const refusal: Record<string, unknown> = {};
  refusal.self = refusal;

  return refusal;
}

/** A value that refuses the plain string form as well as the JSON form. */
function totalRefusal(): Record<string, unknown> {
  const refusal = cyclicRefusal();
  Object.defineProperty(refusal, Symbol.toPrimitive, {
    value: () => {
      throw new TypeError("this value cannot be stated");
    },
  });

  return refusal;
}

describe("renderLogValue", () => {
  test("states each shape a value arrives in", () => {
    function NamedTask(): void {}

    // The branches, one case each: a string is its own text, a function is its
    // name, an `Error` is its name and message and never its stack, and anything
    // else is its JSON form.
    expect(renderLogValue("a message")).toBe("a message");
    expect(renderLogValue(NamedTask)).toBe("NamedTask");
    expect(renderLogValue(new TypeError("the connection was refused"))).toBe(
      "TypeError: the connection was refused",
    );
    expect(renderLogValue({ code: "E_CONN", retries: 3 })).toBe('{"code":"E_CONN","retries":3}');
  });

  test("states an unnamed function and an undefined JSON form by their plain form", () => {
    // A function whose `name` is empty, and a value `JSON.stringify` answers
    // `undefined` for: both fall to the next read rather than to the literal.
    const unnamed = (() => () => {})();
    Object.defineProperty(unnamed, "name", { value: "" });

    expect(renderLogValue(unnamed)).toBe("(anonymous)");
    expect(renderLogValue(undefined)).toBe("undefined");
  });

  test("states a value that refuses the JSON form by its plain string form", () => {
    // A refusal at `JSON.stringify` alone is not a value this release cannot
    // state: the plain form is tried once more before the literal.
    expect(renderLogValue(cyclicRefusal())).toBe("[object Object]");
  });

  test("states a value that refuses every read as the literal", () => {
    expect(renderLogValue(totalRefusal())).toBe("[unrenderable]");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/common/tests/log-value.test.ts`
Expected: FAIL — `renderLogValue` is not exported from `../src/index.ts`.

- [ ] **Step 3: Add the function and export it**

Append to `packages/common/src/logging/log-value.ts`:

```ts
/**
 * The account of a value, as the text a surface states it in.
 *
 * It is the rendering a thrown value is reported as on every surface this
 * framework publishes one: the devtools log stream's entry for a line, and the
 * exception the platform's default mapping records for `/requests`. One
 * definition rather than a copy, so two surfaces reporting one failure cannot
 * disagree about it.
 *
 * The text is not folded to one line. A string is its own text, newlines
 * included, because a surface states what happened rather than editing it.
 *
 * It may not throw, whatever it is handed. One caller is the platform's error
 * hook: it reports an unhandled failure by logging it from inside the hook whose
 * return value is the response the client receives, so a throw here would replace
 * the application's answer with the engine's own page. The whole body is guarded
 * rather than the reads somebody thought of — a `Proxy` refuses `instanceof`,
 * `JSON.stringify` refuses a value that refers to itself or whose `toJSON`
 * throws, and a function's `name` refuses when it is a getter that throws — and
 * a value that refuses even the plain string form is stated as the literal.
 */
export function renderLogValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    if (typeof value === "function") {
      return value.name || "(anonymous)";
    }
    if (value instanceof Error) {
      // The name and the message, never the stack: a stack describes the
      // internals of the running application, and a record a page reads is no
      // place for one.
      return `${value.name}: ${value.message}`;
    }

    return JSON.stringify(value) ?? String(value);
  } catch {
    return plainStringValue(value);
  }
}

/**
 * The plain string form of a value, or the literal when even that refuses.
 *
 * This is the last read the rendering makes, and it is guarded on its own because
 * a value can refuse the plain string form as readily as it refused everything
 * before it. A value whose `toPrimitive` or `toString` throws is a value this
 * release cannot state, and saying so in a literal is the honest account where a
 * throw is a different answer rather than a report of one.
 */
function plainStringValue(value: unknown): string {
  try {
    return String(value);
  } catch {
    return unrenderableValue;
  }
}
```

In `packages/common/src/index.ts:50`, add beside the existing logging exports:

```ts
export { renderLogValue } from "./logging/log-value.ts";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/common/tests/log-value.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the Vite+ conformance case**

Append to `packages/common/tests-vp/contracts.conformance.ts`, adding `renderLogValue` to its
`../src/index.ts` import list:

```ts
test("the Vite+ lane renders a logged value and never throws", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  Object.defineProperty(cyclic, Symbol.toPrimitive, {
    value: () => {
      throw new TypeError("this value cannot be stated");
    },
  });

  expect(renderLogValue({ ready: true })).toBe('{"ready":true}');
  expect(renderLogValue(cyclic)).toBe("[unrenderable]");
});
```

- [ ] **Step 6: Document the export**

In `packages/common/llms.txt`, beside the `logger.types.ts` entry at line 35, add:

```
- [renderLogValue](https://github.com/aponiajs/aponiajs/blob/release/alpha/packages/common/src/logging/log-value.ts): the text a logged value is stated as, and `[unrenderable]` for a value it cannot state.
```

In `docs/logging.md`, append at the end of the file — after the "Custom logger" section, whose
closing paragraph is "System events pass their subsystem name as the final parameter, allowing custom
loggers to preserve contextual filtering." — a new section:

```markdown
## Stating a value

`renderLogValue` turns a logged value into the text a surface states it in: a string is its own text,
a function is its name, an `Error` is its name and message with no stack, and everything else is its
JSON form with the plain string form behind it. A value that refuses every one of those reads is
stated as `[unrenderable]` rather than allowed to throw, which is what the devtools log stream and
the platform's exception record both rely on — they call this one function, so they cannot disagree
about a failure they both report. The console logger prints its own form for a terminal reader and
answers the same literal when a value refuses it.
```

- [ ] **Step 7: Run the gates and commit**

```bash
bun run check
bun run test:coverage
bun run test:vite-plus
git add packages/common/src/logging/log-value.ts packages/common/src/index.ts \
  packages/common/llms.txt packages/common/tests/log-value.test.ts \
  packages/common/tests-vp/contracts.conformance.ts docs/logging.md
git commit
```

Commit subject: `feat(common): export the rendering of a logged value`

Body states: this is the projection the platform's exception record and the devtools log stream each
restated branch for branch, moved to one definition in the logging domain that owns the literal.
Registered as public API deliberately: it is what a consumer publishing its own surface states a
value with, and two copies kept in step by a test is the thing being removed. Task 4 moves both
callers onto it; nothing calls it yet.

---

### Task 4: One definition on both surfaces, and the literal renamed

**Files:**

- Modify: `packages/devtools/src/logging/log-tap.ts`
- Modify: `packages/platform-elysia/src/errors/default-exception-filter.ts`
- Modify: `packages/devtools/AGENTS.md`
- Modify: `packages/platform-elysia/AGENTS.md`
- Modify: `docs/devtools.md`
- Modify: `packages/devtools/README.md`
- Modify: `packages/devtools/llms.txt`
- Modify: `packages/devtools/tests/requests.test.ts`
- Modify: `packages/platform-elysia/tests/application-diagnostics.test.ts`
- Create: `scripts/retired-literals.spec.ts`
- Modify: `scripts/AGENTS.md`

**Interfaces:**

- Consumes: `renderLogValue` (Task 3).
- Produces: nothing. After this task `[unprojectable]` appears in no published surface and no source,
  and `/logs`' `message` and `/requests`' `error` are both `renderLogValue`'s answer.

- [ ] **Step 1: Enumerate every site the rename reaches**

```bash
rg -n "unprojectable" --glob '!node_modules/**' --glob '!dist/**' .
```

Expected sites: `packages/devtools/src/logging/log-tap.ts` (`:257`, `:306`),
`packages/platform-elysia/src/errors/default-exception-filter.ts` (`:27`, `:187`),
`packages/devtools/tests/requests.test.ts:1001`, and
`packages/platform-elysia/tests/application-diagnostics.test.ts:468`, plus these documents:
`docs/devtools.md:452` and `:575`, `packages/devtools/README.md:218`, `packages/devtools/llms.txt:38`.
Anything else the grep prints is a site this step must also reach — the two spec and plan files under
`docs/superpowers/` are the only allowed exceptions, because they are the record of the change.

- [ ] **Step 2: Write the guard**

Create `scripts/retired-literals.spec.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { Glob } from "bun";

/**
 * Literals this framework has retired, and what replaced them.
 *
 * A literal is what a surface states in a value's place, so a document that names
 * one the code no longer emits describes a payload no reader will see. Nothing
 * compiles a document, which is why a rename is the change that leaves this class
 * of defect behind, and why it is guarded here rather than reviewed.
 */
const retiredLiterals = [{ literal: "[unprojectable]", replacedBy: "[unrenderable]" }] as const;

/**
 * The surfaces a reader meets: published documents, package guides, sources, and
 * the tests that state what a surface emits.
 *
 * `docs/superpowers/` is deliberately outside the set. A spec or a plan is the
 * record of a change, so it names the literal it retired on purpose — including
 * this file, which states one as its own data.
 */
const publishedSurfaces = [
  "README.md",
  "AGENTS.md",
  "RULES.md",
  "docs/*.md",
  "docs/learn/*.md",
  "packages/*/README.md",
  "packages/*/llms.txt",
  "packages/*/AGENTS.md",
  "packages/*/src/**/*.ts",
  "packages/*/tests/**/*.ts",
  "packages/*/tests-vp/**/*.ts",
] as const;

describe("retired literals", () => {
  for (const retired of retiredLiterals) {
    test(`no published surface states ${retired.literal}`, async () => {
      const offenders: string[] = [];

      for (const pattern of publishedSurfaces) {
        for await (const path of new Glob(pattern).scan(".")) {
          const content = await Bun.file(path).text();
          if (content.includes(retired.literal)) {
            offenders.push(path);
          }
        }
      }

      expect(offenders).toEqual([]);
    });
  }
});
```

Add a row to the table in `scripts/AGENTS.md`, keeping its column alignment:

```
| `retired-literals.spec.ts`   | Literals a published surface may no longer state                          |
```

- [ ] **Step 3: Run the guard to verify it fails**

Run: `bun test scripts/retired-literals.spec.ts`
Expected: FAIL, listing the surfaces that still state `[unprojectable]`.

- [ ] **Step 4: Move both callers onto the shared rendering**

In `packages/devtools/src/logging/log-tap.ts`:

- add `import { renderLogValue } from "@aponiajs/common";` beside the existing type-only import;
- delete `unprojectableValue` (`:246-257`), `projectMessage` (`:259-286`), and `plainString`
  (`:288-308`);
- replace `projectMessage(message)` in `createLogEntry` with `renderLogValue(message)`;
- replace `createLogEntry`'s doc comment with:

```
 * `message` is rendered by `@aponiajs/common`'s `renderLogValue` rather than left
 * to `JSON.stringify`, because a logger's arguments are `unknown` by contract: an
 * `Error` would serialize as `{}`, a function as nothing at all, and a value that
 * refers to itself would fail the payload on the request that asked for it. It is
 * one definition rather than a copy of one: `/requests` states the exception the
 * platform's mapping recorded through the same call, so the two surfaces cannot
 * disagree about a failure they both report, and the literal a value that refuses
 * everything is stated as is the same word on both by construction.
 *
 * A line is reported as the caller wrote it: the text is not folded to one line,
 * because a devtools stream states what happened rather than editing it. The
 * rendering may not throw — it runs inside a patched logger method, and one caller
 * of a logger method is the platform's error hook reporting an unhandled failure —
 * and `renderLogValue` is total.
```

In `packages/platform-elysia/src/errors/default-exception-filter.ts`:

- change the type-only import to also bring the value in:
  `import { renderLogValue, type LoggerService } from "@aponiajs/common";`
- delete the module-level `unprojectableValue` (`:16-27`);
- delete `exceptionMessage` (`:144-172`) and `plainString` (`:174-189`), replacing both call sites —
  `recordMappedException` and `announceLoggerFailure` — with `renderLogValue`;
- replace `recordMappedException`'s doc comment with:

```
 * The projection is `@aponiajs/common`'s `renderLogValue`, the same call the
 * devtools log stream renders a line through, so `/requests` and `/logs` cannot
 * disagree about one failure and the literal a value that refuses everything is
 * stated as is the same word on both. It is total, which is why it may be called
 * here at all: this runs inside a route-local `error` hook whose return value is
 * the response, and the call to the logger below it runs the same rendering, so a
 * throw anywhere on this path would replace the application's Problem Details
 * answer with the engine's own page.
```

- [ ] **Step 5: Rename the literal and the claims around it**

Every remaining `[unprojectable]` site from Step 1 becomes `[unrenderable]`. Three of them carry
claims that are now false and are rewritten rather than renamed:

`docs/devtools.md:575-582` — the whole entry under "Accepted limitations" is deleted, because there
are no longer two copies to hold together. Where the mapped failure is described (`:445-454`), after
"the entry states the same one-line account of it that `/logs` states — the name and the message, and
no stack.", add:

```
  Both surfaces state it through one definition — `@aponiajs/common`'s
  `renderLogValue` — rather than through a copy each, so they cannot disagree about
  one failure. A thrown value neither can state — one that refuses both the JSON
  form and the plain string form — is stated as the literal `[unrenderable]` rather
  than allowed to throw, because that rendering runs inside the logger method the
  mapping calls before it answers.
```

`packages/devtools/AGENTS.md:805-814` — replace the paragraph describing the comparison and the
accepted risk with:

```
  The unhandled failure is asserted from the other side, because its message is
  nowhere on the answer: the entry the record holds is compared with the line
  `/logs` states for the same exception. Both surfaces render through
  `@aponiajs/common`'s `renderLogValue`, so the comparison asserts the wiring rather
  than two copies kept in step — the record's half is the exception the platform's
  mapping wrote, and the stream's half is the line this package's tap produced. It
  runs over three thrown values — an `Error`, one that is not, and a value the
  rendering cannot state at all — because the rendering has a branch per shape and
  a case that only ever threw `Error`s could not tell a faithful rendering from one
  that agreed on that branch alone; the third pins the literal both surfaces fall
  back to.
```

`packages/devtools/AGENTS.md:22` — the `logging/` row of the domain table no longer owns the
rendering. Replace "the tap that fills it from a logger, and the one-line form of a thrown reason"
with "and the tap that fills it from a logger".

`packages/platform-elysia/AGENTS.md` — the default-mapping bullet's sentence beginning "The projection
is the one the devtools log stream applies to a line, restated here branch for branch because the two
packages do not depend on each other" becomes:

```
  The projection is `@aponiajs/common`'s `renderLogValue`, the same call the devtools
  log stream renders a line through, so the two surfaces cannot disagree about one
  failure; it is total, and a thrown value that refuses to be rendered is recorded
  as the literal `[unrenderable]` rather than allowed to throw inside the error
  path.
```

`packages/devtools/tests/requests.test.ts` — rename the expectation at `:1001`, and rewrite the
comment above the three cases (`:992-997`) that says "three different branches of the projection both
surfaces restate" to say the three shapes take three branches of the rendering both surfaces call.
`packages/platform-elysia/tests/application-diagnostics.test.ts:466-470` — rename the literal and
replace "the literal both surfaces state it as" with "the literal both surfaces state it as, through
the one rendering they share".

- [ ] **Step 6: Run the guard and the lanes**

Run: `bun test scripts/retired-literals.spec.ts`
Expected: PASS.

```bash
bun run check
bun run test:coverage
bun run test:vite-plus
bun run release:dry-run
```

- [ ] **Step 7: Commit**

```bash
git add packages/devtools/src/logging/log-tap.ts \
  packages/platform-elysia/src/errors/default-exception-filter.ts \
  packages/devtools/AGENTS.md packages/platform-elysia/AGENTS.md \
  docs/devtools.md packages/devtools/README.md packages/devtools/llms.txt \
  packages/devtools/tests/requests.test.ts \
  packages/platform-elysia/tests/application-diagnostics.test.ts \
  scripts/retired-literals.spec.ts scripts/AGENTS.md
git commit
```

Commit subject: `refactor(logging): render a thrown value through one definition`

Body states: the platform's exception record and the devtools log stream each carried a copy of the
same projection, held together by a parity case, and the two packages do not depend on each other —
which was the whole reason for the copy. Both now call `@aponiajs/common`'s `renderLogValue`, so the
literal a value that refuses everything is stated as is one word by construction: `[unprojectable]`
becomes `[unrenderable]`, which is a wire-visible change to `/logs`' `message` and `/requests`'
`error` on a contract that is already at `2` and unreleased. A guard in `scripts/` fails when a
published surface still states a literal this release retired.

---

## Self-review

**Spec coverage.** Change #1 → Task 1 (both rendering paths guarded, the literal introduced, the
`Proxy` negative case, the falsified branch list corrected). Change #2 → Task 2 (the guard, the
`stderr` decision with its rejected alternative named in the source comment, the two-part contract
stated on `LoggerService`, the record ordering kept). Change #3 → Tasks 3 and 4 (one definition, both
surfaces moved onto it, the literal renamed with its documents). The spec's "What this does not
change" list is honored: `Logger` stays a one-line subclass, `#print`'s level filter is untouched, the
stream split by level is untouched, and the console logger keeps its own form. The spec's "What
remains, deliberately" list is stated in the code comments (`LoggerService`'s doc block for the
application-supplied logger, `#stringify`'s and the negative case's comments for the `Proxy`, and the
boot-boundary case) — except that the `Proxy` paragraph names `util.inspect` as the party that chose
`{}`, which Task 1's negative case pins.

**Spec deviations, all recorded above:** the corrected pair in change #3, the corrected branch list
in change #1, and the re-specified "literal's family" case. The first two change what gets built; the
third changes how it is guarded.

**Placeholders.** None: every step carries the code or the exact document text, and every run step
names its command and its expected result.

**Type consistency.** `unrenderableValue` is a `const string` exported from
`packages/common/src/logging/log-value.ts` and used by `console-logger.ts` (Task 1) and by
`renderLogValue`'s own fallback (Task 3). `renderLogValue(value: unknown): string` is exported from
the barrel in Task 3 and called as `renderLogValue(message)` in `log-tap.ts` and
`renderLogValue(error)` / `renderLogValue(loggerFailure)` in `default-exception-filter.ts` in Task 4 —
the same name in all four sites. The platform task keeps its own private `exceptionMessage` and
`plainString` in Task 2 and deletes them in Task 4, so no step calls a function a later step removed.

**Review Focus.** Each of the five lines names the task that owns its test: 1 and 2 → Task 2's two
cases; 3 and 4 → Task 1's JSON and `Proxy` cases; 5 → Task 3's plain-string and literal cases plus
Task 4's renamed parity expectation.

## What execution changed, recorded after the fact

This section is appended by the executor. The plan above is kept as written where it was wrong, so the
record shows what was decided and what was later found — the same rule the retired-literal guard
applies to the documents.

**Task 2's guard set is five sites, not one, and the reason is a plan error.** The plan says the error
path is the only call site whose failure would cost an answer, "so it is the only one guarded". The
survey behind that sentence used the pattern `logger\.(error|warn|…)\(`, which cannot match
`logger?.`. Re-run as `logger\??\.(error|warn|log|fatal|debug|verbose)\(`, it finds **five**
failure-reporting call sites: the platform's default mapping, its declared-filter hook, its
`listen` catch, and two in `packages/devtools` — the row for a refused bind and the row for an
unreadable `/aot` analysis. All five guard, through one `@internal` seam in `platform-elysia` and one
shared `reportFailure` in `devtools`. The rule the plan did not state, and which now appears in
`logger.types.ts`, `docs/logging.md`, and both package guides, is: **a call site that reports a
failure guards, and a call site that reports progress does not.** The boot's own progress lines and
the devtools non-loopback notice stay unguarded on purpose, which is what makes the pinned
boot-boundary case true.

**Three errors in the plan's own text were found while executing it.** Task 4's quoted replacement for
`recordMappedException` carried a false clause (a throw "anywhere on this path") and dropped two true
sentences. The retired-literal guard's code sample resolved against the process working directory,
where every sibling guard anchors at `resolve(import.meta.dir, "..")`. And this plan's "literal's
family" testing bullet presupposed a published list of literals that does not exist. All three were
corrected in the code; the text above is left as it was.

**One carry-forward given to Task 4 was withdrawn by measurement.** The plan's ledger asked for
`packages/devtools/src/logging/one-line.ts`'s refusal fallback to be pointed at `renderLogValue`. The
two disagree on exactly the shapes that fallback exists for — `oneLine` answers `[unrenderable]` for a
`Proxy` whose `getPrototypeOf` throws and for a refusing `Symbol.toPrimitive`, while `renderLogValue`
answers `[object Object]` and `{}`, because its `JSON.stringify` step runs before any refusal. They
agree only for a value that refuses every read, which is the one shape a case can hold them to.

The full record — eleven rulings, the pre-flight scan, and every fix round with what it measured — is
in `.superpowers/sdd/2026-09-27-aponia-logger-rendering/progress.md`.
