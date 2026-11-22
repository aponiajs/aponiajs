# WebSocket Gateways

Aponia gateways use Nest's authoring surface — `@WebSocketGateway()`,
`@SubscribeMessage()`, `@MessageBody()`, `@ConnectedSocket()`, and
`@WebSocketServer()` — and are ordinary providers, so constructor injection,
module visibility, handshake guards, and message filters work as they do on a
route.

Native WebSocket has no event names of its own, so the adapter's wire format
carries one: every frame is `{ event, data }` JSON. A client sends that object to
call a handler, and the platform sends the same object back — through
`client.emit(event, data)` or `server.emit(event, data)` on Hono and H3,
and through the native socket's `send` and `publish` on Elysia.

What differs between platforms is the socket the host binds, not the gateway
class. [Platform parity](./platform-parity.md) lists every delta; this page states
the surface per platform where it matters.

| Runtime                              | `@ConnectedSocket()` | `@WebSocketServer()`        | Broadcast            |
| ------------------------------------ | -------------------- | --------------------------- | -------------------- |
| Hono and H3 (`platform-*`)           | `GatewaySocket`      | `GatewayServer`             | `server.emit(event)` |
| Elysia (`@aponiajs/platform-elysia`) | native `ElysiaWS`    | the root Elysia application | native `publish`     |

## Define a gateway

```ts
import { MessageBody, SubscribeMessage, WebSocketGateway, type WsResponse } from "@aponiajs/common";
import { ChatService } from "./chat.service.ts";

@WebSocketGateway("/chat")
export class ChatGateway {
  constructor(private readonly chatService: ChatService) {}

  @SubscribeMessage("chat.send")
  sendMessage(@MessageBody("text") text: string): WsResponse<{ readonly text: string }> {
    return { event: "chat.message", data: this.chatService.create(text) };
  }
}
```

A returned `WsResponse` is emitted under the event it names, so the handler needs
no socket at all. Returning an ordinary value emits it under the subscribed
event. On Hono and H3, `client.emit(event, data)` answers one client
explicitly and `server.emit(event, data)` broadcasts; on Elysia the socket is
native, so `send` and `publish` are the calls to make.

Register the gateway as a provider. This is required: a decorated gateway that
is not in a module's `providers` collection is never constructed or mounted.
Its constructor dependencies use the same module visibility rules as every
other provider.

```ts
import { Module } from "@aponiajs/common";
import { ChatGateway } from "./chat.gateway.ts";
import { ChatService } from "./chat.service.ts";

@Module({
  providers: [ChatGateway, ChatService],
})
export class ChatModule {}
```

`@WebSocketGateway()` defaults to `/ws`. A string argument sets the native
upgrade path; `{ path: "/chat" }` is the equivalent object form. Gateways share
the HTTP application's server and port.

### Gateway options, handshake guards, and payload bounds

`@WebSocketGateway()` accepts configuration options:

```ts
@WebSocketGateway({
  path: "/chat",
  guards: [AuthGuard],
  maxPayloadLength: 65536,
  origins: ["https://app.example"],
  idleTimeoutMs: 30_000,
  sendPings: true,
})
export class ChatGateway {}
```

- `path`: The mount path (defaults to `"/ws"`). Applied by every platform.
- `guards`: Guards run for the connection. On Elysia they run during the HTTP
  upgrade and a refusal is `403` before the socket opens, so `handleConnection()`
  never runs. On Hono and H3 the upgrade has already happened when the
  guard runs; a refusal closes the socket with code `1008` and skips
  `handleConnection()`. A guard that throws is a refusal, and a socket that was
  not admitted cannot invoke a message handler. The guard context exposes the
  upgrade request through `switchToHttp().getRequest().request`, and the gateway
  class through `getClass()`.
- `maxPayloadLength`: Applied by every platform. Elysia's native server enforces
  it at the frame boundary; Hono and H3 enforce it per message in the shared
  dispatcher and answer an oversized message with an `INVALID_WEBSOCKET_MESSAGE`
  exception frame.
- `origins`, `idleTimeoutMs`, `sendPings`: Applied by the Elysia platform. On
  Elysia, `origins` compares the handshake `Origin` header exactly and answers
  `403` (a client with no `Origin` is refused while an allowlist is configured),
  `idleTimeoutMs` closes a silent socket (rounded up to whole seconds and clamped
  to at least one), and `sendPings` keeps a socket alive through an idle proxy.
  On Hono and H3 the server-wide values are merged onto the Bun listener; a host
  that owns its server keeps its own policy, and a host that cannot enforce an
  `origins` list refuses the gateway.

### Message schema validation

