# Aponia Framework: Architecture Blueprint and Roadmap

Status: Draft for implementation  
Objective: Build a NestJS-inspired backend framework on Bun and Elysia while
preserving Elysia's type inference, performance, lifecycle, and plugin model.

## 1. Product thesis

Aponia must not be a NestJS port and must not hide Elysia. It should be an
architecture layer that adds:

- Predictable application organization through modules, controllers, and providers.
- A dependency injection graph that is validated before the server starts.
- Explicit request lifecycle contracts that compile to native Elysia phases.
- Secure defaults, observability, testing utilities, and a productive CLI.
- Escape hatches for native Elysia instances, contexts, and plugins.
- Bun as the runtime, package manager, test runner, and workspace manager.
- Vite+ for packaging, builds, formatting, linting, and type checking.

The central rule is that Aponia compiles descriptors into Elysia plugins and
hooks. It must not create a second router or HTTP server abstraction.

## 2. Version 1 non-goals

- Node.js is not a primary runtime target.
- NestJS drop-in API compatibility is not a goal.
- Decorators and `reflect-metadata` are not required by the core.
- Aponia will not create a new ORM, broker, authentication provider, or schema language.
- GraphQL, microservices, and CQRS remain deferred until the HTTP core is stable.
- Compatibility with every Elysia plugin is not guaranteed without lifecycle,
  scope, and type conformance tests.

## 3. Architectural decisions

### 3.1 Functional-first API

The core API starts with typed functions and explicit dependency descriptors:

```ts
const USERS_REPOSITORY = token<UsersRepository>("users.repository");

const UsersModule = defineModule({
  providers: [
    provideClass(UsersService, {
      deps: [USERS_REPOSITORY],
    }),
  ],
  controllers: [UsersController],
  exports: [UsersService],
});
```

An optional decorator package may later provide `@Module()`, `@Controller()`,
and `@Injectable()`. Decorators must emit the same immutable descriptors as the
functional API. Runtime reflection scans are prohibited.

### 3.2 Compile once, execute lean

Bootstrap has two stages:

1. Compile stage: validate the module graph, resolve tokens, normalize routes,
   compose lifecycle rules, and produce an Elysia plugin tree.
2. Runtime stage: execute precompiled Elysia hooks and handlers without
   rescanning metadata or searching the container for every request.

### 3.3 Elysia remains the platform

- Routes and schemas use Elysia and `t` as native representations.
- Validation and transformations map to Elysia validation and transform phases.
- Authentication and authorization map to validated `resolve` and `beforeHandle` phases.
- Response transformation maps to `afterHandle` and `mapResponse`.
- Error handling maps to `onError`.
- Cleanup, metrics, and audit logging map to `afterResponse`.
- Module instances compile to named Elysia plugins with explicit instance identity.
- Local, scoped, and global lifecycle behavior must have a conformance matrix.
- Users can compose native Elysia plugins without writing custom adapters.

### 3.4 Explicit dependency injection boundaries

- Tokens support classes, symbols, and typed token objects. Raw strings are discouraged.
- Providers support `useClass`, `useValue`, `useFactory`, and `useExisting`.
- Class and factory dependencies must be declared through explicit `deps`.
- Optional providers, multi-providers, token variance, duplicates, and
  cross-scope aliasing require documented semantics before implementation.
- Singleton is the default scope. Request and transient scopes are opt-in.
- Request scope is owned by the native request context.
- Async providers resolve before listening and support timeout and cancellation.
- Providers dispose in reverse topological order.
- The graph rejects missing, duplicate, invisible, and circular dependencies
  with actionable dependency paths.
- Business code must not use a service locator such as `container.get()`.
- Dynamic module identity is separate from Elysia plugin names and configuration.

## 4. Proposed Bun workspace

