# 15 · Lifecycle

**Use when:** something has to happen when the application starts, or to be closed when it stops.

A provider declares what it needs to do at each moment as a method. There is nothing to register:

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

The five methods are `onModuleInit`, `onApplicationBootstrap`, `beforeApplicationShutdown`,
`onModuleDestroy`, and `onApplicationShutdown`, named as Nest names them. `onApplicationBootstrap`
is the one to reach for when the hook needs the whole application rather than its own module.

Next: nothing — this is the last chapter. ·
Deep dive: [lifecycle](../lifecycle.md)