Validate incoming payloads by passing a schema to `@SubscribeMessage`:

```ts
import { t } from "elysia";

const ChatMessageSchema = t.Object({
  text: t.String({ minLength: 1 }),
});

@SubscribeMessage("chat.send", { data: ChatMessageSchema })
sendMessage(@MessageBody("text") text: string): WsResponse<{ text: string }> {
  return {
    event: "chat.message",
    data: { text },
  };
}
```

The `data` schema accepts Standard Schema validators (Zod, ArkType, Valibot),
TypeBox validators, or `@Validation()` model classes. When validation fails, the
handler is never invoked and an `INVALID_WEBSOCKET_MESSAGE` exception frame is
sent to the client. The shared dispatcher runs the same schema on Hono and H3,
so the handler receives the validated payload on every platform.

### Declare a gateway as data

Decorators are the authoring surface; `defineWebSocketGateway` is the same
gateway expressed as data, and it is what `aponia build` writes into
`descriptors.generated.ts`. The result is an ordinary class provider, so it is
registered in `@Module({ providers })` exactly as a decorated gateway is — and
the two can sit in the same application:

```ts
import { defineModule } from "@aponiajs/common";
import { defineWebSocketGateway } from "@aponiajs/platform-elysia";
import { ChatGateway } from "./chat.gateway.ts";
import { ChatService } from "./chat.service.ts";

export const ChatModule = defineModule({
  id: "ChatModule",
  providers: [
    defineWebSocketGateway(ChatGateway, {
      path: "/chat",
      guards: [AuthGuard],
      maxPayloadLength: 65536,
      inject: [ChatService],
      handlers: [
        {
          event: "chat.send",
          schema: { data: ChatMessageSchema },
          propertyKey: "sendMessage",
          parameters: [
            { index: 0, kind: "message-body", property: "text" },
            { index: 1, kind: "connected-socket", property: undefined },
          ],
        },
      ],
    }),
    ChatService,
    AuthGuard,
  ],
});
```

The class is unchanged: it still declares its handler methods, and it still
implements `OnGatewayInit`, `OnGatewayConnection`, and `OnGatewayDisconnect` by
implementing `afterInit`, `handleConnection`, and `handleDisconnect`. Those are
resolved from the instance while the gateway is bound, so a plan states none of
them. A plan states the path, one entry per `@SubscribeMessage()` handler with
its property key and its parameter bindings, and `serverProperties` — the
instance properties that receive the platform's server reference, as
`@WebSocketServer()` marks them.

A declared gateway reaches the same compilation a decorated one does: the path
and event uniqueness checks run at the same moment and raise the same error
codes, the envelope, unknown-event handling, and exception frames are the same,
and a plan never registers itself — the platform's gateway module stays the only
code that opens a socket route.

## Answering one client and broadcasting

On Hono, H3, and Nitro the socket is a `GatewaySocket` and the server reference
is a `GatewayServer`:

```ts
import { WebSocketServer, type OnGatewayInit } from "@aponiajs/common";
import type { GatewayServer, GatewaySocket } from "@aponiajs/platform-core";

@WebSocketGateway("/events")
export class EventsGateway implements OnGatewayInit<GatewayServer> {
  @WebSocketServer()
  server!: GatewayServer;

  afterInit(server: GatewayServer): void {
    server.emit("events.ready", { at: Date.now() });
  }

  @SubscribeMessage("events.join")
  join(@MessageBody("room") room: string, @ConnectedSocket() client: GatewaySocket): void {
    client.subscribe(room);
    this.server.emit("events.joined", { room });
  }
}
```

- `client.emit(event, data)` encodes `{ event, data }` and sends it to that one
  client.
- `server.emit(event, data)` sends the same frame to every client the gateway
  serves.
- `client.send(raw)` writes one raw text frame, `client.close(code, reason)`
  closes the socket, and `client.subscribe`/`client.publish` reach the runtime's
  topic primitives where the adapter provides them.

