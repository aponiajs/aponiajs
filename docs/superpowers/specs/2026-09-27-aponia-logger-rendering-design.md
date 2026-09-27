# Logger rendering — a built-in logger that cannot throw, and a framework that does not rely on it

Status: design.

## Why this document

`@aponiajs/common`'s `ConsoleLogger` turns a logged value into text with **no `try` anywhere in the
file** — `grep -c try` over that source is `0`. Two rendering paths read the value unguarded, and a
value that refuses to be read makes `logger.error(value)` **throw instead of logging**.

That is a defect wherever an application logs such a value. It becomes a defect in the _framework_
at one call site, and this is the whole reason the document exists: the platform's default exception
filter calls the logger **inside the route-local `error` hook**, whose return value _is_ the Problem
Details response.

```ts
// packages/platform-elysia/src/errors/default-exception-filter.ts
recordMappedException(mappedExceptions, request, error);
logger?.error(error, "ExceptionsHandler"); // a throw here...
return httpErrors.internalServerError(unhandledFailureDetail).toResponse(); // ...skips this
```

A throw on the middle line means the hook never returns, so the client receives whatever Elysia's own
error path or the engine produces — an HTML page — instead of the `application/problem+json` answer
the application was designed to give. **The application's error response is replaced because a
logging call failed.**

This was found while closing the devtools limitations, verified independently by two reviewers, and
**ruled out of scope** for that work: it is a defect in `common` and in the platform's error path, not
in the devtools package, and fixing it means settling a contract question no spec had answered.

## The two triggers, and what is _not_ one

Both were reproduced directly against the shipped `ConsoleLogger` before this document was written.

| Path                                                                                   | Input                                                                            | Result                                                            |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| text (default) — `ConsoleLogger#stringify` reads `message.name` for a function message | a function whose `name` is a throwing getter                                     | **throws** — "the name getter refused"                            |
| `json: true` — `#formatJson` runs `JSON.stringify` over the message                    | a cyclic object                                                                  | **throws** — "JSON.stringify cannot serialize cyclic structures." |
| `json: true`                                                                           | a `BigInt`-bearing object                                                        | **throws** — "JSON.stringify cannot serialize BigInt."            |
| text — the `inspect` path                                                              | a `Proxy` whose `get`, `ownKeys`, and `getOwnPropertyDescriptor` traps all throw | **does not throw** — `util.inspect` renders `{}`                  |
| text                                                                                   | a cyclic object; a plain `Error`; a string                                       | does not throw                                                    |

**The `Proxy` case is recorded because it was reported as a trigger and is not one.** `util.inspect`
absorbs a refusing trap. It is listed here so no implementer adds a guard for a case that cannot
occur while missing the two that do.

**The `json: true` triggers are ordinary application data, not pathological input.** A cyclic object
is any parent↔child graph; a `BigInt` is a database identifier. An application that configures
`json: true` and throws an entity carrying a back-reference loses its error response — with **no
devtools installed at all**, because nothing here is devtools.

## What changes

| #   | Today                                                                                                                                 | Change                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `ConsoleLogger` reads the value unguarded on both paths and throws for a value it cannot render                                       | Every read inside one `try` per path, and the literal `[unrenderable]` on refusal — the built-in logger states that it could not render the value rather than failing |
| 2   | The platform's default exception filter calls the logger unguarded inside the error path                                              | The call is guarded, because the framework cannot rely on a contract an application's own `LoggerService` may not keep                                                |
| 3   | `@aponiajs/devtools`' projection restates the logger's, and Task 5 made the two identical branch for branch **including the literal** | One rendered form, not two kept in step by a test                                                                                                                     |

## The contract this settles

`LoggerService` declares six methods returning `void` and has never said whether they may throw. The
answer this document adopts is in two parts, and the second is what makes the first safe:

> **The logger the framework builds does not throw. The framework does not rely on that.**
>
> `ConsoleLogger` guarantees it renders something for every value it is handed. A `LoggerService` an
> application supplies is its own implementation of a public interface and may throw; every framework
> call site that must not be harmed by a throw guards for itself.

Both halves are needed and neither is sufficient. Guarding only at the call site leaves an
application's own `logger.error(cyclicValue)` throwing where it called, for a value the framework's
own logger would have rendered. Guarding only inside `ConsoleLogger` leaves the framework depending
on a promise a third-party implementation never made — the interface is public and applications are
expected to implement it.

## The changes

### 1 · The built-in logger renders, or says it could not

Both rendering paths take the total shape this repository arrived at twice already: **one outer `try`
whose `catch` answers the fallback**, rather than a guard per read.

- `#stringify` — the function-name branch, the `Error` branch, `inspect`, and the `String` floor all
  move inside one `try`; the catch answers the literal.
- `#formatJson` — the `JSON.stringify` call gets the same treatment, answering a line that states the
  refusal. A JSON line that omitted `message` entirely would be worse than one that says so: a
  consumer parsing the stream cannot tell a message that was dropped from one the caller never
  passed.

The literal is **`[unrenderable]`**, matching the family `[redacted]`, `[truncated]`,
`[unserializable]`, and `[unprojectable]` already use: a value's place states that the tool could not
render it, rather than the field being absent or the line failing.

**This renames devtools' `[unprojectable]` to `[unrenderable]`, and that is a wire-visible change.**
The two are the same idea under two words — a value the tool could not turn into the text it was
asked for — and one family with one word is what a reader of both surfaces needs. The string appears
in `/requests`' `error` and in `/logs`' `message`, the contract is already at `2` on this branch and
unreleased, and the rename must therefore land **with** the third change rather than before it: a
literal that differs between the logger and the endpoint that publishes the logger's lines is worse
than either name alone.

