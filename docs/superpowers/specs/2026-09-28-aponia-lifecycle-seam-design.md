# The provider and application lifecycle seam

Status: design.

## Why this document

The maintainer asked whether the framework should ship a scheduled-task (cron) utility.
Two measurements decided that question before this document existed:

- **The runtime already schedules.** Bun 1.4.2 exposes `Bun.cron` — an in-process job, an
  OS-level entry, a parser, and a remover — verified on the installed version by running
  it, not by reading about it:
  `bun -e 'Bun.cron.parse("*/15 * * * *", new Date("2026-01-01T00:00:00Z"))'` answers
  `2026-01-01T00:15:00.000Z`.
- **The framework has nowhere to put a job.** A search of `packages/common/src`,
  `packages/core/src`, and `packages/platform-elysia/src` for `OnModuleInit`,
  `onApplicationBootstrap`, `OnApplicationShutdown`, or `beforeApplicationShutdown`
  returns nothing, and `AponiaElysiaApplication.close()` does one thing:
  `nativeApplication.stop(closeActiveConnections)` (`aponia-elysia-application.ts:47-51`).
  A job would have to be started and stopped by the application by hand, outside the
  graph the framework compiled.

The deleted plan says the same thing in the maintainer's own words. `ROADMAP.md`, removed
on purpose in `884050a` and recoverable from history, names four hooks at `:1060-1061` and
places `@nestjs/schedule` → `@aponiajs/schedule` in its wave B (`:1703`, `:2238`:
"Cron and interval definitions, overlap policy, graceful stop") — after the lifecycle work,
not before it. That is intent rather than contract, and this document does not inherit its
scope; it takes the ordering, which the measurements above independently support.

So the seam comes first, and it is worth shipping on its own account: a provider that opens
a connection pool, warms a cache, or holds a buffer has no way to close it when the
application stops, and no way to run once the graph it belongs to is ready.

## What the framework has today

- `AponiaContainer.initializeModule` resolves every provider of a module eagerly
  (`packages/core/src/container/container.ts:41-45`). Nothing runs after that resolution.
- The platform's bootstrap owns the order everything else happens in: providers, controllers,
  gateways, then the wrapper (`AGENTS.md`, "Bootstrap order").
- The mechanism this document follows is already in the codebase. An interceptor's halves are
  read from the **instance**, not from metadata: `enhancer-resolver.ts:174-175` tests
  `typeof instance.interceptBefore === "function"`, and `packages/platform-elysia/AGENTS.md`
  states why — "a half written as a class field is an own property of the instance and of no
  token".
- Both scope-of-record lists describe the absence. `README.md:597` names "async provider
  lifecycle" among what is not implemented; `AGENTS.md:385-388` does not name it, and both
  lists are the scope of record for the release.

## The contract this settles

**A lifecycle hook is a method on the provider instance, and the framework reads it from
there.** No decorator, no metadata key, no descriptor field, no `@Injectable()`-style
requirement. Four consequences follow, and each is a decision rather than a side effect:

1. **Both authoring paths get it, and the descriptor path gets it for free.** A
   hand-written `provideClass(Service, [])` needs no new field to declare that `Service`
   starts a timer: the instance carries the method, so the boot sees it. Nothing about the
   descriptor contract changes, which also means nothing about the descriptor artifact, the
   invoker artifact, or inspection changes.
2. **A provider kind that holds no instance cannot have hooks.** A value, an alias, and a
   factory's product never carry the members unless the value itself does, and a check for
   `typeof instance.x === "function"` answers correctly for every one of them without a
   case per kind.
3. **The names are Nest's.** `OnModuleInit`, `OnApplicationBootstrap`, `OnModuleDestroy`,
   `BeforeApplicationShutdown`, `OnApplicationShutdown` — the maintainer's compass is "as
   easy as Nest", and a reader who knows Nest should not have to learn a synonym.
4. **The contracts are types in `@aponiajs/common`, and no runtime.** They exist so a class
   can say `implements OnModuleInit` and get an error when a signature drifts, which is
   what the interface buys in Nest too. The runtime that calls them belongs to the platform.

