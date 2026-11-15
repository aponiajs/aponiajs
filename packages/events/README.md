# @aponiajs/events

Typed, in-process application events for AponiaJS, with ordered awaitable
handlers and decorated listeners.

```bash
bun add @aponiajs/events@alpha
```

## Use it

```ts
import { Module } from "@aponiajs/common";
import { EventEmitterModule } from "@aponiajs/events";

@Module({ imports: [EventEmitterModule.register()] })
export class AppModule {}
```

```ts
import { Injectable } from "@aponiajs/common";
import { EventEmitter, OnEvent } from "@aponiajs/events";

@Injectable()
export class UsersService {
  constructor(private readonly events: EventEmitter) {}

  async create(name: string) {
    const user = { id: "1", name };
    await this.events.emit("user.created", user);
    return user;
  }
}

@Injectable()
export class Mailer {
  @OnEvent("user.created")
  async sendWelcome(user: { name: string }): Promise<void> {
    // send the message
  }
}
```

Bind decorated listeners once, in a provider that the module owns:

```ts
import { Injectable, Module, type OnModuleInit } from "@aponiajs/common";
import { EventEmitter, EventEmitterModule } from "@aponiajs/events";

@Injectable()
class UserEvents implements OnModuleInit {
  constructor(
    private readonly events: EventEmitter,
    private readonly mailer: Mailer,
  ) {}

  onModuleInit(): void {
    this.events.bind(this.mailer);
  }
}

@Module({
  imports: [EventEmitterModule.register()],
  providers: [Mailer, UserEvents],
})
export class AppModule {}
```

The listener is a provider, so it shares the application's dependencies and its
lifecycle. `bind` returns an unsubscribe function for code that needs one; the
emitter is closed with the application.

## What it guarantees

- Handlers run in registration order, and `emit` awaits each one.
- A failing handler does not stop the rest. `emit` collects every failure and
  throws one `EVENT_HANDLER_ERROR` after all handlers ran.
- `once` removes the handler before it runs.
- `on` and `bind` return unsubscribe functions.
- Payloads are passed by reference and are not cloned or serialized.
- Delivery is in-process only. It is not a durable queue, an outbox, or a
  cross-process bus.

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
- [npm](https://www.npmjs.com/package/@aponiajs/events)