On Elysia the injected client is the native `ElysiaWS` and the injected server
is the root Elysia application, so the same gateway uses `client.send` and
`publish` there; see [the Elysia surface](#the-elysia-surface). A gateway that
must run on every platform should return its result rather than call `emit`, as
the handler-results table below describes.

## Wire protocol and handler results

A client calls a handler by sending the envelope:

```json
{
  "event": "chat.send",
  "data": {
    "text": "Hello"
  }
}
```

`@MessageBody()` injects the whole `data` value.
`@MessageBody("text")` selects one property, and `@ConnectedSocket()` injects the
platform's socket.

Handler results follow the same rules on every platform:

- `undefined` sends no frame;
- any ordinary value, including `null`, `false`, or `0`, is returned as
  `{ "event": "<subscribed event>", "data": value }`;
- a `WsResponse` chooses a different response event;
- promises are awaited.

Elysia also resolves generator and async-generator results in order. The kernel
platforms send a generator as an ordinary value, which serializes as `{}`, so a
streaming handler is an Elysia deployment.

This keeps the authoring model close to Nest gateways without adding RxJS as a
framework dependency.

Gateway handler annotations remain type-checked on the server, but decorator
metadata is discovered at runtime and therefore cannot add gateway events to
the exported Eden Treaty application type. Use `configureNative` with Elysia's
typed `.ws()` API when static client route inference is required; the planned
build-time compiler is the path to decorator-wide Eden inference.

## Lifecycle

```ts
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayDisconnect,
  type OnGatewayInit,
} from "@aponiajs/common";
import type { GatewayServer, GatewaySocket } from "@aponiajs/platform-core";

@WebSocketGateway("/events")
export class EventsGateway
  implements OnGatewayInit<GatewayServer>, OnGatewayDisconnect<GatewaySocket>
{
  @WebSocketServer()
  server!: GatewayServer;

  afterInit(server: GatewayServer): void {
    // The server reference is assigned and the platform is ready to be configured.
    void server;
  }

  handleDisconnect(client: GatewaySocket): void {
    console.log(`${client.id} disconnected`);
  }
}
```

The platform assigns every `@WebSocketServer()` property before calling
`afterInit`. `handleConnection(client)` runs on open and
`handleDisconnect(client)` runs on close. Lifecycle return values are ignored;
promises are still awaited.

The two type parameters name what the platform injects: `GatewayServer` and
`GatewaySocket` on Hono and H3; `WebSocketServerRef` and
`WebSocketClient` on Elysia.

On Elysia, `application.close()` closes active native connections by default so
shutdown cannot wait forever on an open WebSocket; pass `false` only when the
application has its own drain policy. The kernel application defaults to
`false`, and each host stops its listener with its own policy — Hono requests a
graceful stop, H3 stops with force.

## Errors

Bootstrap rejects invalid gateway contracts before the application listens:
duplicate paths, duplicate subscribed events, missing handlers, and invalid
server-property targets are `AponiaError` failures with stable WebSocket error
codes. Native plugin composition, including promised and asynchronous plugins,
finishes before gateway path collision checks.

Message failures use a safe response envelope:

```json
{
  "event": "exception",
  "data": {
    "code": "UNKNOWN_WEBSOCKET_EVENT",
    "message": "No WebSocket handler is registered for this event."
  }
}
```

A `@UseFilters()` filter declared on the gateway class or the message handler
runs first on every platform: it receives an `ArgumentsHost` whose `getType()` is
`"ws"`, and a value it returns is emitted under the subscribed event instead of
the frame. A filter that returns `undefined`, `null`, or throws leaves the
standard frame.

Malformed envelopes, unknown events, and handler failures never serialize an
error stack or cause to the client.

## The Elysia surface

Elysia 2 carries its own WebSocket implementation, and the Elysia platform binds
a gateway to it rather than wrapping it. The injected client is the native
`ElysiaWS`, so methods such as `send`, `publish`, `subscribe`, `unsubscribe`,
`close`, `ping`, and `pong` remain available without an Aponia adapter object,
and the injected server is the root Elysia application. `WebSocketClient` and
`WebSocketServerRef` in `@aponiajs/platform-elysia` are transparent aliases over
those two native types.

Use the native socket for Elysia topics and broadcasting:

```ts
@SubscribeMessage("room.join")
joinRoom(
  @MessageBody("room") room: string,
  @ConnectedSocket() client: WebSocketClient,
): void {
  client.subscribe(room);
  client.publish(room, {
    event: "room.joined",
    data: { clientId: client.id },
  });
}
```

For handshake hooks, gateway-wide Elysia schemas, origin policy, or other
transport-specific behavior not represented by the gateway decorators, use
`configureNative` and Elysia's `.ws()` API directly. Socket.IO-only concepts
such as namespaces, rooms managed by an adapter, and acknowledgement callbacks
are intentionally not emulated. Native WebSocket has no acknowledgement
callback; return a `WsResponse` instead.

## Verify it

```bash
bun test packages/platform-elysia/tests/websocket-gateway.test.ts
bun test packages/platform-core/tests/websocket-gateway.test.ts
bun run example:websockets
```

[Platform parity](./platform-parity.md) ·
[Testing](../build/testing.md) ·
[Dependency injection](../build/dependency-injection.md)
