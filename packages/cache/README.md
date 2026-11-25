# @aponiajs/cache

Bounded application caching for AponiaJS, with TTL, a small store contract, and
one injectable service.

```bash
bun add @aponiajs/cache@alpha
```

## Use it

Import the module, register it once, and inject `CacheService` where the
application needs a cache.

```ts
import { Module } from "@aponiajs/common";
import { CacheModule } from "@aponiajs/cache";

@Module({
  imports: [CacheModule.forRoot({ ttlMs: 30_000, keyPrefix: "users:" })],
})
export class AppModule {}
```

```ts
import { Injectable } from "@aponiajs/common";
import { CacheService } from "@aponiajs/cache";

@Injectable()
export class UsersService {
  constructor(private readonly cache: CacheService) {}

  find(id: string) {
    return this.cache.wrap(`user:${id}`, () => this.load(id));
  }

  private load(id: string) {
    return { id, name: "Ada" };
  }
}
```

`wrap` is single-flight: concurrent misses for one key share a single factory
run, so a burst of traffic reaches the origin once. A rejection is shared with
the waiting callers and leaves no entry behind, so the next call retries.

## What it guarantees

- `CacheService` prefixes every key with the registration's `keyPrefix`.
- `undefined` is never stored; writing it deletes the entry instead.
- A write without a lifetime never expires; a non-positive TTL deletes the entry.
- The default memory store is bounded and evicts the oldest insertion when full.
- Expiry is lazy: no timer is created per entry, so a large cache costs no
  scheduled work.
- Values are stored by reference. The cache does not clone, serialize, or
  encrypt them.

## Store contract

A registration may supply any `CacheStore`:

```ts
interface CacheStore {
  get<T>(key: string): T | undefined | Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs?: number): void | Promise<void>;
  delete(key: string): boolean | Promise<boolean>;
  clear(): void | Promise<void>;
}
```

An omitted `ttlMs` means the entry never expires, which is also the
registration's default, matching `@nestjs/cache-manager`.

The built-in `MemoryCacheStore` is process-local. It is not a distributed cache,
a session store, or a durable queue. Applications that need shared state supply
a store backed by their own infrastructure and keep the same TTL and key rules.

## Options

| Option       | Default | Meaning                                      |
| ------------ | ------- | -------------------------------------------- |
| `ttlMs`      | unset   | Default entry lifetime; unset never expires. |
| `maxEntries` | `1_000` | Memory store cap; oldest insertion evicted.  |
| `keyPrefix`  | `""`    | Prefix applied to every key.                 |
| `store`      | memory  | A custom `CacheStore`.                       |
| `isGlobal`   | `false` | Makes the registration's exports global.     |

An invalid option fails the registration with `INVALID_CONFIGURATION_VALUE` and
an issue list. `forRootAsync` accepts `useFactory`, `useClass`, or `useExisting`
and validates the resolved value when the options token first resolves.

## Registration contract

`CacheModule` extends the `ConfigurableModuleBuilder` definition in
`cache.module-definition.ts`, so the registration exports `MODULE_OPTIONS_TOKEN`
(the `CACHE_MODULE_OPTIONS` token), `CACHE_MANAGER` (the same instance as
`CacheService`), and `CacheService`. `register` and `registerAsync` remain as
deprecated aliases of `forRoot` and `forRootAsync`.

`@CacheKey("users")` and `@CacheTTL(1_000)` describe one handler's response.
`CacheInterceptor` writes a cacheable `GET` response; it does not replay one,
because Aponia's interceptor contract has no `next.handle()` — read-through
belongs to `CacheService.wrap`.

## Bootstrap

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule);
await application.listen(Number(Bun.env.PORT ?? 3000));
```

## Documentation

- [Published packages](../../docs/reference/packages.md)
- [AponiaJS architecture](../../docs/build/architecture-and-style.md)
- [npm](https://www.npmjs.com/package/@aponiajs/cache)
