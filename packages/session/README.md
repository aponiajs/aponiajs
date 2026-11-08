# @aponiajs/session

Signed session cookies and a bounded session store for AponiaJS.

```bash
bun add @aponiajs/session@beta
```

## Use it

```ts
import { Module } from "@aponiajs/common";
import { SessionModule } from "@aponiajs/session";

@Module({
  imports: [
    SessionModule.register({
      secret: process.env.SESSION_SECRET!,
    }),
  ],
})
export class AppModule {}
```

```ts
import { Injectable } from "@aponiajs/common";
import { SessionService } from "@aponiajs/session";

@Injectable()
export class LoginService {
  constructor(private readonly sessions: SessionService) {}

  async login(userId: string) {
    return this.sessions.start({ userId });
  }

  async logout() {
    await this.sessions.destroy();
  }
}
```

The global plugin reads the signed cookie before the handler and writes or
removes it after the handler. `SessionService.current()` reads the session the
request loaded.

## Options

| Option            | Default      | Meaning                              |
| ----------------- | ------------ | ------------------------------------ |
| `secret`          | required     | HMAC secret, at least 32 characters. |
| `cookieName`      | `aponia.sid` | Session cookie name.                 |
| `ttlMs`           | `86_400_000` | Absolute session lifetime.           |
| `store`           | memory       | A custom `SessionStore`.             |
| `maxSessions`     | `10_000`     | In-memory store cap.                 |
| `rolling`         | `false`      | Extend the lifetime on each read.    |
| `cookie.secure`   | `true`       | The cookie `Secure` attribute.       |
| `cookie.sameSite` | `lax`        | The cookie `SameSite` attribute.     |

## Behavior

- The cookie carries a signed session id, never the session data.
- The cookie is `HttpOnly`; the application reads the session through
  `SessionService`, not JavaScript.
- `start` creates a session and marks the cookie for the response.
- `regenerate` replaces the session with a new id and lifetime; use it after login, a role change, or a password reset so a fixation id stops being accepted.
- `update` replaces the data; `rolling` also extends the lifetime.
- `destroy` deletes the session and removes the cookie.
- A tampered or expired cookie is ignored and cleared.
- The memory store is bounded and evicts the oldest insertion.
- Configuration failures are `INVALID_SESSION_OPTIONS` with a frozen issue list.

## Limits

The default store is process-local and not a distributed session store. A
multi-process deployment supplies a shared `SessionStore` and keeps the same
signed-cookie contract.

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
- [npm](https://www.npmjs.com/package/@aponiajs/session)
