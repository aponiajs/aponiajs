# @aponiajs/compiler — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The runtime half of compiler-grade invariants: revocable lifetimes, exclusive
mutation views, typestate, and linear consumption. It is runtime-neutral except
for `node:async_hooks`, which is used only for borrow identity.

| Domain        | Owns                                                          |
| ------------- | ------------------------------------------------------------- |
| `lifetime/`   | `LifetimeScope`, `Scoped<T>`, `withLifetime`, `scope.guard`   |
| `borrow/`     | `RwCell<T>`, `AsyncRwLock`, deep readonly and exclusive views |
| `typestate/`  | `createStateMachine`, `Owned<T>`, `once`, and `using` support |
| `shared/`     | `provideSharedState`, `SharedStateService`                    |
| `interfaces/` | the lifetime, borrow, and typestate contracts                 |

`src/index.ts` is the only public barrel. Type-only contracts live in
`interfaces/<name>.interface.ts`.

## Invariants

- **A scoped handle is not its value.** `Scoped<T>` is not assignable to `T`;
  `get()` checks the scope, `moveOut()` transfers and revokes. Never expose a
  raw value through a handle.
- **`scope.guard` binds methods to the target.** The `get` trap forwards with
  `Reflect.get(target, property, target)` and wraps a function result as
  `Reflect.apply(method, target, args)`, so getters, methods, `#private` fields,
  and `WeakMap`-backed state work. Identity is not preserved and nested values
  are not guarded; both are documented and tested. A non-configurable,
  non-writable data property is returned unwrapped because the proxy invariant
  requires its exact value; that one method stays callable after exit. The guard
  accepts plain objects, not arrays or functions.
- **A parent revokes its children.** `exit()` is idempotent, revokes every child,
  and keeps the first reason. Tracking after exit throws `STALE_LIFETIME`.
- **`RwCell` fails fast; `AsyncRwLock` queues.** Do not make `RwCell` wait on
  ordinary contention. The async lock runs readers concurrently, makes writers
  wait, and keeps later readers behind a queued writer so a writer cannot
  starve. A nested conflicting acquisition fails immediately through the
  `AsyncLocalStorage`-backed `BorrowContext`.
- **A released view is stale.** Every captured proxy shares one revocation state;
  reads and writes through a released view throw `STALE_LIFETIME`. A write
  through a read view throws `READONLY_VIEW`. Views cover plain objects and
  arrays; `Map`, `Set`, `Date`, and class instances are passed by reference and
  are readonly at the type level only. Never describe them as runtime-guarded.
- **A machine is immutable.** `transition()` returns a new machine; it never
  mutates the one it was called on. Invalid chains are `tsc` errors. Dynamic
  events, unknown hydrated states, and invalid definitions throw
  `INVALID_STATE_TRANSITION` with the from-state, event, and allowed list where
  they apply.
- **Consumption is linear at runtime.** `Owned.consume()` and `once()` throw
  `CONSUMED_STATE` on reuse. TypeScript has no linear types, so the runtime check
  is the guarantee. `Owned` implements both dispose symbols.
- **Failures are `AponiaError`.** Use one of `STALE_LIFETIME`,
  `BORROW_CONFLICT`, `READONLY_VIEW`, `CONSUMED_STATE`, or
  `INVALID_STATE_TRANSITION` from the closed union, with frozen details. The only
  plain failure is a `TypeError` for a non-object passed to `scope.guard`.
- **No HTTP or Elysia import.** Framework integrations belong to
  `platform-core`, `core`, `queue`, `database`, and `idempotency`, which import
  this package's public barrel.
- **`node:async_hooks` stays scoped to identity.** Do not add a second runtime
  edge; the package is otherwise pure TypeScript.

## Tests

`src/**/*.spec.ts` under Bun, `test/*.conformance.ts` under Vite+. Unit cases
cover success, failure, reuse, release, timeout, abort, and hydration. Integration
cases boot Elysia, Hono, and H3 through `application.handle` and prove each
request's scope is independent and revoked at the response boundary.
