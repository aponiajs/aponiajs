# AponiaJS Modernization — Architectural Excellence, Next-Gen DX & Zero-Overhead Performance

Status: Design.

## Why this document

AponiaJS provides an ergonomic, modular application architecture (modules, controllers, dependency injection, WebSockets, enhancers) running natively on Bun and Elysia. While AponiaJS achieves impressive runtime throughput (measured between 96.5% and 99.7% of raw Elysia), preparing the framework for production v1.0 requires an end-to-end architectural modernization that marries two seemingly opposing goals:

1. **Superior Developer Experience (DX):** Write clean, expressive, and type-safe code using familiar NestJS-like patterns (`@Module`, `@Controller`, `@Injectable`, `@UseGuards`), complete Standard Schema v1 validation, and crystal-clear actionable error diagnostics.
2. **Absolute Maximum Performance (Zero-Cost Abstractions):** Under the hood, the developer pays **zero runtime penalty** for using high-level abstractions. The compiler compiles high-level decorated classes into raw, unencumbered native Elysia route handlers with zero intermediate middleware wrappers, zero context overhead, and zero Promise overhead on synchronous endpoints.

---

## The Zero-Cost Abstraction Philosophy: Great DX Outside, Raw Speed Inside

| What the Developer Writes (Great DX)                                | What the Compiler Emits (Raw Performance)                                  | Performance Impact                                                                |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Zero-parameter handler: `@Get('/ping') ping() { return 'pong'; }`   | Native 0-arg closure: `app.get('/ping', () => instance.ping())`            | **Zero Context Allocation:** Bun skips parsing and allocating Context entirely    |
| Sync handler: `@Get('/calc') calc(@Body() b) { return b.x + b.y; }` | Pure synchronous closure: `app.get('/calc', (c) => instance.calc(c.body))` | **Sync Fast-Path:** Never wraps in `async/Promise`, running at pure C++/JSC speed |
| Route without Guards/Interceptors                                   | Direct route attachment: `app.route(method, path, invoker)`                | **Zero-Cost Pipeline:** No middleware loop or array iteration in request path     |
| Type validation: `@Post('/', { body: UserDto })`                    | Pre-compiled TypeBox/Standard Schema hook attached at bootstrap            | **Zero Reflection:** Validation runs once via Elysia native hooks                 |
| Complex dependency graphs                                           | Pre-resolved singletons with frozen Hidden Classes                         | **JIT-Warmed:** Monomorphic call sites, zero de-optimization during traffic       |

---

## Architectural Principles

1. **Zero-Overhead Hot Path:**
   No per-request metadata lookup, no dynamic argument spreading, no generic context wrapping, and no unnecessary `async/await` overhead on synchronous route handlers. The framework lowers controller methods into specialized, monomorphic route invokers during bootstrap or build time.
2. **Sucrose Inlining & Native Parity:**
   Elysia relies on source-code static inspection (Sucrose) to infer required request context fields (e.g., `body`, `query`, `headers`, `set`). Generated route invokers must explicitly reference only the required context properties directly to prevent Elysia from de-optimizing into full context materialization.
3. **Two Unified Authoring Paths, One Frozen IR:**
   Whether declared via TypeScript class decorators (`@Module`, `@Controller`, `@Injectable`) or functional descriptors (`defineModule`, `defineController`), definitions compile down into the identical frozen Intermediate Representation (`ModuleDefinitionIR`, `ControllerRouteIR`).
4. **Eager Fail-Fast Verification:**
   All module graph cycles, missing dependencies, token collisions, and route path conflicts are analyzed and verified during bootstrap before listening to incoming traffic. Errors produce visual graphs and actionable hints.
5. **Standardized Ecosystem Contracts:**
   Rely on open web specifications: Standard Schema v1 (`~standard`) for validation, RFC 9457 Problem Details for HTTP errors, and W3C trace contexts for distributed tracing.

---

## Detailed Architectural Design

### 1. Maximum Runtime Performance & Invoker Engine

