# Feature Status

This page records the completeness of each published package and the gaps that
remain outside the current release. A feature is complete only when its package,
public API, Bun tests, Vite+ conformance, documentation, and release manifest all
exist.

| Package                     | Status   | Evidence                                                       |
| --------------------------- | -------- | -------------------------------------------------------------- |
| `@aponiajs/common`          | Complete | decorators, descriptors, tokens, errors, WebSockets            |
| `@aponiajs/core`            | Complete | graph, visibility, scopes, container                           |
| `@aponiajs/platform-elysia` | Complete | routes, validation, enhancers, gateways, versioning            |
| `@aponiajs/cli`             | Complete | project and resource generators, library check, MCP            |
| `create-aponia`             | Complete | `bun create aponia` entrypoint                                 |
| `@aponiajs/testing`         | Complete | test applications, overrides, teardown                         |
| `@aponiajs/devtools`        | Complete | opt-in routes, requests, MCP                                   |
| `@aponiajs/openapi`         | Complete | registered document and validated metadata                     |
| `@aponiajs/cors`            | Complete | registered policy and validated configuration                  |
| `@aponiajs/cron`            | Complete | registered scheduler and validated jobs                        |
| `@aponiajs/graphql`         | Complete | registered endpoint and injected schema factory                |
| `@aponiajs/opentelemetry`   | Complete | registered tracing and application SDK pieces                  |
| `@aponiajs/mcp`             | Complete | protocol versions, discovery, tools, resources, prompts        |
| `@aponiajs/cache`           | Complete | bounded cache, TTL, store contract                             |
| `@aponiajs/events`          | Complete | in-process events and listeners                                |
| `@aponiajs/http`            | Complete | SSRF-safe client and response validation                       |
| `@aponiajs/rate-limit`      | Complete | guard, fixed window, shared store contract                     |
| `@aponiajs/security`        | Complete | headers, CSP nonce, CSRF                                       |
| `@aponiajs/session`         | Complete | signed sessions and store contract                             |
| `@aponiajs/auth`            | Complete | JWT, OIDC, refresh rotation, revocation                        |
| `@aponiajs/audit`           | Complete | bounded audit events and store contract                        |
| `@aponiajs/tenancy`         | Complete | request tenant service and guard                               |
| `@aponiajs/queue`           | Complete | jobs, retries, dead letters, outbox, durable store contract    |
| `@aponiajs/database`        | Complete | Drizzle boundary, repositories, migrations                     |
| `@aponiajs/metrics`         | Complete | Prometheus registry, instrumentation, scrape endpoint          |
| `@aponiajs/idempotency`     | Complete | replay, conflict detection, store contract                     |
| `@aponiajs/compression`     | Complete | Brotli and gzip negotiation                                    |
| `@aponiajs/microservices`   | Complete | message patterns, CBOR client/server, eight broker adapters    |
| `@aponiajs/store-redis`     | Complete | Redis stores for cache, rate-limit, session, idempotency, auth |
| `@aponiajs/view`            | Complete | template rendering engine, @Render decorator, HTML pipeline    |
| `@aponiajs/mvc`             | Complete | Next.js, Nuxt.js, Angular SSR, Express, and Fastify adapters   |
| `@aponiajs/serverless`      | Complete | Web Fetch and AWS Lambda adapters                              |
| `@aponiajs/h3`              | Complete | H3 delivery adapter                                            |
| `@aponiajs/hono`            | Complete | Hono delivery adapter                                          |
| `@aponiajs/nitro`           | Complete | Nitro 3 RC delivery adapter                                    |

## Known gaps

- Distributed queue brokers are optional peer adapters: `@aponiajs/microservices`
  ships NATS, MQTT, RabbitMQ, Kafka, Redis Streams, SQS, Pub/Sub, and Service
  Bus transports, and the framework never provisions their topics, queues, or
  subscriptions. A durable outbox table is not bundled; the queue exposes a
  durable backlog contract instead.
- Distributed revocation, refresh, session, rate-limit, cache, and idempotency
  stores are available via `@aponiajs/store-redis` or application-supplied; the
  built-in default stores remain process-local.
- MVC adapters for Express or Fastify are not provided; Elysia is the HTTP
  platform, with Hono, H3, and Nitro available as delivery adapters.
- WebSocket transport extraction is not provided; WebSockets remain an Elysia
  platform feature.
- MCP supports the `2024-11-05` through `2025-11-25` handshakes and
  `server/discover`; full `2026-07-28` multi round-trip and cache-hint support
  is not claimed.
- `strictCodegen` remains opt-in rather than the default.
