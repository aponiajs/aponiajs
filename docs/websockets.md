# WebSocket Gateways

Aponia gateways use Nest-style decorators and dependency injection while
Elysia owns the native Bun WebSocket server, upgrade, socket, serialization,
publish, subscription, and backpressure primitives.

## Define a gateway

```ts
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  type OnGatewayConnection,
  type WsResponse,
} from "@aponiajs/common";
import type { ElysiaWebSocket } from "@aponiajs/platform-elysia";
import { ChatService } from "./chat.service.ts";

@WebSocketGateway("/chat")
export class ChatGateway implements OnGatewayConnection<ElysiaWebSocket> {
  constructor(private readonly chatService: ChatService) {}

  handleConnection(client: ElysiaWebSocket): void {
    client.subscribe("chat");
  }

  @SubscribeMessage("chat.send")
  sendMessage(
    @MessageBody("text") text: string,
    @ConnectedSocket() client: ElysiaWebSocket,
  ): WsResponse<{ readonly id: string; readonly text: string }> {
    return {
      event: "chat.message",
      data: this.chatService.create(client.id, text),
    };
  }
}
```

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

## Wire protocol

Native WebSocket does not have Socket.IO event names. Aponia represents the
`@SubscribeMessage()` contract with a small JSON envelope:

```json
{
  "event": "chat.send",
  "data": {
    "text": "Hello"
  }
}
```

`@MessageBody()` injects the whole `data` value.
`@MessageBody("text")` selects one property, and `@ConnectedSocket()` injects
the native Elysia socket wrapper.

Handler results follow predictable rules:

- `undefined` sends no frame;
- any ordinary value, including `null`, `false`, or `0`, is returned as
  `{ "event": "<subscribed event>", "data": value }`;
- a `WsResponse` chooses a different response event;
- promises, generators, and async generators are resolved or streamed in
  order.

This keeps the authoring model close to Nest gateways without adding RxJS as a
framework dependency.

Gateway handler annotations remain type-checked on the server, but decorator
metadata is discovered at runtime and therefore cannot add gateway events to
the exported Eden Treaty application type. Use `configureNative` with Elysia's
typed `.ws()` API when static client route inference is required; the planned
build-time compiler is the path to decorator-wide Eden inference.

## Lifecycle and the native server

```ts
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayDisconnect,
  type OnGatewayInit,
} from "@aponiajs/common";
import type { ElysiaWebSocket, ElysiaWebSocketServer } from "@aponiajs/platform-elysia";

@WebSocketGateway("/events")
export class EventsGateway
  implements OnGatewayInit<ElysiaWebSocketServer>, OnGatewayDisconnect<ElysiaWebSocket>
{
  @WebSocketServer()
  server!: ElysiaWebSocketServer;

  afterInit(server: ElysiaWebSocketServer): void {
    // The native Elysia application is mounted and ready to be configured.
    void server;
  }

  handleDisconnect(client: ElysiaWebSocket): void {
    console.log(`${client.id} disconnected`);
  }
}
```

The platform assigns every `@WebSocketServer()` property before calling
`afterInit`. `handleConnection(client)` runs on open and
`handleDisconnect(client)` runs on close. Lifecycle return values are ignored;
promises are still awaited by Elysia's WebSocket lifecycle.

The injected server is the real Elysia application. The injected client is the
real Elysia socket wrapper, so methods such as `send`, `publish`, `subscribe`,
`unsubscribe`, `close`, `ping`, and `pong` remain available without an Aponia
adapter object.

`application.close()` closes active native connections by default so shutdown
cannot wait forever on an open WebSocket. Pass `false` only when the application
has its own drain policy and will close every connection itself.

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

Malformed envelopes, unknown events, and handler failures never serialize an
error stack or cause to the client.

## Native WebSocket features

Use the native socket passed by `@ConnectedSocket()` for Elysia/Bun topics and
broadcasting:

```ts
@SubscribeMessage("room.join")
joinRoom(
  @MessageBody("room") room: string,
  @ConnectedSocket() client: ElysiaWebSocket,
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

[Elysia native plugins](./native-plugins.md) ·
[Dependency injection](./dependency-injection.md) ·
[Testing](./testing.md)
