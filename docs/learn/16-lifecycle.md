# 16 · Lifecycle

**Use when:** something must happen when the application starts or is closed when it stops.

A provider implements the lifecycle methods it needs. There is nothing to register:

```ts
import { Injectable, type OnApplicationShutdown, type OnModuleInit } from "@aponiajs/common";

@Injectable()
export class CacheService implements OnModuleInit, OnApplicationShutdown {
  onModuleInit(): void {
    // warm the cache once the graph is up
  }

  onApplicationShutdown(): void {
    // flush it once the server has stopped
  }
}
```

The five hooks are `onModuleInit`, `onApplicationBootstrap`, `beforeApplicationShutdown`, `onModuleDestroy`, and `onApplicationShutdown`.

`onApplicationBootstrap` runs after every route and gateway is mounted, before the application listens. `onModuleInit` runs when the module's providers are initialized.

Last chapter. Deep dive: [lifecycle](../build/lifecycle.md)
