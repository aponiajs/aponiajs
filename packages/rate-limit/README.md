# @aponiajs/rate-limit

Bounded request rate limiting for AponiaJS, with a route guard, a fixed-window
store, standard headers, and a `429` Problem Details refusal.

```bash
bun add @aponiajs/rate-limit@beta
```

## Use it

```ts
import { Controller, Get, Module, UseGuards } from "@aponiajs/common";
import { RateLimit, RateLimitGuard, RateLimitModule } from "@aponiajs/rate-limit";

@Controller("login")
@UseGuards(RateLimitGuard)
class LoginController {
  @Get()
  @RateLimit({ limit: 5, windowMs: 60_000 })
  read() {
    return "ok";
  }
}

@Module({
  imports: [RateLimitModule.register({ limit: 60, windowMs: 60_000 })],
  controllers: [LoginController],
})
export class AppModule {}
```

The guard answers `429` with a Problem Details body once the bucket is
exhausted. Allowed answers carry `RateLimit-Limit`, `RateLimit-Remaining`, and
`RateLimit-Reset`. The refusal also carries `Retry-After` in whole seconds, so a
client waits for the reset window instead of retrying blindly.

## Keys

The default bucket key is the route identity. It is deliberately not derived
from `X-Forwarded-For` or any other client-supplied header, because a direct
client can spoof those. Supply a `key` function when the deployment has a trusted
proxy that establishes the client address:

```ts
RateLimitModule.register({
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

An invalid option fails the boot with `INVALID_RATE_LIMIT` and an issue list.

## Bootstrap

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule);
await application.listen(Number(Bun.env.PORT ?? 3000));
```

## Documentation

- [Published packages](../../docs/packages.md)
- [AponiaJS architecture](../../docs/architecture-and-style.md)
- [npm](https://www.npmjs.com/package/@aponiajs/rate-limit)
