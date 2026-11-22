# Compiler Invariants

AponiaJS encodes the invariants TypeScript can prove in the type system and
revokes the ones it cannot at runtime. This page covers scoped lifetimes,
exclusive mutation, typestate, and linear consumption, and the framework paths
that use them. It does not describe a full borrow checker or any distributed
lock: both are deliberate non-goals.

## Scoped lifetimes

`@aponiajs/compiler` exports `LifetimeScope`, `Scoped<T>`, and `withLifetime`.
A handle is not its value. `get()` checks the scope, `moveOut()` transfers the
value and revokes the handle, and any later read throws `STALE_LIFETIME`.

```ts
import { withLifetime } from "@aponiajs/compiler";

const result = await withLifetime(
  async (scope) => {
    const session = scope.track(await loadSession());
    return session.get();
  },
  { label: "request" },
);
```

`exit()` is idempotent, keeps the first reason, and revokes child scopes before
the parent. Track after exit throws. A captured `setTimeout` that reads the
handle after the scope ended fails loudly.

`scope.guard(object)` returns a revocation proxy for a plain object. The proxy
forwards reads with `Reflect.get(target, property, target)`, so getters and
methods keep the target as `this`: class instances with `#private` fields and
`WeakMap`-backed state work without `Illegal invocation`. A method read through
the proxy runs as `Reflect.apply(method, target, args)`. `instanceof` and the
prototype chain hold; identity does not (`proxy !== target`), and nested values
are not guarded. A non-configurable, non-writable data property is returned
unwrapped, because the JavaScript proxy invariant requires its exact value; that
one method stays callable after exit.

### Request lifetimes

`RequestContextService` exposes `scoped()` beside the compatibility `current()`.
`scoped()` returns a handle that refuses a read after the response boundary.
The kernel runs every request scope through `Registration.run`, which exits in
`finally`; Elysia enters the scope in `onRequest` and releases it in
`onAfterResponse("global")` and in the managed wrapper's `handle` finally, both
idempotently.

The container receives the accessor and an open-check together. A request-scoped
provider or controller resolved with a context whose lifetime ended throws
`STALE_LIFETIME` instead of writing into a cache map nobody will read again.

## Exclusive mutation

`RwCell` is the fail-fast primitive. Readers may nest, but a reader cannot run
while a writer holds the cell and a writer cannot start while readers exist.
Overlap throws `BORROW_CONFLICT` with `{ operation, reason: "conflict", label,
readers, writer }`. `tryReadAsync()` and `tryWriteAsync()` apply the same rule
across an `await`.

A reader receives a deep revocable readonly view over plain objects and arrays.
A write throws `READONLY_VIEW`, and a captured view throws `STALE_LIFETIME` after
release. A writer receives a revocable exclusive view, and a successful write
bumps `version`.

`AsyncRwLock` is the queued primitive for shared async traffic. Readers run
concurrently; a writer waits for readers, and later readers wait behind a queued
writer so a writer cannot starve. A conflicting acquisition nested in the same
async chain fails immediately with `reason: "self-reentrant"` through an
`AsyncLocalStorage`-backed borrow token. A waiter that exceeds its timeout throws
`reason: "timeout"`, and an `AbortSignal` removes it with `reason: "aborted"`.

`provideSharedState(initial)` returns `{ token, provider, service }`. The service
exposes only `read`, `write`, `readAsync`, and `writeAsync`, so application state
has no raw mutable handle by default.

```ts
import { provideSharedState } from "@aponiajs/compiler";

export const counter = provideSharedState({ value: 0 }, { label: "counter" });

await counter.service.writeAsync(async (state) => {
  state.value += 1;
});
```

## Typestate

`createStateMachine()` infers literal states and events through a `const` type
parameter and returns a new machine per transition, so an invalid chain is a
`tsc` error.

```ts
import { createStateMachine } from "@aponiajs/compiler";

const draft = createStateMachine({
  initial: "draft",
  transitions: {
    draft: { publish: "published" },
    published: { archive: "archived" },
    archived: {},
  },
});

const published = draft.transition("publish");
published.transition("archive");
```

A dynamic event is validated at transition time. Hydrating a persisted state or
declaring a target the definition does not name throws
`INVALID_STATE_TRANSITION` with the from-state, event, and allowed list where
they apply.

`@aponiajs/queue` drives every job transition through one machine
(`pending --run--> running`, `running --complete|retry|fail--> ...`,
`failed --revive--> pending`), and hydration validates the stored state before
the queue restores the job.

## Linear consumption

`Owned<T>` consumes once. `peek()` inspects without consuming,
`Symbol.dispose`/`Symbol.asyncDispose` release it, and a second `consume()`
throws `CONSUMED_STATE`. `once(fn)` is the function form: a second call throws
`CONSUMED_STATE`.

```ts
import { Owned, once } from "@aponiajs/compiler";

using lease = new Owned(await acquireLease());
const value = lease.consume();

const release = once(() => store.release("key"));
release();
```

`@aponiajs/idempotency` wraps `RequestState.release` in `once`, so a claim cannot
be released twice by overlapping hooks. `@aponiajs/database` guards every
transaction handle with a per-transaction scope, so a handle used after its
callback throws `STALE_LIFETIME`.

## Failure codes

| Code                       | Meaning                                                             |
| -------------------------- | ------------------------------------------------------------------- |
| `STALE_LIFETIME`           | A scope ended, or a handle was moved out or released.               |
| `BORROW_CONFLICT`          | Conflict, self-reentrancy, timeout, or abort.                       |
| `READONLY_VIEW`            | A write through a read view.                                        |
| `CONSUMED_STATE`           | A second `Owned.consume()` or `once()` call.                        |
| `INVALID_STATE_TRANSITION` | A dynamic event, hydrated state, or definition the machine rejects. |

## Deliberate limits

- Locks are in-process. A distributed lock needs an application-supplied store.
- Views cover plain objects and arrays. `Map`, `Set`, `Date`, and class
  instances are passed by reference and are readonly at the type level only.
- `scope.guard` is a top-level boundary; nested objects are not guarded.
- No TypeScript plugin and no full borrow checker exist.
- `RequestContextService.current()` keeps its compatibility behavior; use
  `scoped()` for the safe path.

## Verify it

```bash
bun test packages/compiler/tests
bun run test:vite-plus
```

See [Scoped lifetimes and exclusive mutation](./request-context.md) for the
request integration and the [@aponiajs/compiler README](../../packages/compiler/README.md)
for the full export list.
