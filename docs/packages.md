# Packages

AponiaJS ships thirty-four packages from this repository. **Six are on npm
today**; the other twenty-eight belong to the unreleased `1.0.0-beta.N` line and
cannot be installed until that line is published. The registry serves the older
`0.6.0-alpha.N` line for the six.

## On npm today

Install with the `@alpha` tag. A tagless install resolves the `latest` tag,
which is the previous stable line rather than this source, so every command
below names the channel.

| Package                     | Registry                                                       | Install                                                     |
| --------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------- |
| `@aponiajs/common`          | [npm](https://www.npmjs.com/package/@aponiajs/common)          | `bun add @aponiajs/common@alpha`                            |
| `@aponiajs/core`            | [npm](https://www.npmjs.com/package/@aponiajs/core)            | `bun add @aponiajs/core@alpha`                              |
| `@aponiajs/platform-elysia` | [npm](https://www.npmjs.com/package/@aponiajs/platform-elysia) | `bun add @aponiajs/platform-elysia@alpha elysia@2.0.0-rc.4` |
| `@aponiajs/cli`             | [npm](https://www.npmjs.com/package/@aponiajs/cli)             | `bun add --global @aponiajs/cli@alpha`                      |
| `create-aponia`             | [npm](https://www.npmjs.com/package/create-aponia)             | `bun create aponia@alpha <name>`                            |
| `@aponiajs/devtools`        | [npm](https://www.npmjs.com/package/@aponiajs/devtools)        | `bun add @aponiajs/devtools@alpha`                          |

`@aponiajs/devtools` currently carries a prerelease under its `latest` tag, so
name `@alpha` explicitly. The other five serve a stable `0.5.0` under `latest`.

## Not on npm yet

These packages exist in this repository and ship with `1.0.0-beta.N`. An install
command naming one of them answers `404` until that line is published.

| Package                   | What it adds                                       |
| ------------------------- | -------------------------------------------------- |
| `@aponiajs/auth`          | JWT, OIDC, refresh rotation, revocation, and RBAC  |
| `@aponiajs/audit`         | Bounded, redacting audit events                    |
| `@aponiajs/cache`         | Bounded TTL cache with a pluggable store           |
| `@aponiajs/compression`   | Brotli and gzip response compression               |
| `@aponiajs/cors`          | Cross-origin policy from validated configuration   |
| `@aponiajs/database`      | Drizzle boundary, repositories, and SQL migrations |
| `@aponiajs/events`        | Typed in-process events with ordered handlers      |
| `@aponiajs/graphql`       | GraphQL endpoint adapter                           |
| `@aponiajs/h3`            | H3 delivery adapter                                |
| `@aponiajs/hono`          | Hono delivery adapter                              |
| `@aponiajs/http`          | SSRF-safe outbound HTTP client                     |
| `@aponiajs/idempotency`   | Idempotent request replay and conflict detection   |
| `@aponiajs/mcp`           | Model Context Protocol server                      |
| `@aponiajs/metrics`       | Prometheus registry and scrape endpoint            |
| `@aponiajs/microservices` | Message patterns and nine broker transports        |
| `@aponiajs/nitro`         | Nitro delivery adapter                             |
| `@aponiajs/openapi`       | OpenAPI document for an application's routes       |
| `@aponiajs/opentelemetry` | OpenTelemetry tracing adapter                      |
| `@aponiajs/queue`         | In-process jobs, retries, dead letters, and outbox |
| `@aponiajs/rate-limit`    | Fixed-window rate limiting guard and store         |
| `@aponiajs/security`      | Security headers and signed CSRF                   |
| `@aponiajs/serverless`    | Web Fetch and AWS Lambda adapters                  |
| `@aponiajs/session`       | Signed session cookies and store                   |
| `@aponiajs/store-redis`   | Redis stores for the published store contracts     |
| `@aponiajs/tenancy`       | Request-scoped tenancy and guard                   |
| `@aponiajs/testing`       | Test application builder and provider overrides    |
| `@aponiajs/view`          | Blade views, components, slots, and shared data    |
| `@aponiajs/cron`          | Scheduled jobs from validated configuration        |

The reserved `aponiajs` facade is private in this workspace and is not
published. Do not install it yet.

## Application packages

A decorated HTTP application normally imports `@aponiajs/common` and
`@aponiajs/platform-elysia`, with Elysia installed as the platform peer:

```bash
bun add @aponiajs/common@alpha @aponiajs/platform-elysia@alpha elysia@2.0.0-rc.4
```

```ts
import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";

@Controller()
class AppController {
  @Get()
  hello(): string {
    return "Hello, AponiaJS!";
  }
}

@Module({ controllers: [AppController] })
class AppModule {}

async function bootstrap(): Promise<void> {
  const application = await AponiaFactory.create(AppModule);
  await application.listen(3000);
}

await bootstrap();
```

Every section below describes a package in this repository. A section for a
package in the second table is documentation of the source, not an install
instruction: its page appears in the documentation site and its README is in the
repository, and it reaches npm only when the beta line publishes.

### `@aponiajs/common`

The platform-neutral public authoring API:

- module, controller, route, injection, and logging contracts;
- `@Module()`, `@Controller()`, `@Validation()`, HTTP method decorators,
  `@Injectable()`, `@Inject()`, and WebSocket gateway decorators;
- provider helpers and explicit injection tokens.

[Package README](../packages/common/README.md) ·
[npm](https://www.npmjs.com/package/@aponiajs/common)

### `@aponiajs/core`

The module graph and dependency injection runtime. Most HTTP applications
receive it transitively through `@aponiajs/platform-elysia`; framework adapters
and standalone container integrations may install it directly.

[Package README](../packages/core/README.md) ·
[npm](https://www.npmjs.com/package/@aponiajs/core)

### `@aponiajs/cache`

Bounded application caching with TTL, a prefixed key space, and a small
pluggable store contract. The default memory store is process-local and capped;
it evicts the oldest insertion. It is not a distributed cache, a session store,
or a durable queue.

[Package README](../packages/cache/README.md)

### `@aponiajs/compression`

Brotli and gzip response compression with a size threshold, `Accept-Encoding`
negotiation, safe skips, and `Vary: Accept-Encoding`.

[Package README](../packages/compression/README.md)

### `@aponiajs/events`

Typed in-process events with ordered awaitable handlers and `@OnEvent()`
listeners. Delivery is local to the process; durable delivery belongs to a queue
or outbox.

[Package README](../packages/events/README.md)

### `@aponiajs/rate-limit`

Fixed-window request limiting with a route guard, per-route overrides, standard
`RateLimit-*` headers, and a bounded pluggable store. The default key is the
route identity, not a client-supplied header; a trusted proxy supplies its own
key function.

[Package README](../packages/rate-limit/README.md)

### `@aponiajs/http`

SSRF-safe outbound HTTP with timeouts, bounded responses, redirect
re-validation, idempotent retries, and Standard Schema response validation.
Private, loopback, link-local, and metadata addresses are blocked by default.

[Package README](../packages/http/README.md)

### `@aponiajs/platform-elysia`

The Elysia adapter, application lifecycle, decorated route mapper, native
WebSocket gateway runtime, and native plugin escape hatch.
`AponiaFactory.createNative` exposes a statically composed module as the exact
Elysia application type for native tooling and Eden Treaty. `elysia` is a peer
dependency and must be installed by the application.

[Package README](../packages/platform-elysia/README.md) ·
[Eden Treaty](./eden-treaty.md) ·
[WebSockets](./websockets.md) ·
[npm](https://www.npmjs.com/package/@aponiajs/platform-elysia)

### `@aponiajs/cron`

Declare scheduled jobs in a module, with the jobs read from a validated
configuration. The package is an adapter over
[`@elysia/cron`](https://www.npmjs.com/package/@elysia/cron), which wraps
[croner](https://github.com/hexagon/croner): AponiaJS contributes a module a
registration belongs in and a configuration the jobs are validated through, and
no scheduling engine of its own. It has no persistence, no retries, no
cross-process coordination, and no distributed lock — a cron expression in one
process runs in that process.

[Package README](../packages/cron/README.md) ·
[Authoring a plugin package](./plugin-packages.md)

### `@aponiajs/cors`

Answer cross-origin requests for an application's routes, with the policy read
from a validated configuration. The package is an adapter over
[`@elysia/cors`](https://www.npmjs.com/package/@elysia/cors): AponiaJS
contributes a module a registration belongs in and a configuration the origins,
methods, headers, and credentials are validated through, and no CORS
implementation of its own. It is the smallest package in the set — a literal
policy needs no package at all — and it carries one boundary worth stating: an
origin that is a `RegExp` or a function is code rather than data, so it is not
expressible through a configuration and belongs with the raw plugin.

[Package README](../packages/cors/README.md) ·
[Authoring a plugin package](./plugin-packages.md)

### `@aponiajs/graphql`

Serve a GraphQL endpoint for an application's queries, with the mount path read
from a validated configuration. The package is an adapter over
[`@elysia/graphql-yoga`](https://www.npmjs.com/package/@elysia/graphql-yoga),
which wraps Yoga: AponiaJS contributes a module the plugin is declared in and a
configuration the path is validated through, and no schema of its own. The
schema is the application's — `typeDefs` plus `resolvers`, or a prebuilt
`GraphQLSchema` — returned from an injected factory so resolvers close over
providers. The module sets both the plugin's `path` and yoga's `graphqlEndpoint`
from the one declared value, which is what makes a non-default endpoint answer
instead of returning `404`.

[Package README](../packages/graphql/README.md) ·
[Authoring a plugin package](./plugin-packages.md)

### `@aponiajs/testing`

Boot an application for a test with `createTestApplication`, replace one provider
for one boot, and tear the boot down without leaking a listener. It adds no test
runner and no mocking framework: every `test` and `expect` stays the runner's, and
`overrideProvider` replaces a provider's descriptor in the compiled module graph
rather than intercepting modules. A token no module in the graph provides is
refused at build time with `MISSING_PROVIDER`, and asserting a request needs no
socket — `application.handle(new Request(...))` reaches the real route table. The
one real port it can bind exists for the WebSocket case that needs one.

[Package README](../packages/testing/README.md) ·
[Testing applications](./testing.md)

### `@aponiajs/openapi`

Serve an OpenAPI document for an application's own routes, with the document's
`title`, `version`, and `description` read from a validated configuration. The
package is an adapter over
[`@elysia/openapi`](https://www.npmjs.com/package/@elysia/openapi), which builds
the document from the route table Elysia compiled: AponiaJS contributes a module
the plugin is declared in and a configuration the metadata is validated through,
and no generator of its own. The document describes the routes; it does not
validate requests, generate clients, or serve any interface but the wrapped
plugin's.

[Package README](../packages/openapi/README.md) ·
[OpenAPI](./openapi.md)

### `@aponiajs/devtools`

The opt-in devtools surface for a running application: an HTTP API mounted on the
application's own route table under `/__devtools`, on the address the application
already answers, that reports the compiled graph,
the routes the application answers, the stages each route passes through, the log
stream, the requests that reached the record and what answered them, and
what a build decided about the project's invokers. It is a leaf package — nothing
in the framework depends on it — and it is enabled by an application's own
registration, never by an environment variable the framework reads to decide.
An application that declares its configuration does read one, through
`provideConfiguration`; that read is the application's, not the framework's.

[Package README](../packages/devtools/README.md) ·
[Devtools guide](./devtools.md) ·
[npm](https://www.npmjs.com/package/@aponiajs/devtools)

### `@aponiajs/opentelemetry`

Trace an application's routes with OpenTelemetry, with the policy read from a
validated configuration. The package is an adapter over
[`@elysia/opentelemetry`](https://www.npmjs.com/package/@elysia/opentelemetry):
AponiaJS contributes a module the plugin is declared in and a configuration the
service name, body recording, header capture, and URL redaction are validated
through, and no tracing backend of its own. **It ships no exporter and no
instrumentation** — the span processors, the exporters, and the instrumentations
are the application's, passed to `register` because they are live objects a
configuration cannot carry. Its sharpest limit is the wrapped plugin's: the
plugin's `NodeSDK` is process-global, so the first registration in a process owns
it and every later one is inert, and `application.close()` does not stop it.

[Package README](../packages/opentelemetry/README.md) ·
[Authoring a plugin package](./plugin-packages.md)

### `@aponiajs/mcp`

Model Context Protocol server with handshake version negotiation and
`server/discover`, a tool registry, structured tool output, and stateless HTTP
transports for AI agent integrations and developer toolchains.

[Package README](../packages/mcp/README.md) ·
[MCP guide](./mcp.md)

### `@aponiajs/security`

Conservative response headers by default and opt-in signed double-submit CSRF
protection for cookie-based routes. The CSRF cookie is readable by the
application's own client; every unsafe request must echo the signed token in the
configured header.

[Package README](../packages/security/README.md)

### `@aponiajs/session`

Signed session cookies, a request-scoped `SessionService`, and a bounded
pluggable store. The cookie carries a signed id, never session data, and is
`HttpOnly`.

[Package README](../packages/session/README.md)

### `@aponiajs/auth`

Bearer JWT authentication, OpenID Connect discovery, role and permission
guards, request-scoped current user, refresh-token rotation, access-token
revocation, and Bun-native password hashing. A registration states a local JWT
secret or an OIDC issuer; the package mounts no route, and its built-in refresh
and revocation stores are bounded and process-local.

[Package README](../packages/auth/README.md) ·
[Authentication guide](./auth.md)

### `@aponiajs/audit`

Bounded, redacting audit events with an injectable service and a pluggable
store. The default memory store is process-local and capped.

[Package README](../packages/audit/README.md) ·
[Audit guide](./audit.md)

### `@aponiajs/tenancy`

Request-scoped tenant resolution with a guard, a request tenant service, safe
identifier validation, and an explicit required/optional policy.

[Package README](../packages/tenancy/README.md) ·
[Tenancy guide](./tenancy.md)

### `@aponiajs/queue`

An in-process job queue with bounded retries, exponential backoff, a dead
letter queue, and idempotent enqueue, plus a transactional outbox that records
messages and delivers them after the transaction. Both stores are
process-local; a broker and a durable outbox table are needed beyond one
instance.

[Package README](../packages/queue/README.md) ·
[Jobs and outbox guide](./queues.md)

### `@aponiajs/database`

A Drizzle-first database boundary. The application constructs its Drizzle
database; the module owns the transaction boundary, a typed repository over one
table, and ordered SQL migrations the service applies during initialization.
The package builds no pool and picks no dialect.

[Package README](../packages/database/README.md) ·
[Database guide](./database.md)

### `@aponiajs/metrics`

A bounded Prometheus registry with a scrape endpoint on the application's own route table and request instrumentation for every route it mounts.
The package chooses no exporter; a scrape reads the rendered text.

[Package README](../packages/metrics/README.md) ·
[Metrics guide](./metrics.md)

### `@aponiajs/idempotency`

Idempotent replay for mutating requests. A request with an `Idempotency-Key`
records its `2xx` answer, a repeat with the same key and body answers the
recorded status and body without reaching the handler, and a key reused with a
different body is refused with `409`. The store is pluggable; the default is
bounded and process-local.

[Package README](../packages/idempotency/README.md)

### `@aponiajs/microservices`

Message-pattern handlers and transports. `@MessagePattern()` answers a
request/response call, `@EventPattern()` observes fire-and-forget events, and
`AponiaFactory.create` starts every configured transport after the graph is
initialized. The package ships a CBOR v1 client and server runtime, an in-memory
reference transport, and optional broker adapters for NATS, MQTT, RabbitMQ,
Kafka, Redis Streams, SQS, Pub/Sub, and Service Bus. Each broker SDK is an
optional peer installed only by the services that use it.

[Package README](../packages/microservices/README.md) ·
[Microservices guide](./microservices.md)

### `@aponiajs/store-redis`

Redis-backed distributed storage adapters. Implements official store contracts
for `@aponiajs/cache` (`CacheStore`), `@aponiajs/rate-limit` (`RateLimitStore`),
`@aponiajs/session` (`SessionStore`), `@aponiajs/idempotency` (`IdempotencyStore`),
and `@aponiajs/auth` (`RevocationStore`, `RefreshTokenStore`).

[Package README](../packages/store-redis/README.md)

### `@aponiajs/view`

Laravel-style Blade template rendering with layouts, sections, includes,
components, slots, prop binding, shared view data, and dot-notation lookup.

[Package README](../packages/view/README.md)

### `@aponiajs/serverless`

Adapters for function and edge runtimes. `toFetchHandler` binds the application
as a Web Fetch handler for a worker runtime, and `createLambdaHandler` answers
AWS Lambda API Gateway proxy events in both payload versions, translating
headers, cookies, query strings, and base64 bodies.

[Package README](../packages/serverless/README.md) ·
[Deployment guide](./deployment.md)

### `@aponiajs/h3`, `@aponiajs/hono`, `@aponiajs/nitro`

Delivery adapters that mount an Aponia application inside H3, Hono, or Nitro.
Each forwards the runtime request to `application.handle`, so the compiled
container, routes, guards, validation, and filters stay in charge. Nitro support
is experimental while its current release is an RC.

[Adapters guide](./adapters.md) · [Deployment guide](./deployment.md)

## Project creation and CLI

Install the published CLI globally with Bun and invoke its `aponia` binary
directly:

```bash
bun add --global @aponiajs/cli@alpha
aponia new my-api
aponia --version
```

The global CLI and the separately published `create-aponia` entrypoint call the
same project generator. See the
[complete CLI guide](./cli.md), the
[`@aponiajs/cli` npm page](https://www.npmjs.com/package/@aponiajs/cli), and the
[`create-aponia` npm page](https://www.npmjs.com/package/create-aponia).

## Synchronized versions

All thirty-four packages share one
[Semantic Version](https://semver.org), and a release publishes them together.
Avoid mixing AponiaJS package versions within one application. See
[Releasing npm Packages](./releasing.md) for the version gate and publication
flow.
