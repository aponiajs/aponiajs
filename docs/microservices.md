# Microservices

An Aponia application can answer messages beside its HTTP routes. A handler is a
controller method decorated with `@MessagePattern()` (request/response) or
`@EventPattern()` (fire-and-forget); the boot compiles the handlers once, and a
transport delivers messages to that table.

```ts
import { Controller, EventPattern, MessagePattern, Module, Payload } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { InMemoryTransport } from "@aponiajs/microservices";

@Controller("users")
class UsersController {
  @MessagePattern("users.findOne")
  findOne(@Payload("id") id: string) {
    return this.users.findById(id);
  }

  @EventPattern("users.created")
  created(@Payload("id") id: string) {
    this.audit.record(id);
  }
}

@Module({ controllers: [UsersController] })
class AppModule {}

const transport = new InMemoryTransport();
const application = await AponiaFactory.create(AppModule, {
  microservices: [transport],
});

await transport.send("users.findOne", { id: "42" });
await transport.emit("users.created", { id: "42" });
```

Handlers are ordinary controller instances, so they inject services the same way
HTTP handlers do. A handler receives one payload argument: the whole message
payload by default, or the property `@Payload("key")` names. A numeric pattern
is normalized with `String()`, so `@MessagePattern(7)` answers `send(7)`.

## Transport contract

A transport implements `MicroserviceTransport` from `@aponiajs/common`:

```ts
interface MicroserviceTransport {
  readonly name: string;
  subscribe(handler: MicroserviceHandler): Promise<void> | void;
  close(): Promise<void> | void;
}
```

`subscribe` receives the boot's dispatcher; `close` stops delivery. A broker
adapter serializes `{ pattern, data }`, calls the handler, and returns the reply
envelope. The framework does not pick a broker: `@aponiajs/microservices` ships
`InMemoryTransport`, a process-local transport for tests and modular monoliths.

The boot starts transports after all providers and controllers exist and after
the `onApplicationBootstrap` hooks, so the first message cannot reach a
half-built graph. `application.close()` closes transports after the native
server stops and before module-destroy hooks. A transport that refuses to start
fails the boot; the transports already started are closed first.

## Replies and failures

The application answers every delivery with a reply envelope:

```ts
type MicroserviceReply =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string } };
```

A handler that throws answers `MESSAGE_HANDLER_ERROR` with the fixed message
"The message handler failed." The failure is reported through the application
logger, and the stack and cause never cross the transport. A pattern no
controller declared answers `UNKNOWN_MESSAGE_PATTERN`. `InMemoryTransport`
surfaces both as `MicroserviceCallError` with the same `code`.

## What the boot refuses

- Two controllers declaring one pattern: `DUPLICATE_MESSAGE_PATTERN`, before any
  transport exists.
- A transport without a non-empty name, `subscribe`, or `close`, or two
  transports sharing a name: `INVALID_MICROSERVICE_TRANSPORT`, with every issue
  in `details.issues`.
- A transport subscribed to a second application: the transport's own
  `INVALID_MICROSERVICE_TRANSPORT` refusal.

## Security and limits

Message handlers are not HTTP routes: the transport owns authentication,
authorization, and payload validation. A transport that accepts untrusted
producers must validate before dispatching. The reply envelope is the only error
shape the framework guarantees; a broker adapter must not widen it.

`@aponiajs/microservices` is not a queue. The in-memory transport adds no retry,
persistence, or cross-process delivery; `@aponiajs/queue` owns durable jobs and
the outbox, and a broker transport owns remote messaging. Only decorated
controllers contribute handlers; a controller declared through the low-level
descriptor API carries no message metadata.
