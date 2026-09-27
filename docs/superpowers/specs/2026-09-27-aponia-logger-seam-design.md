# The logger seam — an observable boot logger and an injectable token

Status: design. Companion to
[`2026-09-27-aponia-devtools-completeness-design.md`](./2026-09-27-aponia-devtools-completeness-design.md),
which it does not depend on and which does not depend on it.

## Why this document

Two limitations survive the completeness work, and they share one cause.

`@aponiajs/devtools` must be handed the same logger object the application gives
`AponiaFactory.create`, or `/logs` serves no endpoint at all — the tap is
installed at registration, because registration is the only moment this package
holds the logger before the boot writes, and a tap installed at `onStart` would
miss `AponiaFactory`, `InstanceLoader`, and `RoutesResolver`, which are the lines
worth having. The joining mechanism is object identity and nothing else.

And an application's providers cannot log through that object at all, because the
container hands no logger to a provider. `/logs` holds the platform's lines and
whatever was written through the object handed over, and a service that
constructs its own `Logger` is not in the stream.

**Either change alone leaves the second limitation standing.** Injecting the boot
logger into providers does not put service lines on `/logs` — devtools taps a
separately supplied object, and on the paths where the factory builds its own
logger (`omit`, a level array) there is no shared object to tap. Observing the
factory's logger does not put service lines on `/logs` either — no provider can
reach the object being observed. Together they close it: one logger object, which
the platform logs through, which providers inject, and which devtools taps.

## What changes

| #   | Today                                                                                                                                                        | Change                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | An application must hand its logger to both `AponiaFactory.create` and the devtools registration; omit it, or pass a level array, and `/logs` does not exist | The boot publishes the logger it created to observers registered before the boot, so the object is one and devtools taps the one the platform uses |
| 2   | No provider can inject a logger; the container has no logger at all                                                                                          | A `LOGGER` token in `@aponiajs/common`, resolvable from every module, bound to the boot logger                                                     |

## Contract changes

### 1. `@aponiajs/common` exports a `LOGGER` token

The first injection token exported from `common`. It is declared where the
logging domain lives, as a runtime value — `createToken` returns a frozen object
carrying a symbol, so a token can only be re-identified by importing the same
constant, and `scripts/source-layout.spec.ts` requires a `.types.ts` to stay
type-only.

```ts
// packages/common/src/logging/logger-token.ts
export const LOGGER = createToken<LoggerService>("aponia.logger");
```

`LoggerService` is an interface, so this token can only be injected through
`@Inject(LOGGER)`: `design:paramtypes` cannot name an interface, and there is no
class for the metadata to record. That is the same reason Nest's users write
`@Inject(Logger)`.

### 2. `@aponiajs/common` gains a boot-logger observer

```ts
export function observeSystemLogger(observer: (logger: LoggerService) => void): () => void;
```

Registering returns its own removal. This is process-global mutable state, which
this repository already uses in two places for the same reason — the devtools tap
registry and the symbol-keyed diagnostics record — and it is the only seam that
satisfies the constraint the existing ruling states: the tap must exist before
bootstrap runs.

### 3. `ModuleGraph` gains a predefined tier

`compileModuleGraph` accepts a set of predefined providers, bound to a token
rather than declared by a module. `ModuleGraph.locate` consults them **last**:
the module's own providers, then imports that export the token, then the
predefined set.

Last, and not as a candidate, because the ambiguity rule must survive unchanged.
Two imports exporting the same token still raise `AMBIGUOUS_PROVIDER`; a
predefined provider is a fallback for a token nothing else answered, so it can
never manufacture the ambiguity that rule exists to catch.

`@core`'s guide states the resolution rule as "the module's own providers first,
then imports that **export** the token". That sentence is part of this change.

### 4. `createContainer` accepts the logger

`createContainer(root, logger?)`. The second parameter is optional so the change
does not ripple through the ~30 call sites in `@aponiajs/core`'s and
`@aponiajs/platform-elysia`'s Bun and Vite+ lanes; only the two production sites
read it.

## The changes

### 1 · One logger object, observed at creation

`createSystemLogger` (`application-bootstrap.ts:371-388`) resolves the option
into exactly one of: a `LoggerService` the application supplied, a `Logger` the
factory builds from a level array, a `Logger` the factory builds by default, or
`undefined` for `false`. It then calls every registered observer with that
logger, **before** the `Starting Aponia application...` line is written.

Devtools registers an observer at registration — `DevtoolsModule.register` and
`devtoolsPlugin` both run before `AponiaFactory.create` — and taps the logger it
is given, using the tap it already has. Its own `logger` option then has one job
fewer: it is not how the stream is built, it is only how a caller states a
preference. **The two ends have to agree, and this is what makes them.**

**Ordering is the whole point and is not an arrangement.** The observer must be
called before the first write, because the boot lines are the reason the tap
exists at all. A tap installed anywhere later silently drops them — the mutation
that moved it to `onStart` is already the case that proves this, and it stays in
the lane.

**What changes for an application.** The starter no longer threads one logger
into two places: `AponiaFactory.create`'s `logger` option is the only place it
names one, and `/logs` records the boot whether or not the application passed
anything. `logger: false` remains the one configuration with no logger at all,
and it stays the one configuration with no `/logs`, which is the rule the
existing design arrived at and this change does not touch.

