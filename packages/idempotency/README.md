# @aponiajs/idempotency

Idempotent replay for mutating HTTP requests in an Aponia application.

```bash
bun add @aponiajs/idempotency@alpha
```

## Use it

```ts
import { Module } from "@aponiajs/common";
import { IdempotencyModule } from "@aponiajs/idempotency";

@Module({ imports: [IdempotencyModule.register()] })
export class AppModule {}
```

```http
POST /orders HTTP/1.1
Idempotency-Key: order-42
Content-Type: application/json
```

The first request with a key runs normally and records its `2xx` status and
body. A repeat with the same key and request answers the recorded status and
body without reaching the handler. A key reused with a different body is
refused with `409` Problem Details.

## Options

| Option       | Default                      | Meaning                                          |
| ------------ | ---------------------------- | ------------------------------------------------ |
| `ttlMs`      | 24 hours                     | How long a recorded answer may be replayed.      |
| `maxEntries` | 1000                         | The default store's bound.                       |
| `header`     | `idempotency-key`            | The request header carrying the key.             |
| `requireKey` | `false`                      | Refuse a covered request without a key.          |
| `methods`    | `POST`, `PATCH`, `PUT`       | The methods the plugin covers.                   |
| `store`      | bounded process-local memory | A shared or durable implementation.              |
| `onError`    | silence                      | Called when the store cannot read or write.      |
| `scope`      | none                         | Namespaces a key by caller, e.g. subject/tenant. |

## Limits

The recorded body must be JSON-serializable. A `Response`, a stream, a
generator, or an `undefined` result is answered normally but not recorded, so a
repeat runs the handler again. Replay restores the status and body; headers a
handler set itself are not replayed. Concurrent repeats share the first run.

The default store is process-local. A deployment with several instances passes
a shared `IdempotencyStore`; the contract is asynchronous, so a database or
shared cache fits it. Cross-replica atomicity requires the store to implement the
optional `claim(key, ttlMs)` and `release(key)` operations atomically — the Redis
store uses `SET NX PX`. A store without them keeps the single-process guarantee
only.

## Bootstrap

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule);
await application.listen(Number(Bun.env.PORT ?? 3000));
```

## Documentation

- [Agent surface](../../docs/agent/README.md)
- [Published packages](../../docs/packages.md)
- [npm](https://www.npmjs.com/package/@aponiajs/idempotency)
