# Deployment

An AponiaJS application is a Bun process that answers through Elysia. This page
records the operational pieces the framework already provides and the choices a
deployment still owns.

## Process

```ts
const application = await AponiaFactory.create(AppModule, {
  logger: ["error", "warn", "log"],
  health: true,
});
await application.listen(Number(process.env.PORT ?? 3000));
```

The bootstrap finishes migrations, module initialization, route mounting,
gateways, and application bootstrap before the port opens. A failure in any of
those steps rejects the boot, so the process exits non-zero instead of serving a
half-configured application.

`health: true` mounts the conventional pair: `GET /health/live` answers while
the process is alive, and `GET /health/ready` answers after bootstrap and stops
answering while shutdown runs. Pass an object to rename either path or replace
the readiness source.

## Shutdown

`close()` runs `beforeApplicationShutdown`, stops the server, then runs
`onModuleDestroy` and `onApplicationShutdown` in reverse module order. Connect
it to the platform signals so a rolling deploy drains instead of cutting
requests:

```ts
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void application.close().finally(() => process.exit(0));
  });
}
```

Readiness flips before the drain starts, which is what makes a load balancer
stop sending new requests while in-flight work finishes.

## Configuration

Every package that reads configuration validates it once at boot and fails with
`INVALID_CONFIGURATION_VALUE` rather than at the first request. Secrets stay in
the environment; no package reads one on its own. Inject the parsed value into
the providers that need it.

## State

The built-in stores are process-local: sessions, rate limits, refresh tokens,
revocations, and the job queue. A deployment with more than one instance needs a
shared store or broker for each of them. The contracts accept custom stores, so
the choice is an application decision rather than a framework one.

## Observability

`@aponiajs/opentelemetry` records spans for the application's routes when the
application supplies the SDK, processors, and exporters; the SDK is
process-global, so the first registration in a process owns it. `@aponiajs/audit`
records security and business events through a bounded, redacting store. The
system logger reports bootstrap decisions and the failure path that produced a
`500`.

## A reference deployment

`examples/reference` composes the framework the way this page describes: a
validated configuration, a Drizzle database with a boot migration, JWT login
with role guards, a queued audit job, `GET /metrics`, and both health probes.
Read it beside this page when wiring a real service.

## Deployment shapes

A single container binds the configured port and exposes `/health/live` and
`/health/ready`. A platform that routes by path or host deploys the same binary
per route. `@aponiajs/serverless` adapts the same application to a Web Fetch
runtime or to AWS Lambda's API Gateway proxy events, where the function answers
one request and holds no listening server; graceful shutdown then belongs to
the platform, not the process. `@aponiajs/microservices` connects message
transports after the graph is initialized for a worker that also consumes
messages.
