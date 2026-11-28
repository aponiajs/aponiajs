# @aponiajs/compiler

> Compiler-grade invariants for an Aponia application: scoped lifetimes, exclusive mutation, typestate, and linear consumption.

AponiaJS encodes what the type system can prove and revokes what it cannot at
runtime. This package is runtime-neutral apart from `node:async_hooks`, used only
for borrow identity. It depends on `@aponiajs/common` and imports no HTTP
runtime.

## Use it

```ts
import { LifetimeScope, RwCell, createStateMachine, once } from "@aponiajs/compiler";

const scope = new LifetimeScope({ label: "request" });
const session = scope.track(await loadSession());
session.get(); // the value, while the scope is open
scope.exit("response");
session.get(); // AponiaError("STALE_LIFETIME")

const cell = new RwCell({ count: 0 });
cell.read((state) => state.count);
cell.write((state) => {
  state.count += 1;
});

const draft = createStateMachine({
  initial: "draft",
  transitions: {
    draft: { publish: "published" },
    published: { archive: "archived" },
    archived: {},
  },
});
const published = draft.transition("publish");

const release = once(() => store.release("key"));
release();
```

## Scoped lifetimes

`Scoped<T>` is deliberately not assignable to `T`. `get()` checks the scope and
`moveOut()` transfers the value and revokes the handle. `withLifetime()` opens a
scope and exits it however the work settles.

`scope.guard(object)` returns a top-level revocation proxy. Property reads use
`Reflect.get(target, property, target)`, so getters and methods keep the target
as `this`: class instances with `#private` fields and `WeakMap`-backed state work
without `Illegal invocation`. A method read through the proxy is invoked as
`Reflect.apply(method, target, args)`. `instanceof` and the prototype chain are
preserved; identity is not (`proxy !== target`), and nested values are not
guarded. Do not use a guarded object as a `WeakMap`/`Map` key or compare it with
`===`.

## Exclusive mutation

`RwCell` fails fast. A reader cannot run while a writer holds the cell, and a
writer cannot start while readers exist; overlap throws `BORROW_CONFLICT` with
`{ operation, reason: "conflict", label, readers, writer }`. `tryReadAsync()` and
`tryWriteAsync()` are the async probes with the same fail-fast rule.

Reader callbacks receive a deep revocable readonly view over plain objects and
arrays: writes throw `READONLY_VIEW`, and a captured view throws
`STALE_LIFETIME` after release. Writer callbacks receive a revocable exclusive
view, and a successful write bumps `version`. `Map`, `Set`, `Date`, and class
instances are passed by reference and are readonly at the type level only.

`AsyncRwLock` queues instead of failing on ordinary contention. Readers run
concurrently; a writer waits for readers and later readers wait behind a queued
writer. A conflicting acquisition nested in the same async chain throws
`BORROW_CONFLICT` with `reason: "self-reentrant"`; a waiter that exceeds its
timeout throws `reason: "timeout"`, and an `AbortSignal` removes it with
`reason: "aborted"`.

`provideSharedState(initial)` returns `{ token, provider, service }`.
`SharedStateService` exposes only `read`, `write`, `readAsync`, and `writeAsync`,
so application state has no raw mutable handle by default.

## Typestate and linear consumption

`createStateMachine()` uses a `const` type parameter, so state, event, and target
names stay literal and an invalid chain is a `tsc` error. The machine is
immutable: `transition()` returns a new machine at the target state. A dynamic
event is validated at transition time, and hydrating a persisted state the
definition does not declare, throw `INVALID_STATE_TRANSITION`.

`Owned<T>` and `once(fn)` are linear at runtime: a second `consume()` or a second
call throws `CONSUMED_STATE`. `Owned` implements `Symbol.dispose` and
`Symbol.asyncDispose`, so `using` and `await using` are the idiomatic release
forms.

## Failure codes

| Code                       | Meaning                                                             |
| -------------------------- | ------------------------------------------------------------------- |
| `STALE_LIFETIME`           | A scope ended, or a handle was moved out or released.               |
| `BORROW_CONFLICT`          | Conflicting borrow, self-reentrancy, timeout, or abort.             |
| `READONLY_VIEW`            | A write through a read view.                                        |
| `CONSUMED_STATE`           | A second `Owned.consume()` or `once()` call.                        |
| `INVALID_STATE_TRANSITION` | A dynamic event, hydrated state, or definition the machine rejects. |

## Documentation

- [Invariants guide](../../docs/build/invariants.md)
- [Request context](../../docs/build/request-context.md)
- [Package README](./README.md)