## What changes

| Surface           | Change                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `common`          | A new `lifecycle/` owner directory holding the five type-only contracts, exported from the barrel            |
| `platform-elysia` | The boot calls the hooks at the moments below; `close()` gains the shutdown half                             |
| Documentation     | A reference page, a learn chapter, and the scope-of-record edits in `README.md` and `AGENTS.md`              |
| `examples/`       | A new `examples/lifecycle` whose provider announces its own start and stop                                   |
| Guards            | `source-layout.spec.ts` gains the directory; `learning-path.spec.ts` gains the chapter; `llms.txt` the types |

## The hooks, and when each runs

| Hook                        | Runs                                                                                                                                 | How often                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| `onModuleInit`              | After the boot's controller pass, once per hooked provider or controller in graph order, and before the gateway pass                 | Once per hooked instance |
| `onApplicationBootstrap`    | After the gateway pass and the final plugin await, immediately before the application is handed back — so before anything can listen | Once                     |
| `beforeApplicationShutdown` | On `close()`, before the server stops                                                                                                | Once                     |
| `onModuleDestroy`           | On `close()`, after the server has stopped                                                                                           | Once per hooked instance |
| `onApplicationShutdown`     | On `close()`, last                                                                                                                   | Once                     |

Ordering rules:

- **Modules run in graph order, dependencies first, for `onModuleInit`, and in reverse for
  `onModuleDestroy`.** A module that imports another must be able to rely on it having
  started, and must stop before it.
- **`onModuleInit` does not interleave with instantiation.** The boot keeps its two passes
  and calls the hooks after the second one, so by the time any hook runs every module's
  providers _and_ controllers already exist. What the hook orders is modules — a module that
  imports another runs after it — and not isolation, and the document says so rather than
  implying a per-module enclosure the boot does not build.
- **Within one module, providers run in declaration order and controllers follow them**, so
  the order is a fact of the declaration rather than of a map's iteration.
- **`onApplicationBootstrap` runs once, after the gateway pass, and before the application
  can listen.** A hook that needs the whole graph — a scheduler, a migration check, a cache
  warm — has one place to stand.
- **A gateway is a class provider, so it carries these hooks like any other provider.** Its
  `afterInit` stays the gateway's own moment and is unchanged by this design.
- **Every hook may return a promise, and the boot awaits it.** A hook that does not is not
  made to pay for the ones that do: the boot awaits whatever it is handed, which costs
  nothing for a synchronous return.

The hooks are read in one pass per moment rather than compiled into the container, so a
provider whose method appears at runtime is called and one whose method is `undefined` is
skipped — the same reading the interceptor halves already get.

**The interleaving above is this document's design, not a claim about Nest.** The names are
Nest's; if exact interleaving parity with Nest is wanted later, it is one ordering change
verified against Nest's own documentation rather than against recollection.

## Failure

**A hook that throws while the application is starting fails the boot**, and the value
propagates as it was thrown. It is not wrapped in an `AponiaError`: the closed union is for
failures the framework detects, and this is an application's own failure — the same way a
controller's thrown value is not wrapped. A hook that rejects at boot leaves the same state
a failed `AponiaFactory.create` leaves today.

**A hook that throws while the application is stopping is reported and does not stop the
rest.** Each remaining hook still runs, the server still stops, and the failure reaches the
system logger as a failure — the same treatment `packages/platform-elysia/AGENTS.md` gives a
declared filter that throws. A pool that refuses to close must not be able to keep every
other pool open, and `close()` must not become a call that cannot complete.

**`close()` runs the shutdown hooks even when the application never listened.** Every test
in this repository drives an application through `handle` and closes it, so a shutdown hook
that only ran after `listen` would be a hook nobody's tests could reach.

## Where the calls live

The platform owns them, because the platform owns the order everything else happens in. The
container stays a container: `initializeModule` keeps resolving providers and gains no
lifecycle responsibility, and `@aponiajs/core` gains no new concept. This keeps the dependency
direction untouched and means a consumer that uses the container without the platform gets a
container, not half an application.

## What deliberately does not change

