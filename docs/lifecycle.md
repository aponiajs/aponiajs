# Lifecycle

A provider can run code at five moments without a decorator, a descriptor field, or any
registration: the framework reads the method off the instance, the way it reads an interceptor's
halves.

| Hook                        | Runs                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `onModuleInit`              | Once per hooked provider or controller, in graph order, after the boot's controller pass and before the gateway pass |
| `onApplicationBootstrap`    | Once, after every route and gateway is mounted, before the application can listen                                    |
| `beforeApplicationShutdown` | Once, at the start of `close()`, before the server stops                                                             |
| `onModuleDestroy`           | Once per hooked provider or controller, in the order below reversed, after the server has stopped                    |
| `onApplicationShutdown`     | Once, last                                                                                                           |

```ts
import { Injectable, type OnApplicationShutdown, type OnModuleInit } from "@aponiajs/common";

@Injectable()
export class PoolService implements OnModuleInit, OnApplicationShutdown {
  async onModuleInit(): Promise<void> {
    // the graph is instantiated; this module's providers and controllers exist
  }

  onApplicationShutdown(): void {
    // the server has stopped; nothing else will ask this provider for anything
  }
}
```

`implements` is optional. An interface is how a signature drift becomes a compile error, and the
framework never reads the type: a class registered with `provideClass` and no decorator at all
carries these hooks exactly the same way, because the instance holds the method.

## The order

Modules run in graph order — a module that imports another initializes after it and is destroyed
before it — and within a module its providers run in declaration order, with its controllers after
them. `onModuleDestroy` is that whole sequence reversed, so a module's controllers are destroyed
before its providers. Instantiation does not interleave with the hooks: the boot instantiates every
module's providers and controllers first, so `onModuleInit` orders modules rather than enclosing one.

The hook belongs to a provider, not to the module: a `@Module()` class is never asked.

A hook may return a promise, and the boot awaits it.

## When a hook fails

A hook that throws while the application is starting fails the boot, and the value you threw is
what your caller catches — the framework does not wrap it. Hooks that had not run yet do not run.

A hook that throws while the application is stopping is reported through the system logger and the
remaining hooks still run; `close()` still stops the server. A connection pool that refuses to
close must not be able to keep every other pool open.

## `close()` without `listen()`

The stopping hooks run whether or not the application ever listened, which puts them in reach of a
suite that drives an application through `application.handle`: it can close the application and see
the hooks run, without binding a port.

## Stopping on a signal

A container runtime asks a process to stop with `SIGTERM`, and a terminal asks for the same thing
with `SIGINT`. By default this framework installs no handler for either: the runtime's default
action ends the process, and the hooks above never run. An application that wants the stop request
to run its own teardown asks for it where it starts serving:

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./src/app.module.ts";

const application = await AponiaFactory.create(AppModule);
await application.listen(3000, { shutdownSignals: true });
```

`shutdownSignals` is an option on `listen` rather than on `AponiaFactory.create`, because it
describes what happens once the application serves traffic: an application only ever driven through
`application.handle` never binds a listener, and one that binds one says so at the call that binds
it. It is also the compatibility line — installing a handler at boot would take the process's
signals away from every application object ever built, including the ones a test suite builds.

What a signal runs is exactly `close()`, so the order is the one at the top of this page:
`beforeApplicationShutdown`, the server stop, `onModuleDestroy`, `onApplicationShutdown`. The
default `closeActiveConnections` is used; the signal path does not choose a different one.

- **The first signal is answered; a second one is not.** The listeners are removed the moment the
  first signal arrives, so a repeat reaches the runtime's default action and ends the process at
  once. That is the escape hatch a teardown that never returns would otherwise take away, and it is
  what `Ctrl+C` twice has always meant.
- **The exit status is the signal's own.** The signal is re-raised after the listeners are gone
  rather than replaced by an exit call, so whatever reads the status sees `SIGTERM` or `SIGINT`
  rather than a number this framework chose.
- **A failing hook does not make the stop impossible.** A stopping hook that throws is reported
  through the system logger, the remaining hooks still run, and the process still exits.
- **A signal that arrives before `listen` has finished is not caught.** Only an application that
  started cleanly owns the process's signals.

## Readiness and liveness

An orchestrator needs to ask two different questions: whether the process is alive, and whether
this application can serve a request. The probes answer both, and they answer them from the
application's own route table:

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./src/app.module.ts";

const application = await AponiaFactory.create(AppModule, { health: true });
await application.listen(3000);
```

`health: true` mounts `GET /health/live` and `GET /health/ready`; `health: { livenessPath, readinessPath }`
moves them; omitting the option mounts nothing at all.

| Probe           | Answers                                                                     |
| --------------- | --------------------------------------------------------------------------- |
| `/health/live`  | `200 {"status":"pass"}` for as long as the process answers at all           |
| `/health/ready` | the same until the application begins to stop, then `503 {"status":"fail"}` |

Readiness flips before the first shutdown hook runs, so an orchestrator stops sending requests to an
application that has begun to tear down rather than during it. Liveness deliberately does not flip:
an orchestrator that restarted a draining replica would make a graceful stop impossible.

The response is `application/health+json` with `Cache-Control: no-store` — a cached probe answer is
a stale one, and a replayed `pass` from before the application began to stop is the request the
readiness flip exists to prevent.

The shape follows the IETF health-check draft, which is an expired Internet-Draft rather than a
standard, and this release sends only the one member that draft requires:

- no `checks` object, `serviceId`, `version`, `releaseId`, or `description`;
- no `warn` status — an application either is or is not able to serve;
- no middleware of any kind. A probe is an ordinary route with no hook, so no guard, interceptor,
  or filter runs for one: an orchestrator polling for readiness may not be able to present
  credentials, and an authentication guard on a probe reports every replica unhealthy at once.

The probes mount outside the module graph, so nothing about them reaches `compileRootModule`,
`inspectAponiaApplication`, or a generated artifact. A probe path a controller already claims fails
the boot with `DUPLICATE_ROUTE` instead, because Elysia would otherwise answer the repeated path
from whichever registration it resolves.
