# AponiaJS Modernization — Architectural Excellence, Next-Gen DX & Zero-Overhead Performance

Status: Design.

## Why this document

AponiaJS provides an ergonomic, modular application architecture (modules, controllers, dependency injection, WebSockets, enhancers) running natively on Bun and Elysia. While AponiaJS achieves impressive runtime throughput (measured between 96.5% and 99.7% of raw Elysia), preparing the framework for production v1.0 requires an end-to-end architectural modernization that addresses four core goals:

1. **Maximum Runtime Performance (Zero-Overhead Invocation):** Eliminate all intermediate abstraction penalties in the request hot path, preserving Elysia's native Sucrose static-analysis optimization, zero-copy parameter extraction, and synchronous route fast paths.
2. **First-Class Developer Experience (DX):** Deliver intuitive, type-safe API patterns aligned with modern TypeScript standards, comprehensive Standard Schema v1 validation, and rich, actionable diagnostics for dependency graph errors.
3. **Strict Clean Architecture & Separation of Concerns:** Enforce immutable, descriptor-first intermediate representations (IR) across both decorator-based and functional authoring styles, maintaining unidirectional dependency flow (`common` ← `core` ← `platform-elysia`).
4. **Production-Grade Ecosystem & Tooling:** Provide robust test harnesses (`@aponiajs/testing`), lightning-fast code generation (`@aponiajs/cli`), and native introspection capabilities via Devtools and Model Context Protocol (`@aponiajs/mcp`).

---

## Architectural Principles

1. **Zero-Overhead Hot Path:**
   No per-request metadata lookup, no dynamic argument spreading, no generic context wrapping, and no unnecessary `async/await` overhead on synchronous route handlers. The framework lowers controller methods into specialized, monomorphic route invokers during bootstrap or build time.
2. **Sucrose Inlining & Native Parity:**
   Elysia relies on source-code static inspection (Sucrose) to infer required request context fields (e.g., `body`, `query`, `headers`, `set`). Generated route invokers must explicitly reference only the required context properties directly to prevent Elysia from de-optimizing into full context materialization.
3. **Two Unified Authoring Paths, One Frozen IR:**
   Whether declared via TypeScript class decorators (`@Module`, `@Controller`, `@Injectable`) or functional descriptors (`defineModule`, `defineController`), definitions compile down into the identical frozen Intermediate Representation (`ModuleDefinitionIR`, `ControllerRouteIR`).
4. **Eager Fail-Fast Verification:**
   All module graph cycles, missing dependencies, token collisions, and route path conflicts are analyzed and verified during bootstrap before listening to incoming traffic. Errors must produce visual graphs and actionable hints.
5. **Standardized Ecosystem Contracts:**
   Rely on open web specifications: Standard Schema v1 (`~standard`) for validation, RFC 9457 Problem Details for HTTP errors, and W3C trace contexts for distributed tracing.

---

## Detailed Architectural Design

### 1. Maximum Runtime Performance & Invoker Engine

#### The Challenge

In web frameworks with dependency injection, request handling often incurs performance penalties due to:

- Dynamic reflection (`Reflect.getMetadata`) on every request.
- Context wrapper objects allocating memory and garbage collection pressure.
- Forcing all handlers into Promises (`async`), which degrades throughput by up to 20-30% for lightweight endpoints.
- Generic middleware proxies that defeat Elysia's Sucrose inspection, forcing Bun to materialize all headers, cookies, and queries even when untouched.

#### The Zero-Overhead Invoker Architecture

During bootstrap (or AOT code generation via CLI), `routing/route-compiler.ts` compiles a specialized, monomorphic JavaScript closure for each controller route handler:

```ts
// Static extraction: Sync handler accessing only params and body
export function createSpecializedInvoker(
  instance: any,
  handlerName: string,
  paramPlan: CompiledParamPlan,
  isAsync: boolean,
) {
  // If no parameter decorators, pass native context directly without wrapper
  if (paramPlan.type === "NATIVE_CONTEXT") {
    return isAsync
      ? function asyncNativeInvoker(ctx: any) {
          return instance[handlerName](ctx);
        }
      : function syncNativeInvoker(ctx: any) {
          return instance[handlerName](ctx);
        };
  }

  // Pre-compiled property accessors: zero dynamic indexing or spreading
  // Example for: @Get(':id') get(@Param('id') id: string, @Query('filter') filter: string)
  return isAsync
    ? function asyncSpecializedInvoker(ctx: any) {
        return instance[handlerName](ctx.params.id, ctx.query.filter);
      }
    : function syncSpecializedInvoker(ctx: any) {
        return instance[handlerName](ctx.params.id, ctx.query.filter);
      };
}
```

#### Rules for Maximum Throughput:

1. **Sync Fast-Path Preservation:** Check method signature and `design:returntype`. If the handler is synchronous, do not return a Promise or wrap in `async`. Elysia serves synchronous handlers on an ultra-fast raw path.
2. **Direct Sucrose Property References:** Invoker code references `ctx.body`, `ctx.query`, `ctx.params`, `ctx.headers`, and `ctx.set` explicitly. Never hide access behind helper functions (`extractValue(ctx, ...)`).
3. **Monomorphic Instance Invocations:** Bind `instance[handlerName]` or invoke directly as `handler.call(instance, p1, p2)`. Avoid `Reflect.apply` or variable argument arrays.
4. **Pre-compiled Standard Schema Hooks:** Validate inputs using Elysia hooks created once during route mounting. Validators are pre-lowered into native TypeBox or compiled Standard Schema validators ahead of time.

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

## Verification & Quality Gates

To guarantee production readiness, all implementations must satisfy:

1. **Aggregate Test Coverage:** ≥ 95% line and function coverage enforced by `scripts/coverage-gate.ts`.
2. **Runtime Performance Parity:** Benchmark suite verifying ≥ 96% throughput compared to raw Elysia across sync and async routes.
3. **Dual Test Lanes:**
   - Bun lane: `bun run test:coverage` (100% passing).
   - Vite+ lane: `bun run test:vite-plus` (TypeScript types and conformance validation).
4. **Code Quality:** Zero errors from `bun run check` (Oxfmt and Oxlint).
5. **No Memory Leaks:** Verified clean teardown in `@aponiajs/testing` and graceful shutdown hooks.