**Why one outer `try` rather than a guard per read.** The proxy case above is the argument. A guard
list is written from the failures somebody thought of; `typeof` never throws while every property
read can, and enumeration is what this repository has already paid for three times — Task 1's "the
level read was outside the `try`", and Task 5's two rounds on a projection whose comment promised
totality its guards did not deliver. One `try` makes the claim true by construction, so the comment
above it can say what it means.

### 2 · The error path does not depend on the logger

`default-exception-filter.ts` guards the `logger?.error(error, "ExceptionsHandler")` call. The
response is returned whether or not the logger reported the failure.

**A logger that throws is reported to `process.stderr` by a direct write**, and this is a decision
rather than an oversight. The channel that would normally carry a diagnostic is the one that just
failed, so a framework that swallows silently loses the fact entirely — and this repository's rule is
that an absence is stated rather than hidden. The cost is real and named: `platform-elysia` writes to
a process stream here and nowhere else, which is a layering smell, because logging is `common`'s
domain and not this package's. It is accepted because the alternative is worse.

**Rejected: swallowing the throw.** One line shorter, no layering question, and it is what most
frameworks do. It is rejected because a third-party logger that throws on every line would then be
invisible — the application would see neither its logs nor any sign that its logger is broken.

**Rejected: rethrowing after the response.** Impossible: the throw happens before the hook returns,
so there is no later point at which the response is already decided. This is exactly why the guard is
here and not at the caller.

The record write already precedes the log call, so `/requests` keeps the exception either way — that
ordering was changed for exactly this reason and stays.

### 3 · One rendered form, not two

`packages/devtools`' `projectMessage` and `ConsoleLogger#stringify` are two implementations of the
same idea, and the devtools guide documents the second as **"the log stream's own one-line form"**.
Task 5 on the devtools branch made them identical **branch for branch, including the literal**, and
pinned that with a parity test — so changing one alone falsifies both the sentence and the test.

**The change is to export the rendering from `@aponiajs/common` and have both call it.** `common` is
the lower layer and already owns `LogLevel` and `LoggerService`; devtools depends on it. One
implementation is what makes the parity _structural_ instead of _asserted_, and it is the same
correction this repository has now made twice: the devtools `/aot` mirror was replaced by a shared
analyzer for the same reason.

**Rejected: keep two implementations and adopt the same literal in both.** It is the smaller change
and it keeps the parity test meaningful. It is rejected because a test that pins two copies equal is
a test that has to keep being right, and the branch that produced it spent three fix rounds on
divergence between surfaces. The counter-argument, which is real: exporting from `common` adds public
API to a package whose minimalism is a stated property, and the exported function becomes something
applications can call. That is the price, and it buys a single definition.

## What this does not change

- **`Logger` stays a one-line subclass.** `export class Logger extends ConsoleLogger {}` is untouched;
  this document changes how the parent renders, not the class hierarchy.
- **The level filter.** `#print` returns early when a level is disabled, which is why the defect needs an
  enabled level; unchanged.
- **What reaches `stderr` and `stdout`.** The stream split by level is unchanged.
- **`AGENTS.md`'s rule that a debugging aid must never change what it observes** — this change makes the
  framework's error path honor it for a supply it does not control.

## Delivery order

Three changes, and the third depends on the first.

1. **The built-in logger becomes total.** Self-contained in `common`; its own tests carry it. Nothing
   observable changes for any value the logger already rendered.
2. **The error path guards.** One call site, and the case that holds it is the end-to-end one: a route
   throwing a value the logger cannot render still answers Problem Details. This is the change that
   makes the defect's headline consequence go away, and it lands independently of the rest.
3. **The rendering is exported and devtools calls it.** Lands last because it touches a second package
   and amends a literal that is already on the wire.

## What remains, deliberately

- **An application's own `LoggerService` may still throw**, and the framework will not pretend otherwise.
  What changes is that no framework call site is harmed by it.
- **The `Proxy` that refuses every read still logs as `{}`** under the text path, because `util.inspect`
  chose that rendering and this package does not re-decide it. A line that states `{}` for a value that
  refused inspection is imprecise, and it is `util.inspect`'s answer rather than this package's. It is
  recorded rather than papered over.
- **No guard is added for a case that cannot throw.** The probe above exists so the guard list is the
  two that do.

## Testing

- **The two triggers, one case each, at the logger:** a function whose `name` getter throws, and — under
  `json: true` — a cyclic object and a `BigInt`-bearing object. Each asserts the line is written and
  states `[unrenderable]`, and none may assert only that it does not throw.
- **The negative case, so a guard is not added for nothing:** a `Proxy` whose traps all throw renders as
  `{}` and does not throw. This case is why the document exists in its present shape; without it the
  next reader adds the wrong guard.
- **The error path end to end, over a socket:** a route throwing a value the logger cannot render
  answers `500` with `application/problem+json`, and the exception still reaches `/requests` — the
  record survives a logger that throws, which is the ordering this depends on.
- **A throwing custom `LoggerService`:** supplied by an application, it throws from `error`, and the
  route still answers Problem Details. This is the half of the contract that `ConsoleLogger` cannot
  satisfy on the framework's behalf.
- **Parity:** if the rendering is exported, one case asserts the exported function is what both
  surfaces call, and the devtools parity test is rewritten to compare against it rather than against a
  second copy.
- **The literal's family:** one case asserts `[unrenderable]` sits beside its four siblings where the
  published documents list them, so a reader meets one family and not two conventions.

Every case carries a mutation that makes it fail alone.

## What this document does not decide

**Where the exported rendering lives and what it is called.** `common`'s logging domain owns it, and
the name should say what it does — render a value as one line of text — rather than what it is used
for. That is a naming decision for the plan, not a design one, and it is named here so it is not
mistaken for an oversight.
