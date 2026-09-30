# @aponiajs/cron

```bash
bun add @aponiajs/cron
```

Declare scheduled jobs in an Aponia module, with the jobs read from a validated
configuration.

## What this package is, and what it is not

**AponiaJS adds no scheduling engine.** The engine is
[`@elysia/cron`](https://www.npmjs.com/package/@elysia/cron), which wraps
[croner](https://github.com/hexagon/croner). This package is a thin adapter over
that plugin, and it contributes exactly two things:

- a module a registration belongs in, so a scheduler is declared in an
  application's `imports` the way every other module is, and so what it
  scheduled is part of the compiled graph;
- a validated configuration the jobs are read from, so a malformed value is a
  refused boot with a code and an issue list rather than a throw from inside a
  plugin.

Everything else — the patterns, the options, the timing, the throw behaviour of
a job — is `@elysia/cron`'s and croner's. **A reader who wants the raw plugin
should use [`@elysia/cron`](https://www.npmjs.com/package/@elysia/cron)
directly**: nothing here is unavailable there, and mounting it yourself through
a `PluginModule` costs a few lines.

Read the next paragraph before scheduling anything you care about.

**This is not a job queue.** There is no persistence: a job that did not run
because the process was down did not run, and nothing replays it. There are no
retries: a `run` that throws is the engine's business, and the default is that
the throw escapes the timer rather than being retried or recorded. There is no
cross-process coordination and no distributed lock: two instances of an
application running the same registration both run the same jobs, at the same
moment, once each. **A cron expression in one process runs in that process.** A
user who assumes otherwise will lose data, and no option here changes that — a
scheduler for work that must happen exactly once across a fleet is a different
package, and this one deliberately does not pretend to be it.

## Declaring a scheduler

`CronModule.register` returns a `DynamicModule`, which is what an `imports`
entry accepts:

```ts
import { Module } from "@aponiajs/common";
import { CronModule } from "@aponiajs/cron";
import { CronConfig } from "./config.ts";

const scheduler = CronModule.register({ configuration: CronConfig });

@Module({ imports: [scheduler] })
export class AppModule {}
```

Both spellings mount the same module, and neither is lowered into the descriptor
artifact `aponia build` writes. `aponia build` lowers an `imports` entry only
when it is a single identifier naming a declaration read from the project's own
source, and `CronModule.register({ ... })` returns a `DynamicModule` — a runtime
value rather than such a declaration — so the module that names it is reported
as `DECLINED` and left out of `descriptors.generated.ts` in every spelling,
inline or held in a `const`. The scheduler still mounts and the application
still boots; what is given up is the declared-graph boot, described in
[the CLI reference](../../docs/cli.md#module-descriptors).

## The validated configuration

The jobs come from a configuration the application declares and the module
validates, not from an object literal:

```ts
import { defineConfiguration } from "@aponiajs/common";
import { z } from "zod";

export const CronConfig = defineConfiguration(
  z
    .object({
      CRON_PATTERN: z.string().min(1).default("*/5 * * * * *"),
      CRON_TIMEZONE: z.string().min(1).default("UTC"),
      INVOICE_BATCH: z.coerce.number().int().positive().default(100),
    })
    .transform(({ CRON_PATTERN, CRON_TIMEZONE, INVOICE_BATCH }) => ({
      jobs: [
        {
          name: "invoices",
          pattern: CRON_PATTERN,
          options: { timezone: CRON_TIMEZONE, protect: true },
          run: ({ options }) => sendInvoices({ batch: INVOICE_BATCH, protect: options.protect }),
        },
        {
          name: "heartbeat",
          pattern: "*/10 * * * * *",
          run: () => log("alive"),
        },
      ],
    })),
  "cron.config",
);
```

What that shape buys is the two failure modes it removes. A `CRON_PATTERN` an
operator mistyped is refused by the schema before any job exists, so the boot
fails with `INVALID_CONFIGURATION_VALUE` and a list of the fields that were
wrong — rather than a `Cron` constructor throwing from inside a plugin's state
function, or, for a pattern croner happens to tolerate as an impossible date, a
job that silently never runs.

The jobs themselves are not configuration data: `run` is a function, and no
schema validates a function out of the environment. What the schema validates is
the parameters, and the transform that reads them builds the jobs around them —
which is why the example above can hand a job a number parsed from an
environment variable while the job's `run` stays a closure over the
application's own services.

`CronModule.register` provides this token itself, from `process.env`, and
exports it, so the application can read the same validated value back:

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";
import { CronConfig } from "./config.ts";

const application = await AponiaFactory.create(AppModule);
application.get(CronConfig); // the value the scheduler scheduled
```

`source` overrides what the schema validates — a literal record instead of the
environment — which is what a test uses:

```ts
const scheduler = CronModule.register({
  configuration: CronConfig,
  source: { CRON_PATTERN: "*/1 * * * * *" },
});
```

`key` names the module's identity and defaults to `"cron"`. Two registrations
that share one are one module identity, which the graph refuses as a duplicate
rather than quietly scheduling one set of jobs twice. One registration per
application is the shape this module supports: two of them mount and run, but
both are the `CronScheduler` token, so reading one back raises
`AMBIGUOUS_PROVIDER`.

## A job

```ts
interface CronJob<TOptions extends CronJobOptions = CronJobOptions> {
  readonly name: string;
  readonly pattern: string;
  readonly options?: TOptions;
  run(context: CronJobContext<TOptions>): unknown;
}

interface CronJobContext<TOptions extends CronJobOptions = CronJobOptions> {
  readonly name: string;
  readonly pattern: string;
  readonly options: TOptions;
}
```

- **`name`** is the job's identity in the scheduler. It must be a non-empty
  string, and the scheduler checks that before it mounts anything.
- **`pattern`** is a cron expression, an ISO 8601 time, or a date, exactly as
  croner accepts it. Six fields include seconds; five do not. It must be a
  non-empty string.
- **`options`** is forwarded to croner untouched: `timezone`, `maxRuns`,
  `protect`, `paused`, `startAt`, `stopAt`, `utcOffset`, `interval`,
  `legacyMode`, `context`, `catch`, `kill`, and `unref`. The type is derived from
  `@elysia/cron`'s own declaration rather than restated here, so it cannot drift
  from the engine.
- **`run`** is called once per tick, with a frozen context carrying the job's own
  name, pattern, and the options this package forwarded. It may be asynchronous;
  its return value is ignored.

`protect: true` is the option worth knowing about first: it skips a tick while
the previous one is still running, which is what keeps a job slower than its own
pattern from piling up.

### `run` receives a context, not the Elysia store

This is the one place the adapter's contract differs from the plugin it wraps.
`@elysia/cron` calls `run` with the Elysia store — its own type claims `Cron`,
which is not the value it passes — and a job declared here is called with
`CronJobContext` instead, because a store is a transport detail of the plugin
rather than something a scheduled job has a use for. A job lifted out of a raw
`@elysia/cron` call therefore needs its parameter changed; nothing else about it
does.

## Lifecycle

Jobs start when the module mounts — while the application is being built, before
anything listens — and are ended when the application closes:

```ts
const application = await AponiaFactory.create(AppModule);
await application.listen(3000);

// later
await application.close(); // every job this boot scheduled has stopped
```

`close()` ends them through the module's `CronScheduler`, which runs its
`onApplicationShutdown` hook. That works whether or not the application ever
listened, and it is per boot: one registration declared by one module class is
one `DynamicModule`, so two applications built from it in one process hold two
schedulers, and stopping one leaves the other's jobs running. Reaching the
scheduler is how an application reads back what a boot scheduled:

```ts
import { CronScheduler } from "@aponiajs/cron";

const scheduler = application.get(CronScheduler);

scheduler.jobs; // the jobs the configuration produced
scheduler.scheduled; // the names the engine actually has
```

## Errors

A configuration this package refuses raises `AponiaError` with:

- `INVALID_CONFIGURATION_VALUE` when the schema rejects the value — the
  environment a deployment supplied, or a `source` a test passed — or when the
  value the schema produced is not a list of jobs. Both cases carry
  `{ configuration, issues }`, so one shape covers a refusal wherever it landed.
- `INVALID_CONFIGURATION` when the declaration is not a Standard Schema, or its
  validation answers asynchronously, both of which `provideConfiguration`
  already refuses for any configuration.

A job's own throw is not one of these. It is the engine's, it is not retried,
and `options.catch` is how a job asks croner to survive one.

## Requirements

`elysia` is a peer dependency and must be installed by the application;
`@elysia/cron` is a dependency of this package and is installed with it.
