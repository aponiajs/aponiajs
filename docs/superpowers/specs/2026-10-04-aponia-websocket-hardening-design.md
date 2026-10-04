# WebSocket Production Hardening — Message Validation, Handshake Guards, and Payload Bounds

Status: design.

## Why this document

AponiaJS currently supports WebSocket gateways through `@WebSocketGateway()`,
`@SubscribeMessage()`, `@MessageBody()`, and `@ConnectedSocket()`, backed by
Elysia's native `.ws()` engine.

While functional for basic message routing, production deployments require three
critical capabilities that are currently missing:

1. **Per-Message Schema Validation:** Incoming message `{ event, data }` accepts any
   arbitrary payload without validation. Handlers must manually inspect or cast `data`.
   Production applications require declarative schema validation using Standard Schema
   (Zod, ArkType, Valibot) or TypeBox, with malformed data automatically rejected
   via safe RFC-style exception frames.
2. **Handshake Guards & Upgrade Policies:** Authentication currently happens inside
   `handleConnection()` after the socket is already upgraded and connected. Rejecting
   an unauthorized client after upgrade wastes socket descriptors and buffers.
   Handshake guards allow validating headers (e.g. `Authorization` or cookies) during
   the HTTP upgrade phase, rejecting unauthorized clients before WebSocket connection.
3. **Payload & Envelope Bounds:** Large frames can exhaust memory. Gateways should
   enforce configurable payload size limits and safe JSON parsing.

## What changes

| #   | Current State                                            | Proposed Hardened State                                                                                       |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | `@SubscribeMessage(event)` has no schema validation      | `@SubscribeMessage(event, { data?: validator })` validates incoming `data` against Standard Schema or TypeBox |
| 2   | Failed message data calls the handler with unsafe input  | Rejects with `{ event: "exception", data: { code: "INVALID_WEBSOCKET_MESSAGE", message: "..." } }`            |
| 3   | Handshake auth is post-upgrade inside `handleConnection` | `@WebSocketGateway({ path, guards?: [...] })` executes upgrade guards during HTTP handshake                   |
| 4   | No gateway-level message limits                          | Configurable `maxPayloadLength` rejects oversized payloads safely                                             |

## Contract changes

### 1. `@SubscribeMessage` accepts an optional schema

```ts
// packages/common/src/websockets/websocket-gateway.types.ts
export interface WebSocketMessageSchema {
  readonly data?: unknown; // Standard Schema or TypeBox validator
}

export function SubscribeMessage(event: string, schema?: WebSocketMessageSchema): MethodDecorator;
```

When a schema is declared:

- Incoming message `{ event, data }` is validated before the handler runs.
- Standard Schema (`~standard`) is validated asynchronously.
- TypeBox / ValidatorSchema is checked.
- On failure, sends exception frame:
  ```json
  {
    "event": "exception",
    "data": {
      "code": "INVALID_WEBSOCKET_MESSAGE",
      "message": "Message validation failed.",
      "details": [...]
    }
  }
  ```

### 2. `@WebSocketGateway` options and upgrade guards

```ts
// packages/common/src/websockets/websocket-gateway.types.ts
export interface WebSocketGatewayOptions {
  readonly path?: string;
  readonly maxPayloadLength?: number; // default 1MB (1_048_576)
  readonly guards?: readonly ClassToken<CanActivate>[];
}
```

During the HTTP upgrade phase (`beforeHandle` on the `.ws()` route):

- Resolves and executes declared handshake guards using the initial upgrade `ExecutionContext`.
- If any guard returns `false` or throws, Elysia rejects the HTTP request with `403 Forbidden` / `401 Unauthorized` before the socket upgrades.

### 3. Descriptor-first support (`defineWebSocketGateway`)

Mirrors the decorator changes:

```ts
defineWebSocketGateway(ChatGateway, {
  path: "/chat",
  maxPayloadLength: 65536,
  handlers: [
    {
      event: "chat.send",
      schema: { data: chatMessageSchema },
      propertyKey: "sendMessage",
      parameters: [...],
    },
  ],
});
```

## Testing Strategy

- **Validation:** Test that valid payloads reach the handler with decoded/parsed values; invalid payloads send the exception frame and do not invoke the handler.
- **Handshake Guards:** Test that an unauthorized HTTP upgrade is rejected with HTTP 403 without establishing a WebSocket connection.
- **Payload Limits:** Test that oversized messages trigger a safe rejection.
- **Isolation:** Ensure HTTP routes and WebSocket gateways continue operating without conflict.
