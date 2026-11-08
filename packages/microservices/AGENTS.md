# @aponiajs/microservices — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The reference transport and client. The decorators, the dispatch contract, and
the boot integration belong to `@aponiajs/common` and
`@aponiajs/platform-elysia`; this package owns the wire behavior a transport
demonstrates.

| Domain       | Owns                                                  |
| ------------ | ----------------------------------------------------- |
| `transport/` | `InMemoryTransport`, `MicroserviceCallError`, options |

`src/index.ts` is the only public barrel.

## Invariants

- **One transport instance serves one application.** `subscribe` refuses a
  second application with `INVALID_MICROSERVICE_TRANSPORT`; `close` releases the
  slot so the same instance can be reused only after the first boot ended.
- **Delivery is in-process and direct.** No retry, persistence, queueing, or
  cross-process delivery belongs here. Do not add broker semantics; a broker
  transport implements `MicroserviceTransport` instead.
- **Patterns are canonical strings.** A number becomes `String(number)` and a
  string is trimmed; an empty pattern is a `TypeError` before delivery.
- **Replies are data.** `send` returns the handler's value and throws
  `MicroserviceCallError` with the dispatcher's stable code. `emit` discards the
  value but still reports a failure.
- **The client never invents a failure code the dispatcher would not send.**
  `TRANSPORT_NOT_CONNECTED` is the client's own state; every other code comes
  from the reply.
- **The payload is passed by reference.** Do not clone or validate it; message
  validation belongs to the transport or the handler.

## Tests

`tests/*.test.ts` under Bun, `tests-vp/*.conformance.ts` under Vite+. The Bun
lane boots a real application through `AponiaFactory.create` and covers request
and event dispatch, payload binding, numeric patterns, unknown patterns,
sanitized handler failures, duplicate patterns, invalid transports, partial
startup cleanup, and close behavior.
