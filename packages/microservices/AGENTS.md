# @aponiajs/microservices — Agent Guide

Read the [repository guide](../../AGENTS.md) and [RULES.md](../../RULES.md)
first. This file covers only what is specific to this package.

## What this package owns

The broker-neutral messaging runtime. Decorators, the dispatch contract, and the
boot integration belong to `@aponiajs/common` and
`@aponiajs/platform-elysia`; this package owns the wire a transport carries.

| Domain       | Owns                                                                         |
| ------------ | ---------------------------------------------------------------------------- |
| `client/`    | `createMicroserviceClient`, correlation, timeouts, pending-call bounds       |
| `server/`    | `createMicroserviceServer`, target and reply checks, in-flight bounds        |
| `module/`    | `MicroserviceClientsModule`, lifecycle, registration token                   |
| `envelope/`  | CBOR v1 encoding, decoding, preflight limits, request-context recovery       |
| `transport/` | The SDK-neutral `Transport` seam, lifecycle, validation, `InMemoryTransport` |
| `brokers/`   | Broker adapters, shared SDK loading, config validation, broker base class    |

`src/index.ts` is the only public barrel. Broker classes stay unpublished
unless the factory contract needs them; test seams are imported relatively.

## Invariants

- **The broker seam is small.** `Transport` connects, publishes bytes,
  subscribes, and closes. Envelope encoding, correlation, dispatch, target
  checks, and policy belong to the client or server layer.
- **The boot contract stays separate.** `MicroserviceTransport` serves one
  application; one `Transport` instance is shared by a client and a server.
- **Every SDK is optional and lazy.** Import a broker SDK only inside the
  adapter's default loader, and only through a literal dynamic import. A package
  that installs one broker must not fail because another peer is absent.
- **Adapters never leak SDK state.** Errors carry a stable code, transport name,
  operation, and package name. Connection strings, credentials, topics, and
  payloads never reach an error or a log.
- **Validation precedes the SDK.** Destinations, groups, identifiers, limits, and
  enable flags are checked before a connection or subscription opens.
- **A broker transport is terminal after `close`.** Connect is idempotent,
  close is idempotent, and every subscription is tracked and released.
- **Delivery callbacks never reject.** Catch handler and settlement failures and
  translate them into the adapter's decision or a sanitized stop.
- **The framework provisions nothing.** No topic, queue, exchange, subscription,
  or dead-letter resource is created. Cloud reply destinations are operator
  configuration and server allowlists are exact.
- **Patterns are canonical strings.** Use `normalizeMessagePattern` and
  `isMessagePattern` from `@aponiajs/common`; a decorator and a transport accept
  exactly the same grammar.
- **Replies are data.** `send` returns the handler's value and throws
  `MicroserviceCallError` with the dispatcher's code. `emit` discards the value.
- **No delivery claim beyond the protocol.** Do not document exactly-once,
  transactions, managed dead-letter routing, or global ordering.

## Tests

`tests/*.test.ts` under Bun, `tests-vp/*.conformance.ts` under Vite+. Bun tests
use fake SDKs and a fake `Transport`; they never open a broker connection.
Live broker checks belong in `tests/brokers.e2e-spec.ts`, which Bun's default
glob skips, and run only through `bun run test:brokers`.

Every adapter test proves lazy loading, option rejection, publish and subscribe
behavior, settlement mapping, missing-package sanitization, pre-connect and
post-close refusal, and idempotent close. The runtime tests prove correlation,
timeouts, overload, close, target isolation, reply allowlists, malformed
envelopes, and handler-failure sanitization.
