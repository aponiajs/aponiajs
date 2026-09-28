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
