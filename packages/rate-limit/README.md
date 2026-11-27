# @aponiajs/rate-limit

Bounded request rate limiting for AponiaJS, with a route guard, a fixed-window
store, standard headers, and a `429` Problem Details refusal.

```bash
bun add @aponiajs/rate-limit@alpha
```

## Use it

### Register the module

```ts
import { Module } from "@aponiajs/common";
import { RateLimitModule } from "@aponiajs/rate-limit";

@Module({
  imports: [RateLimitModule.forRoot({ limit: 60, windowMs: 60_000 })],
})
export class AppModule {}
```

### Use it in a controller

```ts
import { Controller, Get, UseGuards } from "@aponiajs/common";
import { RateLimit, RateLimitGuard } from "@aponiajs/rate-limit";

@Controller("login")
@UseGuards(RateLimitGuard)
export class LoginController {
  @Get()
  @RateLimit({ limit: 5, windowMs: 60_000 })
  read() {
    return "ok";
  }
}
```

The guard answers `429` with a Problem Details body once the bucket is
exhausted. Allowed answers carry `RateLimit-Limit`, `RateLimit-Remaining`, and
`RateLimit-Reset`. The refusal also carries `Retry-After` in whole seconds, so a
client waits for the reset window instead of retrying blindly.

### Use it in a service

```ts
import { Injectable } from "@aponiajs/common";
import { RateLimitService } from "@aponiajs/rate-limit";

@Injectable()
export class LoginThrottle {
  constructor(private readonly rateLimit: RateLimitService) {}

  attempt(userId: string) {
    return this.rateLimit.check(`login:${userId}`);
  }
}
```

`RateLimitService.check` consumes one token and answers the decision
(`allowed`, `limit`, `remaining`, `resetAt`); the guard uses the same service.

### Async registration

`RateLimitModule.forRootAsync` accepts a factory, a class, or an existing
provider, and a factory may answer a Promise:

```ts
RateLimitModule.forRootAsync({
  useFactory: async () => ({ limit: 60, windowMs: 60_000 }),
});
```

```ts
import { Injectable } from "@aponiajs/common";

@Injectable()
class RateLimitSettings {
  create() {
    return { limit: 120, windowMs: 60_000 };
  }
}

RateLimitModule.forRootAsync({ useClass: RateLimitSettings });
```

```ts
@Module({ providers: [RateLimitSettings], exports: [RateLimitSettings] })
class RateLimitSettingsModule {}

RateLimitModule.forRootAsync({
  imports: [RateLimitSettingsModule],
  useExisting: RateLimitSettings,
});
```

`register`/`registerAsync` remain the deprecated aliases of
`forRoot`/`forRootAsync`.

## Keys

The default bucket key is the route identity. It is deliberately not derived
from `X-Forwarded-For` or any other client-supplied header, because a direct
client can spoof those. Supply a `key` function when the deployment has a trusted
proxy that establishes the client address:

```ts
RateLimitModule.forRoot({
  key: (context) => {
    const request = context.switchToHttp().getRequest();
    return request.headers["x-real-ip"] ?? "unknown";
  },
});
```

`@RateLimit()` can override `limit`, `windowMs`, and `key` for one route.

## Store contract

```ts
interface RateLimitStore {
  increment(key: string, windowMs: number): RateLimitCounter | Promise<RateLimitCounter>;
}
```

The default `MemoryRateLimitStore` is process-local and bounded by `maxKeys`;
it evicts the oldest insertion. It is not a distributed limiter. A deployment
with several processes supplies a shared store and keeps the same fixed-window
contract.

## Options

| Option     | Default  | Meaning                         |
| ---------- | -------- | ------------------------------- |
| `limit`    | `60`     | Requests allowed in one window. |
| `windowMs` | `60_000` | Window length.                  |
| `maxKeys`  | `10_000` | Memory-store bucket cap.        |
| `store`    | memory   | A custom `RateLimitStore`.      |
| `key`      | route id | Default bucket-key function.    |
| `isGlobal` | `false`  | Makes the exports global.       |

An invalid option fails the registration with `INVALID_RATE_LIMIT` and an issue
list. The registration is a `ConfigurableModuleBuilder` definition: it provides
and exports `MODULE_OPTIONS_TOKEN` (`RATE_LIMIT_MODULE_OPTIONS`), accepts the
three asynchronous shapes through `forRootAsync`, and keeps
`register`/`registerAsync` as deprecated aliases.

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
- [npm](https://www.npmjs.com/package/@aponiajs/rate-limit)
