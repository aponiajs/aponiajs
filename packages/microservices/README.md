# @aponiajs/microservices

Message-pattern microservices for AponiaJS: `@MessagePattern()` /
`@EventPattern()` handlers dispatched by the application boot, and a transport
contract with an in-memory reference implementation.

```bash
bun add @aponiajs/microservices@beta
```

## Use it

```ts
import { Controller, EventPattern, MessagePattern, Module, Payload } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { InMemoryTransport } from "@aponiajs/microservices";

@Controller("users")
class UsersController {
  @MessagePattern("users.findOne")
  findOne(@Payload("id") id: string) {
    return { id };
  }

  @EventPattern("users.created")
  async created(@Payload("id") id: string) {
    await this.audit.record(id);
  }
}

@Module({ controllers: [UsersController] })
class AppModule {}

const transport = new InMemoryTransport();
const application = await AponiaFactory.create(AppModule, {
  microservices: [transport],
});

const user = await transport.send("users.findOne", { id: "42" });
await transport.emit("users.created", { id: "42" });
```

A handler receives the whole payload as its first argument; `@Payload("id")`
binds one property instead. A number pattern is canonicalized with `String()`, so
`@MessagePattern(7)` and `send(7)` meet.

## Errors

The application answers every delivery with a reply envelope rather than a raw
exception. A handler that throws becomes
`{ ok: false, error: { code: "MESSAGE_HANDLER_ERROR", message: "The message handler failed." } }`;
the stack and cause stay in the application log and never cross the transport. A
pattern no controller declared answers `UNKNOWN_MESSAGE_PATTERN`. The in-memory
client surfaces both as `MicroserviceCallError` with the same `code`.

## Transports

A transport owns the wire and implements three members:

```ts
import type { MicroserviceTransport } from "@aponiajs/common";

class BrokerTransport implements MicroserviceTransport {
  readonly name = "broker";

  async subscribe(handler: MicroserviceHandler) {
    await this.broker.handleIncoming(handler);
  }

  async close() {
    await this.broker.disconnect();
  }
}
```

The boot subscribes every configured transport once, after all providers and
controllers exist and after `onApplicationBootstrap`. `application.close()`
closes them before module-destroy hooks run. A transport that throws while
subscribing fails the boot, and the transports already started are closed first.

## Limits

`InMemoryTransport` is process-local and has no retry, persistence, ordering
guarantee across producers, or cross-process delivery; use `@aponiajs/queue`
for durable jobs and a broker transport for remote messaging. One transport
instance serves one application, and two controllers declaring the same pattern
fail the boot with `DUPLICATE_MESSAGE_PATTERN`.

Only decorated controllers contribute handlers. A controller declared through
the low-level descriptor API carries no message metadata.