#### The Zero-Argument Context Stripping

Elysia's Sucrose compiler inspects the function parameter list:

- If a function takes `(ctx) => ...`, Bun allocates the Elysia Context object and parses available headers/request data.
- If a function takes `() => ...`, Bun executes the handler with **zero context allocation**, maximizing throughput.

In AponiaJS, when a controller method defines no parameter decorators and accepts no arguments:

```ts
// Compiler detects 0 parameters:
const invoker = () => instance[handlerName]();
```

This guarantees that lightweight endpoints (health checks, static responses, cached data) run at 100% Raw Elysia speed.

#### Synchronous Fast-Path Preservation

In typical web frameworks, every handler is normalized to `Promise<Response>`. In Bun and JavaScriptCore (JSC), microtask queue switching for Promises adds measurable latency to sub-millisecond endpoints.

AponiaJS inspects the handler signature and TypeScript metadata:

- If synchronous: emitted invoker is a synchronous function `(c) => instance.action(c.body)`.
- If asynchronous: emitted invoker is an async function `async (c) => await instance.action(c.body)`.

#### Zero-Overhead Enhancer Short-Circuiting

If a controller or route has no Guards, Interceptors, or Pipes applied:

- The entire enhancer pipeline is completely bypassed at compile time.
- The route registers directly onto Elysia without intermediate wrappers.
- When synchronous guards are present, they are compiled into inline fast-abort statements:
  ```ts
  if (!guardInstance.canActivate(ctx)) {
    ctx.set.status = 403;
    return { statusCode: 403, error: "Forbidden", message: "Forbidden" };
  }
  ```

---

### 2. Core Engine & IoC Architecture

#### Dependency Inversion & Strict Tiering

```
@aponiajs/common (Contracts, Decorators, Metadata Tokens, Reflector)
       ▲
       │
@aponiajs/core (DAG Engine, Dependency Injection Container, Scope Management)
       ▲
       │
@aponiajs/platform-elysia (Elysia Adapter, Route Compiler, Invoker Engine, WebSockets)
```

- `@aponiajs/core` and `@aponiajs/common` have **zero** dependencies on Elysia or Bun runtime packages.
- All tokens are strongly typed (`InjectionToken<T> = string | symbol | Constructor<T>`).
- Visibility is strictly enforced: an imported module must explicitly list a provider in its `exports` array for that provider to be resolvable by consuming modules.

#### Eager Graph Compilation & Cycle Visualization

When circular dependencies or missing providers occur, `GraphCompiler` builds an actionable diagnostic tree:

```text
[AponiaError] PROVIDER_CYCLE: Circular dependency detected in module "CatalogModule":
  ProductsService -> InventoryService -> PricingService -> ProductsService

Hint: Break the cycle using forwardRef() or decouple shared logic into a separate DomainService.
```

When a provider token is unresolved:

```text
[AponiaError] MISSING_PROVIDER: Module "OrdersModule" cannot resolve token "UsersService".

Hint: "UsersService" is declared in imported module "UsersModule", but is not exported.
Add "UsersService" to UsersModule.exports to make it visible to OrdersModule.
```

---

### 3. Developer Experience (DX) & Type Inference

#### Standard Schema v1 (`~standard`)

AponiaJS natively accepts all Standard Schema-compliant libraries (Zod, ArkType, Valibot) and TypeBox:

```ts
import { Controller, Post, Body, Validation } from "@aponiajs/common";
import { z } from "zod";

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
});

@Validation(CreateUserSchema)
export class CreateUserDto {
  email!: string;
  name!: string;
}

@Controller("/users")
export class UsersController {
  @Post("/", { body: CreateUserDto })
  create(@Body() body: CreateUserDto) {
    return { status: "created", user: body };
  }
}
```

#### First-Class Request Parameter Decorators

Decorators provide clean syntax with optional property access:

