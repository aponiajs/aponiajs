# Roadmap

This roadmap states the work the project intends to do next, what this line has
already shipped, and what it deliberately will not do. It is a plan, not a
promise: an item ships only when its tests, documentation, and release gates
pass. The per-package state is in [Feature Status](./docs/reference/feature-status.md); what
npm serves today is in [Packages](./docs/reference/packages.md).

## Shipped in the 1.0.0-beta line

- `@All`, `@Header`, `@HttpCode`, `@Ip`, `@HostParam`, and `@Session` on the
  route surface, with an `@All()` path refused when a single-method route also
  claims it.
- `partialSchema`, `pickSchema`, `omitSchema`, and `intersectSchema` for mapped
  DTO models.
- A global route prefix that composes with version negotiation, middleware
  matching, and inspection.
- `ParseEnumPipe`, `ParseArrayPipe`, and `ParseFilePipe`.
- `ModuleRef.create` for a caller that must own its instance, and a `Reflector`
  the boot provides without a module declaring it.
- `aponia dev`, which runs the entrypoint under Bun's watcher.
- Route pipes and middleware whose constructors require dependencies now fail
  the boot instead of being constructed without them.
- Adapter depth for H3 and Nitro, a macOS test lane, and a coverage artifact
  from CI.
- A generated API reference page, a JSDoc reference built by `tools/api-docs`,
  live Redis/Kafka/RabbitMQ/SQS and PostgreSQL lanes, and a benchmark floor in
  the default test lane.
- A devtools page served at `/__devtools/` beside the existing payloads.
- Request-scoped guards, interceptors, and filters resolve inside the request
  they run for, and a request-scoped gateway is bound once per socket.
- `SqliteOutboxStore` gives the transactional outbox a durable home; the
  application owns the database.
- A `grpcTransport` for request/reply and events over a direct gRPC service. It
  hosts the service itself; no broker is provisioned.
- Every manifest declares `engines`; `vp pack` writes each `exports` entry, and
  the declaration it emits sits beside the module so TypeScript resolves it
  without a `types` condition.
- A gateway filter runs on a message failure with a `getType() === "ws"`
  context; the handshake guards see the same transport.
- Governance: a changelog, code of conduct, roadmap, and issue and pull-request
  templates.

## Now — credibility

- Publish the workspace packages and the `1.0.0-beta` line, and keep the
  registry, the package catalog, and the release guards in step. This is blocked
  on npm credentials and trusted-publisher setup, not on code.
- Record a changelog entry for every release and keep the support policy
  current.
- Find one design partner running a real application; the support page says
  plainly that none exists yet.

## Next — the parity that remains

- Enhancer execution on microservice message handlers. Routes and gateways
  already carry the transport-aware context.
- A release-to-release performance regression gate on one machine. The default
  lane now enforces a floor, and the API reference is generated from the public
  snapshot.
- Live Pub/Sub and Service Bus lanes; the other six adapters now have live
  lanes.

## Shipped: independent platforms

- Elysia, Hono, and H3 are independent platforms: each depends only on
  `@aponiajs/common`, `@aponiajs/core`, `@aponiajs/platform-core`, and its own
  runtime peer. `scripts/platform-independence.spec.ts` fails a platform that
  imports or depends on another.
- `@aponiajs/platform-nitro` is retired. Nitro owns its server, so
  `@aponiajs/nitro` is the delivery adapter: boot on `@aponiajs/platform-h3` and
  export the handler it builds.
- One shared conformance contract runs the same behavioral cases on every
  platform in both test lanes
  (`packages/platform-core/tests/support/platform-contract.ts`).
- Header and media-type version negotiation, the gateway payload-limit/schema/
  filter/generator behavior, and the RFC 8187 `downloadFile` encoder are shared
  in `@aponiajs/platform-core`, so every platform answers them the same way.

## Next — cross-platform typed client

- Generate a route map in `aponia build` and ship `@aponiajs/client` with an
  Eden-like `treaty` surface. `@elysia/eden` stays the Elysia-native answer for
  native and declared routes; decorator metadata cannot produce it.

## Shipped: static assets and response policies

- `staticAssets` serves directories on every platform through one shared path
  rule and response shape; the host supplies only the file opener.
- `cors`, `securityHeaders`, `etag`, and `compression` run at one request
  boundary that both `handle` and `listen` use, so a real listener and a native
  application answer alike. A CORS preflight is decided before routing.
- The boot compiles them into one `RequestPipeline`; a host that serves through
  its native fetch runs it too.

## Next — capability adoption

1. Rewrite `@aponiajs/compression`, `@aponiajs/cors`, and `@aponiajs/security`
   as thin wrappers over the shared policies, then drop their
   `platforms: ["elysia"]` declaration.
2. An SSRF-safe proxy built on `@aponiajs/http`.
3. Portable `handle(Request)` coverage on Workers/Deno/Node for Hono and H3.
4. First-party module neutrality: `metrics`, `idempotency`, `session`,
   `opentelemetry`, then `openapi`, `graphql`, `devtools`, `testing`.
5. `@aponiajs/testing` boots any platform adapter.

## Shipped: HTTP platforms beyond Elysia

The Hono, H3, and Nitro entry points are first-class platforms, not only
delivery adapters. `@aponiajs/platform-core` holds the runtime-neutral kernel
the platforms share, and `docs/platforms/platform-parity.md` states the deltas. WebSocket
gateways run on every platform: Hono upgrades through `hono/bun`, H3 through
`crossws` (mounted on the H3 application and on the Bun listener), and Nitro
through the crossws server it runs. A custom host whose runtime states no
gateway support refuses the boot with `UNSUPPORTED_PLATFORM_FEATURE` rather than
mounting a route that never upgrades. The earlier note that these runtimes were
delivery-only is superseded.

## Decisions recorded for 1.0

These items are not in this line, and the reason is a contract decision rather
than a missing patch:

- **Message-transport enhancers stay out for 1.0.** HTTP routes run guards,
  interceptors, and filters; a gateway runs handshake guards and message
  filters; a microservice message handler runs neither, and its failures keep
  the transport's safe failure envelope. Carrying the full enhancer pipeline
  through that contract belongs in a release that can migrate and test every
  transport.

## Later — differentiation

- Publish cold-start and request numbers for descriptor and invoker artifacts.
- Deeper tenancy and audit isolation tests.
- Multi-runtime cold-start comparisons.

## Not planned

These are deliberate decisions, not omissions:

- a Node.js runtime track; the framework targets Bun, and serverless and Fetch
  adapters cover function runtimes;
- `class-validator` or `class-transformer` compatibility; Standard Schema and the
  schema combinators are the validation contract;
- Socket.IO namespaces, rooms, or acknowledgements;
- an Express or Fastify MVC adapter;
- first-class Prisma or TypeORM adapters;
- a queue engine; the queue ships an adapter contract, not a broker.