**Request and transient scopes.** A request-scoped provider is a different mechanism with a
different lifetime, and `README.md:597` names it separately. This seam does not introduce it,
and a hook is not a scope.

**What the devtools package reports.** It already reports which interceptor halves a class
implements, read from the instance, and it could report lifecycle halves the same way. That
is a small follow-up and it is not needed for the seam to work, so it is not in this design.

**`@aponiajs/schedule`, or any cron surface.** The seam is what such a package would stand on.
Shipping it here would put a scheduler in a release whose lifecycle contract has not been
used by anything yet.

**Any runtime in `@aponiajs/common`.** The contracts are types. A call site is the platform's.

## Considered and rejected

**Declaring hooks through metadata, with a decorator or a descriptor field.** Rejected on two
grounds. The instance check is what the framework already does for an interceptor's halves,
so a second mechanism would be a second way to say the same thing; and a descriptor field
would widen the frozen descriptor contract, the artifacts built from it, and inspection, to
carry a fact the instance already carries.

**Calling the hooks from `@aponiajs/core`.** Rejected: the container resolves instances, and
when an application has _started_ is not a container's question. The boot knows the order and
already documents it.

**Wrapping a hook's failure in an `AponiaError`.** Rejected: the closed union describes what
the framework detects. An application's own thrown value is not the framework's diagnosis, and
wrapping it would hide the application's error behind a code that says nothing about it.

**Shipping only the two hooks the cron question needs.** Rejected: the two are the ones a
scheduler uses, but a pool needs `onModuleDestroy` and an interceptor-shaped cache needs
`beforeApplicationShutdown`, and adding them later would widen a contract the release already
published. The cost of all five is one more check in a loop that exists.

## Testing

- **`packages/platform-elysia/tests/lifecycle.test.ts`** — a module graph with two modules, one
  importing the other, each provider recording its calls: dependency-before-dependent for
  `onModuleInit`, reverse for `onModuleDestroy`, providers before their module's controllers,
  `onApplicationBootstrap` exactly once and after the routes mount, and
  `beforeApplicationShutdown` → server stopped → `onModuleDestroy` → `onApplicationShutdown` in
  that order. Beside them: a hook that throws at boot fails it with the thrown value unchanged,
  a hook that throws during shutdown is reported and the remaining hooks still run, and
  `close()` fires the shutdown hooks on an application that never listened.
- **The descriptor path** — the same hooks on a class registered with `provideClass` and no
  decorator at all, asserted in the same suite, because that parity is the point of the
  instance-based contract.
- **`packages/platform-elysia/tests-vp/lifecycle.conformance.ts`** — the public contracts: a
  class implementing each interface compiles against the exported types, and one boot over
  `handle` shows a provider's hook running.
- **`examples/lifecycle`** — a provider that records its start and stop and a route that reads
  the record, asserted end to end, so a person can see the seam rather than read about it.
- **Guards** — `scripts/source-layout.spec.ts` gains `lifecycle` among `packages/common/src`'s
  directories; `scripts/learning-path.spec.ts` requires the new chapter to be numbered
  contiguously, listed, and chained from its predecessor; `packages/common/llms.txt` advertises
  the five type exports.

## Delivery order

Three pieces, each shippable alone:

1. **The contracts and the calls**, with their tests — the seam itself, and the only piece that
   can break a boot.
2. **The documentation**: the reference page, the learn chapter, the scope-of-record edits, and
   the `llms.txt` entries. A public behaviour change ships with its documentation in the same
   pull request; this is that piece.
3. **The example**, last, because it is the only piece that can be written once the seam's
   observed behaviour is fixed by piece 1.

## What this document does not decide

- **Exact interleaving parity with Nest.** The names are Nest's; the order above is this
  document's, and matching Nest exactly would need its documentation checked rather than
  recalled. It is one ordering change if the maintainer wants it.
- **Whether the devtools reports lifecycle halves.** Small, follow-up, and argued above.
- **Anything about scheduled work beyond the seam being its foundation.** The cron question was
  answered separately: a recipe and an example can be written on this seam, and a first-party
  package would follow it.
