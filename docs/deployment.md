# Deploying an AponiaJS Application

An AponiaJS application is a Bun process that answers through Elysia, or a
handler that a serverless runtime mounts. The framework decides how a request
becomes a response; the deployment decides how many instances exist, where state
lives, and how traffic is drained. This page states the contract between those
two.

## The deployment contract

- **Boot is atomic.** Every boot step an application declares — its migrations,
  configuration validation, module initialization, route mounting, gateway
  registration, and application bootstrap — finishes before the port opens. A
  failure rejects `AponiaFactory.create`; the process exits non-zero instead of
  serving a half-configured application.
- **A request is answered by the compiled route table.** A listening process
  and a serverless handler run the same `application.handle`. Guards,
  validation, filters, and Problem Details mapping are not reimplemented by the
  deployment.
- **Built-in stores are process-local.** Each replica has its own sessions,
  rate-limit counters, refresh tokens, revocations, cache, idempotency records,
  queue, and outbox unless the application supplies a shared store. The state
  matrix below names every one.
- **Shutdown is observable.** Readiness flips to `503` before the server stops,
  so a load balancer stops routing before connections are cut.

## Reference boot

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule, {
  logger: ["error", "warn", "log"],
  health: true,
});

await application.listen(Number(Bun.env.PORT ?? 3000), {
  shutdownSignals: true,
});
```

`shutdownSignals` is opt-in because it takes ownership of the process's
`SIGTERM` and `SIGINT`. When enabled, one signal runs the full teardown and
then re-raises the signal so the exit status stays the signal's own. A second
signal reaches the default action and stops the process immediately, which is
the escape hatch for a teardown that never returns.

An application that never listens — a worker or a test — still gets a complete
teardown from `application.close()`.

## Topology

| Shape                     | Use it when                                            | Requirements                                                                                     |
| ------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Single process            | One replica, or a worker with no shared state          | Built-in stores are sufficient; still expose both probes for a supervisor                        |
| Multiple replicas         | Horizontal scale behind a load balancer                | Shared stores for every stateful capability, or routing that keeps a client on one replica       |
| Serverless handler        | A platform invokes one function per request            | No listening server and no shutdown signals; state is per instance unless a shared store is used |
| Message worker            | A process consumes microservice patterns or queue jobs | Connect transports after bootstrap; drain consumers before the process exits                     |
| WebSocket-capable process | Native Elysia sockets are part of the contract         | Sticky routing or an external publish/subscribe layer; rooms and namespaces are not emulated     |

The same image can serve several of these shapes when configuration selects the
mode, but a shape that needs shared state must not silently fall back to the
in-memory default. Make the store choice explicit at registration.

## State ownership

This table is the operational consequence of each package's default store. A
row that names a process-local default needs a shared implementation, a broker,
or single-replica routing before it is correct under horizontal scale.

| Capability                  | Built-in default                      | Multi-instance requirement                                                                              |
| --------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Session                     | `MemorySessionStore` (process)        | A shared session store, or sticky routing while the session lives                                       |
| Rate limit                  | `MemoryRateLimitStore` (process)      | A shared counter store; otherwise each replica allows the full limit                                    |
| Cache                       | In-memory bounded store (process)     | A shared cache when a cached value must be visible to every replica                                     |
| Idempotency                 | `MemoryIdempotencyStore` (process)    | A shared store implementing atomic `claim`/`release`; otherwise a replay can execute on another replica |
| Auth refresh and revocation | In-memory stores (process)            | Shared stores; otherwise a rotated token or revoked token is accepted elsewhere                         |
| Queue and outbox            | In-process queue and outbox (process) | A durable broker or database-backed backlog; in-flight jobs do not survive a restart                    |
| Audit events                | Bounded in-memory store (process)     | A shared or durable store when retention is a compliance requirement                                    |
| Metrics                     | Prometheus registry per process       | Scrape every replica, or aggregate at the collector; a series is not cluster-wide                       |
| Request context             | `AsyncLocalStorage` per process       | No sharing needed; correlation is per request and per process                                           |
| Devtools                    | In-process capture                    | Development only; do not expose it as a production dependency                                           |

## Configuration and secrets

Configuration is validated once during boot and injected as a value. The
process environment is the default source; a registration may replace it with a
literal `source` for a test, or with an asynchronous factory that loads from a
secret manager before the application starts.

- Precedence is explicit: a declared `source` replaces the process
  environment. There is no implicit merge and no per-request reload.
- The validated value is immutable for the process lifetime. Rotate a secret by
  deploying with the new value; do not expect a live provider to reread it.
- A schema failure is `INVALID_CONFIGURATION_VALUE` and names every issue. A
  declaration that is not a Standard Schema is `INVALID_CONFIGURATION` with
  `reason: "not-a-standard-schema"`.
- Inject secrets from the platform's secret store into the environment. Do not
  commit a secret, bake it into an image, or print a configuration record. The
  logger is not a redaction layer.
- Keep one configuration token per bounded context. A module that exports its
  configuration token makes the value visible to importers; one that does not
  keeps it private.

See [Configuration](./configuration.md) for the declaration and visibility
rules.

## Health and readiness

`health: true` mounts two ordinary routes with no hook, guard, interceptor, or
filter:

| Probe     | Default path        | Status                                  | Body                                             |
| --------- | ------------------- | --------------------------------------- | ------------------------------------------------ |
| Liveness  | `GET /health/live`  | `200` while the process answers         | `{ "status": "pass" }`                           |
| Readiness | `GET /health/ready` | `200` until shutdown begins, then `503` | `{ "status": "pass" }` or `{ "status": "fail" }` |

Both answer `application/health+json`. Pass `{ livenessPath, readinessPath }`
to rename them. The paths mount outside the module graph, so they do not appear
in inspection output or generated artifacts; a controller that already claims
one fails the boot with `DUPLICATE_ROUTE`.

The built-in readiness signal is the application's own start and shutdown, not a
database ping. A dependency-aware check belongs in an application route that the
orchestrator polls by path. Do not place an authentication guard in front of a
probe: a probe that cannot authenticate reports every replica unhealthy at once.

## Graceful shutdown

`application.close()` performs the same sequence whether a signal or an
operator calls it:

1. Readiness reports `fail`.
2. The server stops accepting connections and drains active requests.
3. `beforeApplicationShutdown` runs on every hooked provider, then the server
   stop completes.
4. `onModuleDestroy` runs in reverse module order.
5. `onApplicationShutdown` runs on every hooked provider.

Set the platform's termination grace period longer than the slowest expected
request plus the teardown hooks. A hook that never settles blocks the process; a
second signal is the operator's hard stop. Teardown failures are reported
through the system logger and do not prevent the remaining hooks from running.

## Observability baseline

| Signal      | Provided by                                                     | Operational note                                                                |
| ----------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Logs        | The system logger, bootstrap decisions, and the `500` path      | Include the request ID; do not log credentials, cookies, or raw bodies          |
| Correlation | `@aponiajs/request-context`, header `x-request-id` by default   | The ID is read or generated per request and echoed unless `echo: false`         |
| Metrics     | `@aponiajs/metrics`, Prometheus text at the scrape path         | Scrape every replica; route labels are bounded by the registered route pattern  |
| Traces      | `@aponiajs/opentelemetry` when the application supplies the SDK | The SDK is process-global; the first registration in a process owns it          |
| Audit       | `@aponiajs/audit` with a bounded, redacting store               | Record security and business events; retention is an application store decision |
| Devtools    | `@aponiajs/devtools`                                            | Opt-in and development-facing; it is not a production telemetry backend         |

Emit one structured log line per failed request at minimum, carrying the request
ID, method, route pattern, status, and latency. Do not put a user identifier or
tenant identifier in a log line unless the application's data policy allows it.

## Failure modes

| Symptom                                      | Likely cause                                                                 | First action                                                                                     |
| -------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Process exits during boot                    | Configuration, provider, or route validation failed                          | Read the `AponiaError` code and details; the port never opened, so this is not a traffic failure |
| Readiness stays `503` after a deploy         | Shutdown began, or the application never completed bootstrap                 | Check the boot log and whether a stop signal arrived                                             |
| Sessions or logins disappear across replicas | The default session store is process-local                                   | Register a shared session store or make routing sticky                                           |
| Rate limits reset on every request           | Each replica owns its counter                                                | Use a shared rate-limit store                                                                    |
| An idempotent request executes twice         | The replay record lives on another replica, or the store has no atomic claim | Use a shared idempotency store with atomic `claim`/`release`, and a caller/tenant `scope`        |
| Queue jobs vanish after a restart            | The in-process queue is not durable                                          | Use a durable backlog or broker, or accept the loss explicitly                                   |
| Metrics look incomplete                      | Only one replica is scraped                                                  | Scrape every instance or aggregate in the collector                                              |
| WebSocket clients reconnect repeatedly       | A replica restarted or does not own the socket                               | Use sticky routing or an external publish/subscribe layer                                        |
| Every request returns `500` with no detail   | An unhandled exception reached the default Problem Details mapping           | Correlate the request ID with the logger; the response deliberately omits the stack and cause    |

## Rollout checklist

- Validate the configuration in the target environment before enabling traffic.
- Confirm the readiness and liveness paths match the orchestrator's probes.
- Enable `shutdownSignals` and set a termination grace period above the drain
  time.
- Choose a shared store for every stateful row that matters at the target
  replica count.
- Run migrations before the new version serves traffic, and keep the previous
  schema compatible through the rollout.
- Scrape every replica; verify the route labels are the bounded patterns, not
  raw paths.
- Confirm audit retention and access policy if the application records security
  events.
- Smoke-test a real route, not only the probes.
- Roll back by restoring the previous image and configuration pair; do not roll
  back a schema change without a reverse migration.

## Serverless and delivery adapters

`@aponiajs/serverless` adapts the same application to a Web Fetch runtime or
to AWS Lambda's API Gateway proxy events. The function answers one request and
holds no listening server, so graceful shutdown belongs to the platform and the
health probes are not the invocation contract.

Hono, H3, and Nitro are delivery adapters through
[`@aponiajs/hono`, `@aponiajs/h3`, and `@aponiajs/nitro`](./adapters.md).
They mount the same `application.handle` inside the runtime instead of
reimplementing the Aponia route table. Nitro support is experimental while its
current release is an RC.

## A reference deployment

`examples/reference` composes the framework the way this page describes: a
validated configuration, a Drizzle database with a boot migration, JWT login
with role guards, a queued audit job, `GET /metrics`, and both health probes.
Read it beside this page when wiring a real service.