```text
aponiajs/
|-- apps/
|   |-- examples-basic/
|   `-- examples-auth/
|-- packages/
|   |-- common/
|   |-- core/
|   |-- platform-elysia/
|   |-- validation/
|   |-- config/
|   |-- security/
|   |-- observability/
|   |-- openapi/
|   |-- testing/
|   |-- decorators/
|   |-- cli/
|   `-- create-aponia/
|-- plans/
|-- package.json
|-- bun.lock
`-- vite.config.ts
```

The root `workspaces` field must include both `packages/*` and `apps/*`.
Internal dependencies use `workspace:*`. Bun catalogs manage lockstep versions.
Root scripts use `bun run --filter` or `bun run --workspaces`.

## 5. Public programming model

### Application

- `createApplication({ rootModule, adapter, logger })`
- `app.init()`, `app.listen()`, and `app.close()`
- `onModuleInit`, `onApplicationBootstrap`, `onApplicationShutdown`, and
  `beforeApplicationShutdown`
- Graceful stop, drain, and timeout results.
- The CLI or host runner owns operating-system signals and forced termination.
  The framework library never installs hidden signal handlers or exits the process.

### Modules and providers

- Static modules and explicitly keyed dynamic modules.
- Imports, providers, controllers, and exports.
- Global modules require explicit declaration and restricted use.
- Provider overrides for tests.
- Graph inspection for the CLI and future developer tools.

### HTTP

- Controllers, route groups, prefixes, and versioning.
- Typed params, query, headers, cookies, body, and status-specific responses.
- Native request hooks for transport concerns.
- Authentication and authorization policies after input validation.
- Validation and transformation contracts.
- Phase-specific response mapping and cleanup hooks.
- RFC 9457 Problem Details.
- Uploads, streaming, SSE, and WebSockets as separate capabilities.

### Escape hatches

- `useElysia(plugin)`
- Typed native Elysia request context access.
- Raw `fetch(request): Response` mounts.
- Lifecycle compiler extensions.

Each escape hatch is classified as:

- Managed: retains DI, security, errors, observability, and shutdown guarantees.
- Isolated: runs separately with only explicitly documented guarantees.
- Unsafe: bypasses framework guarantees and emits an explicit diagnostic.

### Type preservation contract

The primary API uses persistent generic builders and descriptors. Every `.use()`
or route registration returns a widened application type. Package boundaries
must not erase types to `Elysia<any>` or unstructured `unknown`. Plugins that add
context must be composed before their consumers.

```ts
const auth = definePlugin(new Elysia().derive(() => ({ userId: "u1" })));

const users = defineController("/users")
  .use(auth)
  .get("/:id", ({ params, userId }) => ({ id: params.id, viewer: userId }), {
    params: t.Object({ id: t.String() }),
    response: {
      200: t.Object({ id: t.String(), viewer: t.String() }),
      404: ProblemSchema,
    },
  });
```

Acceptance requires positive and negative compile tests for request inputs,
status-specific responses, plugin-derived context, errors, controller
extraction, generated declarations, and Eden Treaty compatibility. Exported
`any` is prohibited as a workaround.

## 6. Required lifecycle contract

Aponia follows Elysia's real phases:

| Boundary or phase               | Aponia responsibility                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Reverse proxy and Bun admission | TLS, connection limits, concurrency, slow-client timeout, compressed-byte limits, trusted proxy, and host policy |
| `request`                       | Request ID, trace extraction, and early header or URL policies using `PreContext` only                           |
| `parse`                         | Parser selection, decompressed-size limits, body limits, multipart limits, and cleanup                           |
| `transform`                     | Coercion required before schema validation                                                                       |
| Elysia validation               | Params, query, headers, cookies, and body validation                                                             |
| `resolve` and `beforeHandle`    | Authentication from validated input, authorization, and request-scoped provider resolution                       |
| Handler                         | Controller and provider business logic                                                                           |
| `afterHandle`                   | Typed post-handler transformation before the final `Response`                                                    |
| `mapResponse`                   | Status, headers, serialization, and response security headers                                                    |
| `afterResponse`                 | Audit, metrics, and cleanup without response mutation                                                            |
| `onError`                       | Safe Problem Details mapping for errors routed through Elysia's error path                                       |

CORS preflight and response security headers follow official plugin semantics.
They are not modeled as a generic pre-handler middleware layer.

The conformance suite covers:

- Thrown errors.
- Returned values that short-circuit handlers.
- Native `Response` values.
- Streaming and client aborts.
- Failures during parse, validation, authentication, handlers, serialization,
  and cleanup.
- Local, scoped, and global lifecycle behavior.
- Diamond imports, configured module instances, and hot reload.

Registration order must not silently change documented behavior.

## 7. Security baseline

- Validate every external input and bound body, header, URL, upload, and nesting sizes.
- Limit connections, concurrency, slow clients, compressed and decompressed
  sizes, multipart parts, and temporary-file lifetime.
- Validate response schemas in development and tests, with an optional production mode.
- Use explicit CORS origin allowlists. Never combine credentialed CORS with wildcard origins.
- Validate host and forwarded-host values. Define safe `Cache-Control` and `Vary` policies.
- Provide secure cookie presets and CSRF protection for cookie-authenticated mutations.
- Pin JWT algorithms and validate issuer, audience, and time claims.
- Remote JWKS requires HTTPS allowlists, timeout, cache bounds, rotation,
  unknown-key behavior, and stampede protection.
- Use Bun password APIs with a policy-upgrade path.
- Separate authentication from default-deny authorization.
- Provide an in-memory development limiter and an atomic distributed-store contract.
- Rate-limit keys are derived after trusted-proxy resolution, have bounded
  cardinality, and define outage and `Retry-After` behavior.
- Trusted proxy count or CIDR configuration is explicit.
- Production errors never expose stack traces, SQL, secrets, or internal paths.
- Structured logs redact authorization, cookies, tokens, passwords, secrets, and PII.
- Configuration dumps never include secret values.
- Provide SSRF-safe outbound request guidance, path-safe storage utilities, and safe redirects.
- CI produces frozen installs, dependency audits, SBOMs, provenance, and signed releases.
- Security regression tests cover OWASP API risks, prototype pollution,
  malformed input, request smuggling assumptions, ReDoS, decompression bombs,
  multipart cleanup, WebSocket origin checks, streaming aborts, backpressure,
  and resource exhaustion.

A threat model must assign ownership across the proxy, Bun server, Elysia,
Aponia, and application boundaries from Step 0.

## 8. Observability and operations

- Structured logger abstraction with a Bun implementation.
- Request and trace ID propagation.
- OpenTelemetry through the official Elysia plugin.
- Request rate, error rate, and duration metrics.
- Module graph compile time and provider initialization metrics.
- `/health/live`, `/health/ready`, and `/health/startup`.
- Readiness changes before graceful draining starts.
- Error taxonomy for operational, programmer, validation, authentication,
  authorization, and dependency failures.
- `aponia doctor` diagnostics.

## 9. Testing strategy

- Bun test is the canonical test runner.
- Unit tests cover the DI graph and lifecycle compiler.
- Contract tests compare documented Aponia semantics with native Elysia behavior.
- Integration tests use `app.handle(new Request(...))` without opening a port.
- The testing package supports module, provider, and phase-hook overrides.
- Fuzz and property tests cover graph compilation and parsers.
- The compatibility matrix covers current and previous Bun stable releases and
  a pinned Elysia version range.

### Tool ownership and mandatory verification

- Bun owns runtime execution, package management, workspace orchestration,
  application execution, and canonical tests.
- Vite+ owns library packaging, application builds, formatting, linting, type
  checking, and the task graph.
- The policy is "Bun-first runtime ownership while retaining Vite+." It does not
  claim literal 100% Bun execution because Vite+ may use managed tooling internally.

Every pull request runs:

```bash
vp install --frozen-lockfile
vp check
bun test
vp test
bun run build
```

`vp test` remains a small Vite+ conformance lane. Bun test owns the main DI,
HTTP, integration, and security suites. Libraries use `vp pack`; applications
use `vp build`.

## 10. Delivery roadmap

One step equals one reviewable pull request. Split a step before implementation
if its task list no longer fits its exit criteria.

### Step 0: Walking skeleton, contracts, and threat boundaries

Dependencies: None  
Context: Prove one vertical slice before extracting abstractions.

Tasks:

- Create one Bun workspace app, one raw Elysia route, and one explicit value provider.
- Record ADRs for lifecycle phases, typed descriptors, DI ownership, and tool ownership.
- Document the proxy-to-application threat boundary.

Verify: Baseline test, check, and build commands.
Exit: The route, tests, and build pass; lifecycle ADR covers errors, short
circuits, streams, and aborts.
Rollback: Remove the example without affecting a published API.

### Step 1: Minimal workspace boundaries

Dependencies: Step 0  
Context: Extract only boundaries proven by the walking skeleton.

Tasks:

- Create `common`, `core`, `platform-elysia`, and `apps/examples-basic`.
- Include `packages/*` and `apps/*` in Bun workspaces.
- Configure catalogs, `workspace:*`, exports, and Vite+ packaging.
- Add clean-install and workspace-cycle CI checks.

Verify: Frozen install, checks, tests, three library packages, and example build.  
Exit: A clean checkout is reproducible with no workspace dependency cycles.  
Rollback: Collapse packages back into the walking skeleton.

### Step 2: Typed descriptors and compile-test spine

Dependencies: Step 1  
Context: Prevent generic erasure before implementing DI or routing.

Tasks:

- Define typed token, module, provider, and route descriptors.
- Implement persistent generic plugin and controller builders.
- Add positive and negative compile fixtures and declaration snapshots.
- Add a rule against exported `any`.

Verify: `bun test packages/common`, `bun run test:types`, and `vp pack`.  
Exit: The canonical type example infers completely and invalid compositions fail.  
Rollback: Revert descriptors before they have runtime consumers.

### Step 3: Module graph compiler

Dependencies: Step 2  
Context: Validate topology and visibility before creating providers.

Tasks:

- Compile import, export, and visibility graphs.
- Diagnose duplicates, missing dependencies, and cycles with dependency paths.
- Define module-instance identity for diamond and configured imports.
- Add graph snapshots and property tests.

Verify: `bun test packages/core --test-name-pattern module-graph`.  
Exit: Graph fixtures and fuzz seeds pass with approved diagnostic snapshots.  
Rollback: Keep descriptors and remove the graph compiler export.

### Step 4: Singleton DI vertical slice

Dependencies: Step 3  
Context: Validate resolution with one scope before adding lifecycle complexity.

Tasks:

- Implement `useValue`, `useFactory`, explicit `deps`, and singleton `useClass`.
- Implement documented optional, multi-token, and duplicate semantics.
- Prevent business-facing service locator usage.

Verify: `bun test packages/core --test-name-pattern singleton`.  
Exit: Typed dependency chains resolve without reflection or runtime metadata scans.  
Rollback: Revert the container while the platform remains independent.

### Step 5: Async lifecycle and provider scopes

Dependencies: Step 4  
Context: Add lifecycle and scopes after singleton semantics stabilize.

Tasks:

- Add async factories with timeout and cancellation.
- Add request and transient ownership.
- Enforce `useExisting` scope constraints.
- Add reverse-topological disposal and failed-bootstrap cleanup.

Verify: `bun test packages/core --test-name-pattern lifecycle`.  
Exit: Initialization, disposal, leak tests, and failure injection are deterministic.  
Rollback: Feature-flag non-singleton scopes and preserve singleton behavior.

### Step 6: Minimal Elysia adapter

Dependencies: Steps 2 and 4  
Context: Compile one typed controller route into one native Elysia plugin.

Tasks:

- Add bootstrap, init, listen, and close without global signal handlers.
- Implement one controller backed by a value provider.
- Add a managed native-plugin escape hatch.

Verify: Adapter vertical tests and workspace checks.
Exit: Runtime and type tests pass.
Rollback: Remove the isolated adapter package and retain the raw example.

### Step 7: Elysia lifecycle and scope conformance

Dependencies: Steps 5 and 6  
Context: Turn phase and scope mappings into executable specifications.

Tasks:

- Implement every phase mapping from Section 6.
- Test local, scoped, global, diamond, configured, and hot-reload behavior.
- Test thrown errors, short circuits, native responses, streams, and aborts.
- Classify managed, isolated, and unsafe escape hatches.

Verify: Adapter conformance tests and the `vp test` conformance lane.  
Exit: The phase and scope matrix passes with no undocumented order dependence.  
Rollback: Retain the minimal Step 6 route and remove advanced mappings.

### Step 8: Validation, errors, and response contracts

Dependencies: Step 7  
Context: Preserve native Elysia schemas and an OpenAPI-compatible metadata artifact.

Tasks:

- Add typed request and status-specific response contracts.
- Define coercion and unknown-field policies.
- Add RFC 9457 Problem Details.
- Add safe serialization and OpenAPI intermediate metadata.

Verify: Validation and adapter tests, compile tests, and schema snapshots.  
Exit: Invalid input is rejected, production errors are safe, and Eden fixtures compile.  
Rollback: Fall back to direct Elysia schemas and errors.

### Step 9: Configuration, secrets, logging, and redaction

Dependencies: Step 2  
Parallel with: Steps 6 through 8  
Context: Security requires typed configuration and safe logging first.

Tasks:

- Add typed environment and configuration validation.
- Add non-serializable secret references.
- Add structured logging and mandatory redaction fields.
- Add failure-safe bootstrap diagnostics.

Verify: Configuration tests and the redaction corpus.  
Exit: Secret leakage tests pass and invalid configuration fails before listening.  
Rollback: Keep adapter contracts and allow application-provided implementations.

### Step 10: Admission and HTTP hardening

Dependencies: Steps 7, 8, and 9  
Context: Enforce controls at the correct proxy, Bun, or Elysia boundary.

Tasks:

- Add trusted proxy, host, and client-IP policy.
- Add connection, concurrency, time, body, header, URL, compression, and multipart limits.
- Add cleanup, abort, backpressure, and safe-error handling.
- Add official-plugin-compatible CORS, security-header, and cache policies.

Verify: Admission security suite and slow-client, load, and abort harnesses.  
Exit: Admission-boundary threat cases pass with recorded artifacts.  
Rollback: Remove the secure preset while preserving composable controls.

### Step 11: Authentication and authorization

Dependencies: Steps 8, 9, and 10  
Context: Authenticate from validated credentials and separate authorization policy.

Tasks:

- Add principal and default-deny policy contracts.
- Add JWT verification and bounded, allowlisted JWKS behavior.
- Add secure cookie sessions and a CSRF reference implementation.
- Add Bun password policy and upgrade support.

Verify: Authentication abuse, rotation, unknown-key, stampede, and CSRF fixtures.  
Exit: The abuse corpus passes and no decode-only JWT path exists in the public API.  
Rollback: Remove reference implementations and preserve interfaces.

### Step 12: Rate limiting

Dependencies: Steps 10 and 11  
Context: Derive identity only after trusted proxy and authentication resolution.

Tasks:

- Add bounded-cardinality key derivation.
- Add an in-memory development store and distributed-store contract.
- Define fail-open, fail-closed, atomicity, and `Retry-After`.
- Add outage, race, and load tests.

Verify: Rate-limit tests and concurrent load harness.  
Exit: Atomicity, outage behavior, and memory cardinality match policy.  
Rollback: Remove the limiter module without changing authentication.

### Step 13: Testing package

Dependencies: Steps 5 and 8  
Parallel with: Steps 10 through 12  
Context: Provide reusable overrides before generating application templates.

Tasks:

- Add a testing module builder.
- Add provider, module, and phase-hook overrides.
- Add an `app.handle(Request)` client, fake clock, and deterministic shutdown.

Verify: Testing package suite and public-API example tests.  
Exit: Integration fixtures open no network ports and leak no handles.  
Rollback: Tests may use native Elysia handling directly.

### Step 14: Observability and health

Dependencies: Steps 7 and 9  
Parallel with: Steps 11 through 13  
Context: Add telemetry after lifecycle and redaction contracts stabilize.

Tasks:

- Add request IDs, trace propagation, and the official OpenTelemetry bridge.
- Add RED and bootstrap metrics.
- Add liveness, readiness, and startup health.

Verify: Observability tests, an OTLP fixture, and the redaction regression corpus.  
Exit: Trace continuity, bounded metric labels, and readiness timing pass assertions.  
Rollback: Remove telemetry plugins and preserve the logger contract.

### Step 15: CLI walking path

Dependencies: Steps 6 and 13  
Context: Start with project creation and diagnostics, not the entire generator ecosystem.

Tasks:

- Add the basic `create-aponia` template.
- Add `aponia doctor`.
- Add a host runner that owns signals, draining, and forced termination policy.
- Add generated-project smoke tests.

Verify: Generate in a temporary directory, install, check, test, build, start, and close.  
Exit: The template passes on every supported Bun version.  
Rollback: Keep the manual template and do not publish the CLI.

### Step 16: AST generators and graph command

Dependencies: Steps 3 and 15  
Context: Build developer tooling on stable graph and descriptor contracts.

Tasks:

- Add AST-safe module, controller, and provider generators.
- Add `aponia graph` and watch-mode diagnostics.
- Add REST and authentication templates.

Verify: Golden-file, idempotency, and generated-project compile tests.  
Exit: Repeated generation never corrupts source and graph output matches snapshots.  
Rollback: Retain only project creation and diagnostics.

### Step 17: OpenAPI and Eden Treaty

Dependencies: Steps 8 and 15  
Parallel with: Step 16  
Context: Consume Step 8 metadata without scanning handlers again.

Tasks:

- Aggregate OpenAPI through the official Elysia plugin.
- Validate operations, security schemes, and route versions.
- Add Eden Treaty compile and runtime examples.

Verify: OpenAPI snapshots, compile tests, and generated-client contracts.  
Exit: Status, error, and plugin-derived context types remain end-to-end safe.  
Rollback: Applications use official Elysia plugins directly.

### Step 18: Optional decorators

Dependencies: Steps 2 and 8  
Parallel with: Steps 15 through 17  
Context: Decorators are syntax sugar and cannot add hidden runtime semantics.

Tasks:

- Emit the same immutable descriptors as the functional API.
- Prohibit reflection scans on request paths.
- Add parity, type, and declaration tests.

Verify: Functional-versus-decorator golden tests.
Exit: Decorators expose no capability unavailable to the functional API.  
Rollback: Remove the optional package without changing the core.

### Step 19: Release hardening

Dependencies: Steps 10 through 18  
Context: Enforce production gates before version 1.

Tasks:

- Add compatibility and security CI matrices.
- Add documentation, migration, deprecation, and reference applications.
- Add SBOM, provenance, signed releases, and `SECURITY.md`.
- Define beta soak load, duration, and API signature approval.

Verify: Full baseline, security audit, and deployment smoke tests.
Exit: No unresolved critical or high finding; medium findings require approved
exceptions; soak criteria pass.
Rollback: Retain a release candidate and do not promote it to stable.

### Step 20: Post-version-1 ecosystem

Dependencies: Step 19  
Context: Independent adapters can proceed after contracts are frozen.

Candidates include WebSocket and SSE, cache and scheduling, events and queues,
database transaction context, GraphQL, NATS, Redis, Kafka, RabbitMQ, gRPC, CQRS,
mail, storage, jobs, and developer tools.

Verify: A contract suite and one production-grade implementation per capability.  
Exit: Every adapter has a cross-application use case and adds no transport
concern to the core.  
Rollback: Remove an adapter without changing the core.

## 11. Dependency graph

```text
0 -> 1 -> 2 -> 3 -> 4 -> 5 ----------------+
          +--------> 6 -> 7 -> 8 -----------+-> 10 -> 11 -> 12 --+
          +--------> 9 ---------------------+                     |
                         5 + 8 -> 13 -> 15 -> 16 ------------------+
                         7 + 9 -> 14 ------------------------------+
                         8 + 15 -> 17 -----------------------------+
                         2 + 8 -> 18 ------------------------------+
                                                                  +-> 19 -> 20
```

Parallel lanes:

- Step 9 can run alongside Steps 6 through 8 after descriptor contracts stabilize.
- Step 13 can run alongside security implementation.
- Steps 14, 16, 17, and 18 can use separate workstreams after their dependencies.
- Step 19 documentation, security, and release work may use separate pull requests,
  but the stable release gate remains unified.
- Step 20 adapters can use independent teams after version 1.

## 12. Frequently forgotten or intentionally deferred capabilities

- Request cancellation, timeout, and graceful shutdown.
- Trusted proxies and correct client IP derivation.
- Request and response limits and streaming backpressure.
- Idempotency keys and retry semantics.
- Transaction boundaries for requests and jobs.
- Configuration validation and secret rotation.
- Log redaction and PII policy.
- API versioning and deprecation.
- Separate liveness, readiness, and startup checks.
- Test overrides and deterministic lifecycle behavior.
- Plugin compatibility and version matrices.
- Migration and codemod strategy.
- Package provenance, SBOMs, and vulnerability disclosure.
- Accessible diagnostics and error messages.
- Continuous performance regression gates.

## 13. Release milestones

- M0 Walking skeleton and type spine: Steps 0 through 2.
- M1 Core and DI: Steps 3 through 5.
- M2 HTTP Alpha: Steps 6 through 9.
- M3 Secure Beta: Steps 10 through 14.
- M4 Developer Preview: Steps 15 through 18.
- M5 Version 1 RC and Stable: Step 19.
- M6 Ecosystem: Step 20.

Do not claim production readiness before M5.

## 14. Plan mutation protocol

When evidence requires a roadmap change:

1. Record the reason and evidence in an ADR.
2. Identify affected steps and dependency edges.
3. Split any step that exceeds one reviewable pull request.
4. Do not bypass security or contract gates without replacement verification.
5. Update exit and rollback criteria before implementation.
6. Preserve abandoned decisions and their rationale in ADR history.
7. Keep all persisted roadmap and ADR content in English.

## 15. Primary references

- [Elysia plugins and lifecycle scope](https://elysiajs.com/essential/plugin)
- [Elysia lifecycle](https://elysiajs.com/essential/life-cycle)
- [Elysia validation](https://elysiajs.com/essential/validation)
- [Elysia OpenAPI plugin](https://elysiajs.com/plugins/openapi)
- [Elysia Eden Treaty](https://elysiajs.com/eden/treaty/overview)
- [Bun runtime](https://bun.sh/docs/runtime)
- [Bun workspaces](https://bun.sh/docs/pm/workspaces)
- [Bun test runner](https://bun.sh/docs/test)
- [Bun TypeScript guidance](https://bun.sh/docs/typescript)
- [NestJS capability map](https://docs.nestjs.com/introduction)
