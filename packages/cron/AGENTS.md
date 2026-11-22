# @aponiajs/cron — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The module an application imports to schedule jobs, the per-boot scheduler that
owns what the engine scheduled, and the guard that reads a validated
configuration into jobs. The engine is
[croner](https://github.com/hexagon/croner), which this package owns as a
dependency. It is a leaf — nothing in the framework depends on it — and its
registration is runtime-neutral, so it runs on every Aponia platform.

| Domain       | Owns                                                                                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `module/`    | `CronModule.register`, `CronModuleOptions`, the `DynamicModule` one registration lowers into                                                                     |
| `scheduler/` | `CronScheduler`, the job contract (`CronJob`, `CronJobContext`, `CronJobOptions`, `CronConfiguration`), and the guard that reads a configuration value into jobs |

`src/index.ts` is the only public barrel. Keep `*.types.ts` colocated with the
runtime boundary it describes.

## Invariants

- **This package adds no scheduling features, and no claim in it may imply
  one.** The engine is croner's. What is contributed is a module a registration
  belongs in and a validated configuration the jobs come from. A feature that
  would make this package more than a module — a retry, a persisted run, a lock
  across processes, a queue — is a different package, and the answer to "should
  the scheduler do this?" is no even when the answer would be convenient. The
  README states that boundary and the raw-engine alternative in its final Native
  escape hatch section; keep it there, because a reader who assumes exactly-once
  loses data, and no option here makes that assumption true.
- **The registration is an ordinary `DynamicModule`.** `CronModule.register`
  returns a frozen module whose `module` is the class itself, with a stable
  `id` (`CronModule[<key>]`) and `instanceId` derived from `key`. There is no
  native plugin and no platform import: a scheduler is providers and a
  lifecycle hook, so it runs wherever the container does. `aponia build` still
  declines the module that imports the registration — a `DynamicModule` is not a
  declaration — and the application boots from decorators.
- **The scheduler is a provider, not a module-level value.** A registration is
  one `DynamicModule` and a module class is declared once, so two applications
  built from one module class are two boots over one registration. Handles held
  in a closure or a module variable would be one application's jobs reachable
  from another's `close()`. The provider factory runs once per container, which
  is what makes each boot's handles its own; `tests/cron-module.test.ts` pins it
  by closing one of two applications built from one class and asserting the
  other's jobs are still scheduled.
- **`start()` runs once, in the provider factory.** The factory reads the
  validated configuration, builds the scheduler, and starts it in one
  expression, so a boot that never listens still schedules and a registered job
  cannot be silently skipped. `start()` is idempotent for a name already in the
  handle map.
- **croner is given a copy of the options, never the declaration.** croner
  fills its own defaults into the object it receives; a job's context must carry
  the options the job declared, or it observes values nobody wrote.
  `tests/cron-module.test.ts` pins the absence of `catch`, `interval`,
  `legacyMode`, `paused`, and `unref` in a job's context.
- **A job name is this package's, not croner's.** croner keeps a process-global
  registry of named jobs and refuses a second live job with the same name, which
  would make two boots of one registration collide. The engine is constructed
  without `name`; `CronScheduler.scheduled` reads the handle map.
- **The scheduler is provided under its own class token, and one registration
  per application is the supported shape.** The class token is what makes
  `application.get(CronScheduler)` the ordinary way to read a boot back. Two
  registrations in one application — given distinct keys, to get past the
  duplicate identity refusal — both mount and both run, but they are then one
  token behind two providers, so the read is `AMBIGUOUS_PROVIDER` and the graph
  says so rather than picking one. A per-registration token would remove that,
  and is deliberately not here: the shape it would make easier — two schedulers
  in one application — is not one this module supports. The Bun lane pins both
  the refusal and the ambiguity.
- **Shutdown is `onApplicationShutdown` on that provider, reached through
  `application.close()`.** A cron job starts whether or not anything was ever
  served, so a stop tied to the server would leave an application that only
  calls `handle()` scheduling forever. The provider rides the shutdown plan a
  boot attaches, which runs for such an application too. `stop()` rather than
  `pause()`, and the handles are dropped afterwards, so a second `close()` stops
  nothing a second time.
- **`CronJobOptions` is derived from croner's `CronOptions`, never restated.** A
  hand-written list of the engine's options is a copy that goes stale the
  release after it is written, and the failure is silent: the option exists, the
  type does not, and a caller cannot pass it. Deriving the type means a
  dependency that adds, renames, or drops an option moves this one, and
  `tests-vp/cron.conformance.ts` names the option set so the move is visible
  rather than absorbed.
- **`CronJob.run` stays a method declaration rather than a property holding a
  function type.** Under `strictFunctionTypes` a property is checked
  contravariantly in its parameter, so a job that declares narrower options —
  the ordinary case, a transform naming the options it forwards — produces a
  `CronJob<{ … }>` that is not assignable to `CronJob`, and the most natural
  declaration there is stops compiling against `CronConfiguration`. A method is
  bivariant and accepts it. The conformance lane asserts the assignment, so
  rewriting the method as a property fails `bun run check` rather than an
  application.
- **The pattern is validated where the application says it is, and nowhere
  else.** This package does not check cron syntax: croner accepts ISO times,
  dates, and five- and six-field expressions, and a second, narrower check here
  would refuse input the engine runs and still miss the impossible dates it
  silently tolerates. What the guard checks is the shape — a non-empty `name`, a
  non-empty `pattern`, a callable `run`, an object `options` — because those are
  the fields a start needs before the engine can throw its own bare `Error`.
  Syntax belongs to the schema the application declared, which is the whole
  reason the jobs come from one.
- **Every refusal is `AponiaError` with `INVALID_CONFIGURATION_VALUE` and
  `{ configuration, issues }`.** The shape a schema refusal already carries, so
  a caller reads one contract whichever half refused. The issue list is total:
  every field that fails is reported rather than the first. A job's own throw is
  deliberately _not_ translated — it is the engine's, it is not retried, and
  wrapping it would be this package claiming a resilience it does not have.
  `options.catch` is where a job asks croner to survive one, and the README says
  so.
- **The module provides the configuration it consumes and exports it.** The
  module is registered by the application that also declares the configuration,
  so a design where the application declares the token and the scheduler imports
  it would be a module cycle. Owning the declaration makes one module the whole
  story, and exporting it keeps `application.get(CronConfig)` working for the
  application that wrote it. `source` exists because `provideConfiguration`
  accepts it: a test validates a literal rather than mutating the process
  environment, and no case in either lane touches `process.env`.
- **A job's context is frozen.** A context a job could mutate would be a job
  mutating another tick's input.
- **`CronConfiguration` declares `jobs`, not a bare array.** The key is where a
  later, additive option on the configuration finds a home — a default timezone
  for every job, say — without a breaking change to the value's shape, and it is
  what makes the guard's refusal name `"jobs"` rather than report that the whole
  value is the wrong type.

## Tests

`tests/*.test.ts` under Bun, `tests-vp/*.conformance.ts` under Vite+. Both lanes
run real boots through `AponiaFactory.create` and assert what a scheduler does,
because timing is the whole subject: a case that only compiled the contract would
not notice a scheduler started with no job at all.

Every waiting case polls for the fact it is about rather than sleeping a fixed
span, and the pattern is six fields — `*/1 * * * * *` — so a tick lands in under
a second. Five fields would make every case in this package wait a minute, which
is a test nobody runs and a lane CI eventually drops. Each waiting case names its
own timeout, because the one that proves a stopped job stays stopped spends its
wait on top of the tick it waited for.

The four behaviors the Bun lane owns:

1. a job declared through a module registration actually runs;
2. a job receives the options the configuration parsed — a number where the
   source held the string `"1"`, which is the parse rather than the source's raw
   value, and the pattern the transform produced rather than the one the case
   wrote — and the context carries the declaration rather than croner's defaults;
3. `application.close()` stops the scheduler, and no further tick runs — asserted
   by waiting long enough for two more boundaries and finding the count unmoved,
   and by the scheduler's own `scheduled` list being empty;
4. an invalid configuration fails the boot with `AponiaError` and
   `INVALID_CONFIGURATION_VALUE`, for a schema refusal and for a value only a
   runtime can produce alike.

The per-boot case is the one a refactor is most likely to break, and it is the
reason the scheduler is a provider: two applications built from one module class,
one closed, the other's jobs still scheduled. Keep it.

The Vite+ lane mirrors all four and adds the compile-time contract, because the
type surface is where this package's claim about the engine is actually checked:
`keyof CronJobOptions` names croner's options, so a dependency release that moves
them fails here, and the `CronJob<{ timezone: string }>` assignment is what keeps
`run` bivariant.
