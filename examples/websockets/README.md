# WebSocket gateway example

This application mounts a Nest-style gateway as a normal Aponia provider while
Elysia and Bun own the native WebSocket connection.

```bash
bun run example:websockets
```

Connect to `ws://localhost:3070/chat` and send:

```json
{
  "event": "chat.send",
  "data": {
    "text": "Hello"
  }
}
```

The gateway responds with a `chat.message` envelope. The end-to-end suite also
asserts lifecycle-compatible native sockets, falsy response values, unknown
events, and safe handler errors.

[WebSocket guide](../../docs/websockets.md)
