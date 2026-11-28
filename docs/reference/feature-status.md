# Feature Status

This page records the completeness of each package in the `1.0.0` (`latest`)
release. A feature is complete only when its package, public API, Bun tests
(and Vite+ conformance when the package ships a runtime import surface),
documentation, and release manifest all exist. Complete describes the
implementation and its test lanes; distributed stores (`@aponiajs/redis`,
`@aponiajs/database`) or external brokers should still be backed appropriately
for production workloads.

All 39 publishable packages ship together under `1.0.0` (`latest`). See
[Packages](./packages.md) for the complete package catalog and install commands.

The delivery adapter `@aponiajs/nitro`
is complete and superseded: it translates a runtime envelope to
`application.handle` and add no routing. Nitro is a delivery adapter rather than
a platform because it owns its server; boot on `@aponiajs/platform-h3` beside
it.

| Package                     | Status   | Evidence                                                                         |
| --------------------------- | -------- | -------------------------------------------------------------------------------- |
| `@aponiajs/common`          | Complete | decorators, descriptors, tokens, errors, WebSockets                              |
| `@aponiajs/compiler`        | Complete | scoped lifetimes, borrow views, typestate, linear consumption                    |
| `@aponiajs/core`            | Complete | graph, visibility, scopes, container                                             |
| `@aponiajs/platform-elysia` | Complete | routes, validation, enhancers, gateways, versioning                              |
| `@aponiajs/platform-h3`     | Complete | H3 host over the shared kernel                                                   |
| `@aponiajs/platform-hono`   | Complete | Hono host over the shared kernel                                                 |
| `@aponiajs/cli`             | Complete | project and resource generators, library check, MCP                              |
| `@aponiajs/schematics`      | Complete | Nest-shaped collection, schemas, factories, copied templates                     |
| `create-aponia`             | Complete | `bun create aponia` entrypoint                                                   |
| `@aponiajs/testing`         | Complete | test applications, overrides, teardown                                           |
| `@aponiajs/devtools`        | Complete | opt-in page, routes, requests, MCP                                               |
| `@aponiajs/openapi`         | Complete | registered document and validated metadata                                       |
| `@aponiajs/cors`            | Complete | registered policy and validated configuration                                    |
| `@aponiajs/cron`            | Complete | registered scheduler and validated jobs                                          |
| `@aponiajs/graphql`         | Complete | registered endpoint and injected schema factory                                  |
| `@aponiajs/mcp`             | Complete | official SDK endpoint, validated policy, request gate, session lifecycle         |
| `@aponiajs/cache`           | Complete | bounded cache, TTL, store contract                                               |
| `@aponiajs/events`          | Complete | in-process events and listeners                                                  |
| `@aponiajs/http`            | Complete | SSRF-safe client and response validation                                         |
| `@aponiajs/rate-limit`      | Complete | guard, fixed window, shared store contract                                       |
| `@aponiajs/security`        | Complete | headers, CSP nonce, CSRF                                                         |
| `@aponiajs/session`         | Complete | signed sessions and store contract                                               |
| `@aponiajs/auth`            | Complete | JWT, OIDC, refresh rotation, revocation; in-memory stores in tests               |
| `@aponiajs/queue`           | Complete | jobs, retries, dead letters, outbox, durable store contract                      |
| `@aponiajs/database`        | Complete | Drizzle boundary, repositories, SQL migrations; SQLite and live PostgreSQL lanes |
| `@aponiajs/compression`     | Complete | Brotli and gzip negotiation                                                      |
| `@aponiajs/microservices`   | Complete | message patterns, CBOR client/server, nine broker adapters; six live-tested      |
| `@aponiajs/view`            | Complete | Blade layouts, components, props, slots, and shared data                         |
| `@aponiajs/serverless`      | Complete | Web Fetch and AWS Lambda adapters                                                |
| `@aponiajs/nitro`           | Complete | Nitro 3 RC delivery adapter                                                      |
| `@aponiajs/config`          | Complete | `.env` loading, variable expansion, `registerAs`, and schema validation          |
| `@aponiajs/cqrs`            | Complete | `CommandBus`, `QueryBus`, `EventBus`, `@Saga`, and `AggregateRoot`               |
| `@aponiajs/mapped-types`    | Complete | `PartialType`, `PickType`, `OmitType`, and `IntersectionType`                    |
| `@aponiajs/serve-static`    | Complete | `ServeStaticModule` static file and SPA fallback serving                         |
| `@aponiajs/terminus`        | Complete | `TerminusModule`, `HealthCheckService`, HTTP, memory, and disk health indicators |
| `@aponiajs/metrics`         | Complete | Zero-dep Prometheus exposition, HTTP latency histograms, and runtime gauges      |
| `@aponiajs/opentelemetry`   | Complete | `@opentelemetry/api` tracing, W3C `traceparent` propagation, and server spans    |
| `@aponiajs/idempotency`     | Complete | `Idempotency-Key` deduplication, `409` conflict guard, and response replay       |
| `@aponiajs/redis`           | Complete | Distributed Redis stores for cache, rate-limit, session, auth, idempotency, cron |

## Known gaps

- Distributed queue brokers are optional peer adapters: `@aponiajs/microservices`
  ships NATS, MQTT, RabbitMQ, Kafka, Redis Streams, SQS, Pub/Sub, and Service
  Bus transports, and the framework never provisions their topics, queues, or
  subscriptions. A SQLite outbox table ships as `SqliteOutboxStore`; draining it
  into a broker is the application's relay, not the queue's.
- Distributed revocation, refresh, session, rate-limit, cache, idempotency, and
  cron lock stores are provided by `@aponiajs/redis` (opt-in); the built-in
  default stores remain process-local.
- MVC adapters for Express or Fastify are not provided; Elysia is the default
  HTTP platform, and Hono, H3, and Nitro are first-class platforms beside it.
- WebSocket transport extraction is not part of this release: gateways run on
  every platform, through Elysia's native socket and through `hono/bun` or
  `crossws` elsewhere, and Socket.IO namespaces, adapter-managed rooms, and
  acknowledgement callbacks are not emulated on any of them.
- MCP supports the `2024-11-05` through `2025-11-25` handshakes and
  `server/discover`; full `2026-07-28` multi round-trip and cache-hint support
  is not claimed.
- `strictCodegen` remains opt-in rather than the default.