**Rejected.** A wrapper logger the factory returns to the application. The
platform holds its own reference to the logger option and the application holds
another; replacing it would give one of them a logger the other never uses. An
observer keeps one object, which is the property the whole design rests on.

### 2 · The token, and why it resolves everywhere

A provider that declares `@Inject(LOGGER)` and whose module neither owns nor
imports the token fails `compileModuleGraph` at boot with `MISSING_PROVIDER`,
because validation is eager and graph-wide (`graph-compiler.ts:89-114`). Every
module would otherwise have to import a logging module and have it export the
token — the tax that makes a logger not worth injecting.

So the token joins the predefined set `compileModuleGraph` is given, and every
module resolves it without declaring anything. That is the entire justification
for a new resolution tier: **a framework-provided value that every module may
use and no module declares** is a shape the graph did not have, and inventing a
global module concept to carry one token would be a larger answer to a smaller
question.

**Binding.** `application-bootstrap.ts` creates the logger at line 57 and the
container at line 86, so the value exists before the container does: the logger
is passed to `createContainer`, which makes it available to the predefined tier.

**`logger: false` binds a no-op.** A no-op that discards every call, because that
is what the application asked for: it said no logging. The alternative — no
binding at all — would make `@Inject(LOGGER)` fail at boot because of an option
set for an unrelated reason, and a provider that injects a logger should not
decide whether the application boots. The no-op does not appear in `/logs`,
because devtools taps what it is given and it is given nothing on that path.

**Introspection is unaffected.** `application-inspection.ts:66` builds a
container without a logger and instantiates no provider, so the tier is present
and unread. It receives a no-op by the same default, which keeps the call site
unchanged.

**`/graph` names the token, not the logger.** Introspection renders tokens
through `tokenName`, so the token appears as `aponia.logger`. Nothing serializes
the value, which is the reason a token is a symbol and not a string.

**One seam the change must respect.** `descriptor-emitter.ts:1035-1047` declines
any class whose constructor injects an inline `createToken(...)`, because the
generated module cannot reproduce the identity; it accepts a named value import
(`:1049-1058`). `LOGGER` exported as a value from `common` satisfies that rule,
and a type-only re-export would decline the module. The requirement is therefore
load-bearing for the AOT path, not merely tidy.

### Documentation this changes

- `packages/core/AGENTS.md` — the resolution rule, which gains a third tier.
- `docs/logging.md` — providers currently construct their own `Logger`; the
  document now states the injected one, and what it does and does not cover.
- `packages/common/llms.txt` — regenerated, because `common` gains public API.
- The root `AGENTS.md` "Current scope" list, which names what the release
  implements.
- `packages/devtools/README.md` and `docs/devtools.md` — the same-logger-twice
  condition leaves the limitations list, and the reason it existed moves to the
  observer's own description.

## Delivery order

Two changes, and the second depends on the first being in place to be worth
making.

1. **The observer.** Independent and shippable on its own: it deletes the
   same-logger-twice condition and makes `/logs` work for an application that
   passes nothing. Nothing about the graph changes, so nothing that depends on
   the graph can break.
2. **The token and the tier.** The graph change, the binding, the no-op, and the
   documentation. It lands after, so that a regression in the graph tier is not
   confused with a regression in the observer.

The devtools consumption of both — an application whose services reach `/logs`
— is asserted last, because it is the only case that needs both.

## What remains limited

- **A logger an application constructs for itself is still not in `/logs`.** The
  token gives a provider the boot logger; it does not intercept a second logger
  the application creates. Reaching every logger would mean patching the `Logger`
  class itself, which is a global side effect on a public type.
- **`/logs` still holds one object's lines.** It is now the object the platform
  and the providers share, which is the whole of what it promises.
- **The predefined tier carries exactly one token.** It is a seam, not a general
  feature; a second use should be argued on its own.

## Testing

- **Observer** — an observer registered before `AponiaFactory.create` receives
  the logger the boot writes through, and receives it before the first line; an
  application that passes no logger still yields one to the observer; an
  application that passes `false` yields none; a level array yields the `Logger`
  the factory built from it; the returned function unregisters, and a boot after
  it does not call the observer.
- **Token** — a provider in a module that neither declares nor imports anything
  resolves `@Inject(LOGGER)`; the value is the same object the boot logs through;
  `logger: false` resolves the no-op and the application still boots; a module
  that declares its own `LOGGER` provider wins over the predefined one; two
  imports exporting `LOGGER` still raise `AMBIGUOUS_PROVIDER` rather than falling
  through to the predefined value, which is the case that pins the tier's
  position; introspection over a graph with a `LOGGER` dependency does not throw.
- **AOT** — a controller whose constructor injects `LOGGER` is lowered into a
  descriptor artifact when the token is imported as a value, and the boot from
  that artifact injects the same logger.
- **End to end** — a service logging through the injected token appears in
  `/logs` over the socket, in the same stream as the boot's own lines.

Every case carries a mutation that makes it fail alone. The Vite+ lane mirrors
the token's public type and its injection path.