- `@Body()` / `@Body('property')`
- `@Query()` / `@Query('property')`
- `@Param()` / `@Param('property')`
- `@Headers()` / `@Headers('property')`
- `@Req()`: Native Request object
- `@Context()`: Full Elysia Context
- `@State()`: Application state store

#### Declarative Enhancers (Guards, Interceptors, Pipes, Filters)

Enhancers execute in a strictly defined lifecycle order:

```text
Incoming Request
       │
       ▼
[Middleware] (Global / Pattern-matched)
       │
       ▼
[Guards] (CanActivate: Authentication & Authorization)
       │
       ▼
[Interceptors] (Pre-controller logic)
       │
       ▼
[Pipes] (Transform & Validate arguments)
       │
       ▼
[Controller Handler]
       │
       ▼
[Interceptors] (Post-controller transformation)
       │
       ▼
[Exception Filters] (Catch unhandled errors -> RFC 9457 Problem Details)
       │
       ▼
HTTP Response
```

---

### 4. Ahead-Of-Time (AOT) Code Generation

For applications requiring ultra-fast cold starts (e.g., serverless environments or microservices), `@aponiajs/cli` provides AOT compilation commands:

```bash
bun aponia build --aot
```

This generates:

1. `descriptors.generated.ts`: Pre-lowered frozen module and controller definitions, eliminating reflection and decorator overhead at startup.
2. `invokers.generated.ts`: Pre-compiled static route invokers mapped directly to Elysia route registration.

---

### 5. Testing & Ecosystem Tooling

#### `@aponiajs/testing` Harness

Provides a fluent, familiar testing module builder:

```ts
import { Test } from "@aponiajs/testing";
import { AppModule } from "./app.module.ts";
import { DatabaseService } from "./database.service.ts";

const moduleRef = await Test.createTestingModule({
  imports: [AppModule],
})
  .overrideProvider(DatabaseService)
  .useValue({ query: () => [] })
  .compile();

const app = await moduleRef.createAponiaApplication();
const response = await app.handle(new Request("http://localhost/users"));
expect(response.status).toBe(200);
```

---

### 6. Phased Implementation Roadmap

1. **Phase 1: Core DI Kernel & Unified IR**
   - Solidify `@aponiajs/core` DAG compiler, circular graph diagnostic visualizer, and strict export-based visibility.
   - Unify decorated class metadata and functional descriptors into frozen `ModuleDefinitionIR`.
2. **Phase 2: Platform Invoker & Zero-Overhead Fast-Path**
   - Implement zero-argument context stripping (`() => method()`) in route compiler.
   - Enforce synchronous route fast-path without microtask/Promise wrappers.
   - Short-circuit empty enhancer pipelines at compile time.
3. **Phase 3: DX & Standard Schema v1 Lowering**
   - Polish parameter decorators (`@Body`, `@Param`, `@Query`) with direct compiled property extractors.
   - Integrate complete Standard Schema v1 (`~standard`) validation hooks.
4. **Phase 4: Tooling, AOT & Testing Harness**
   - Upgrade `@aponiajs/testing` with fluent provider overrides (`Test.createTestingModule`).
   - Deliver AOT invoker generator in `@aponiajs/cli` (`bun aponia build --aot`).
   - Verify performance parity (≥ 96.5% - 99.7% of raw Elysia) and 95% test coverage.

---

## Verification & Quality Gates

To guarantee production readiness, all implementations must satisfy:

1. **Aggregate Test Coverage:** ≥ 95% line and function coverage enforced by `scripts/coverage-gate.ts`.
2. **Runtime Performance Parity:** Benchmark suite verifying ≥ 96% throughput compared to raw Elysia across sync and async routes.
3. **Dual Test Lanes:**
   - Bun lane: `bun run test:coverage` (100% passing).
   - Vite+ lane: `bun run test:vite-plus` (TypeScript types and conformance validation).
4. **Code Quality:** Zero errors from `bun run check` (Oxfmt and Oxlint).
5. **No Memory Leaks:** Verified clean teardown in `@aponiajs/testing` and graceful shutdown hooks.
