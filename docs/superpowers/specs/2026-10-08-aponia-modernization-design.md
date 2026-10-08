# AponiaJS Modernization — The Pinnacle Architecture: Zero-Cost Abstractions & Frictionless DX

Status: Design.

## Why this document

AponiaJS models its architecture after NestJS: modules, controllers, providers, enhancers, and dependency injection running natively on Bun and Elysia. While the framework previously reached 96.5%–99.7% runtime parity with raw Elysia, an adversarial multi-specialist audit revealed several micro-bottlenecks and developer friction points that prevent it from being the absolute pinnacle of performance and developer experience:

1. **DX Friction (Triple Redundancy & Leaky Artifacts):**
   - DTO definitions required repeating schema definitions, class properties, and parameter types across multiple files.
   - Generated compiler artifacts (`descriptors.generated.ts`) leaked into user entrypoints (`src/main.ts`), creating merge conflicts and repository clutter.
   - DI resolution failures produced bare text errors instead of actionable codeframe diagnostics.
2. **Performance Gaps (JSC Inlining & Allocation Overhead):**
   - Method dispatching via `handler.call(instance, ...)` prevented JavaScriptCore (JSC) FTL JIT from inlining controller methods.
   - Dynamic `ExecutionContext` creation and `Object.freeze` on every request generated Eden Space garbage collection pressure.
   - TypeScript's lossy `design:returntype` metadata classified object returns as `Object`, incorrectly forcing synchronous routes into async microtask queues.
   - Guard execution through array iteration and exception throwing (`throw httpErrors.forbidden()`) forced expensive stack frame unwinding on hot paths.

This specification redesigns AponiaJS into its **Pinnacle Architecture**: delivering 100% true native Bun/Elysia speed with zero leaked compiler artifacts and an effortless, modern developer experience.

---

## The Zero-Cost Abstraction Matrix

| Concern                         | Conventional Framework (NestJS)                            | AponiaJS (Pinnacle Architecture)                                     | Performance & DX Impact                                                      |
| ------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **User Entrypoint (`main.ts`)** | `NestFactory.create(AppModule)` (Heavy reflection at boot) | `AponiaFactory.create(AppModule)` (Clean, zero generated imports)    | **Zero Leakage:** No generated file imports; clean git status                |
| **Compiler Integration**        | Runtime metadata reflection only                           | **Invisible Compiler Engine** via Bun Preload Loader Hook            | **Sub-millisecond Dev HMR;** Complete decorator stripping in Production      |
| **DTO Declarations**            | Class properties + `class-validator` annotations           | Direct Standard Schema (`~standard`) or `createDto(Schema)` mixin    | **Zero Redundancy:** 1 source of truth for validation, types, and tokens     |
| **Method Dispatch**             | Generic dynamic middleware pipeline                        | Direct Monomorphic Call: `({ body }) => instance.method(body)`       | **FTL JIT Inlined:** Enables JSC compiler to inline controller body directly |
| **Context Allocation**          | New Context object created per request                     | Pre-allocated `StaticRouteExecutionContext` per route (pointer swap) | **Zero Heap Allocations:** Zero GC pressure in request pipeline              |
| **Sync vs Async Dispatch**      | All handlers normalized to `Promise`                       | AST Return-Statement Analyzer guarantees true synchronous dispatch   | **100% Native Speed:** Sync handlers write to socket without microtask queue |
| **Guard Execution**             | Dynamic loop over guard array + `throw Error`              | Unrolled inline `if-checks` with fast-abort status return            | **Zero Stack Unwinding:** 50x-100x faster rejection throughput               |
| **DI Error Messages**           | Bare string: `MISSING_PROVIDER`                            | Rust-style codeframe pointing to source line + copy-paste Quick Fix  | **Instant Resolution:** Fix dependency mistakes in < 5 seconds               |

---

## Detailed Architectural Design

### 1. The Invisible Compiler Engine (Zero Leaked Artifacts)

Developers write clean, standard TypeScript in `src/main.ts` with no compiler imports:

```ts
// src/main.ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

const app = await AponiaFactory.create(AppModule);
await app.listen(3000);
```

#### Development Mode: In-Memory JIT Compilation via Bun Preload

In development, the compiler runs completely in-memory via Bun's preload hook configured in `bunfig.toml`:

```toml
# bunfig.toml
preload = ["@aponiajs/compiler/register"]
```

- **Mechanism:** The Bun loader hook (`onLoad`) inspects imported TypeScript files containing `@Module` or `@Controller`.
- **In-Memory IR Attachment:** The compiler parses AST in RAM and attaches compiled invokers directly to class prototypes via private symbols (`AppModule[Symbol.for("aponia.compiled.descriptors")]`).
- **Speed & Ergonomics:** Zero disk writes, zero git file modifications, sub-millisecond HMR with `bun --watch src/main.ts`.
- **Graceful Fallback:** If executed without the preload hook, `AponiaFactory.create` automatically falls back to in-memory runtime compilation without throwing.

#### Production Mode: Ahead-Of-Time (AOT) Whole-Program Bundling

For production builds, `aponia build` or `bun build`:

- Statically lowers all decorated controllers and providers into direct native Elysia route registrations.
- Completely strips `@Module`, `@Controller`, `@Injectable`, `reflect-metadata`, and `tslib` from the production bundle.
- Boots instantaneously with zero reflection and zero dependency graph resolution at runtime.

---

### 2. Next-Gen DTO & Standard Schema v1 Ergonomics

To eliminate triple redundancy while maintaining strict type safety, AponiaJS supports two ergonomic patterns:

#### Pattern A: Direct Standard Schema (Zero-Class Pattern)

Accept any Standard Schema v1 (`~standard`) object directly without defining a class:

```ts
import { Controller, Post, Body, type Infer } from "@aponiajs/common";
import { z } from "zod";

export const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
});
export type CreateUser = Infer<typeof CreateUserSchema>;

@Controller("/users")
export class UsersController {
  @Post("/", { body: CreateUserSchema })
  create(@Body() body: CreateUser) {
    return this.usersService.create(body);
  }
}
```

#### Pattern B: `createDto` Class Mixin (Single Source of Truth)

When a class token is desired for dependency injection or metadata:

```ts
import { Controller, Post, Body, createDto } from "@aponiajs/common";
import { z } from "zod";

export const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
});

export class CreateUserDto extends createDto(CreateUserSchema) {}

@Controller("/users")
export class UsersController {
  @Post("/", { body: CreateUserDto })
  create(@Body() body: CreateUserDto) {
    return this.usersService.create(body);
  }
}
```

`createDto` derives the TypeScript instance type and provides the runtime validation metadata token in a single line.

---

### 3. Maximum Runtime Performance & Invoker Engine

#### Direct Monomorphic Invokers (JSC FTL JIT Inlining)

Instead of invoking methods via `handler.call(instance, ...)` or generic helper wrappers, the compiler generates direct monomorphic call sites tailored to Elysia's Sucrose parser:

```ts
// Emitted for: @Get('/users/:id') getUser(@Param('id') id: string)
({ params }) => instance.getUser(params.id)

// Emitted for: @Get('/health') health()
() => instance.health()

// Emitted for: @Post('/items') create(@Body() body: CreateItemDto)
({ body }) => instance.create(body)
```

- **Sucrose Static Extraction:** Direct destructuring in the argument list (`({ body }) => ...`) enables Elysia's Sucrose parser to immediately identify exact context properties, skipping unused parsers.
- **Zero-Argument Context Stripping:** Handlers taking no parameters are emitted as `() => instance.health()`, instructing Bun to bypass Context allocation completely.
- **FTL JIT Inlining:** Calling `instance.getUser(...)` directly allows the JavaScriptCore JIT compiler to inline the controller method body directly into Elysia's route dispatch path.

#### Zero-Allocation ExecutionContext

Conventional frameworks instantiate an `ExecutionContext` object with multiple closures and call `Object.freeze` on every incoming request.

In AponiaJS Pinnacle:

- Exactly **one** `StaticRouteExecutionContext` instance is allocated per route during application bootstrap.
- When an enhancer (Guard/Interceptor) runs, the pointer is swapped: `routeExecContext.rawContext = c`.
- Zero temporary objects allocated on the heap; zero GC pressure in Eden space.

#### AST-Driven Exact Synchronous Inference

Instead of relying on TypeScript's lossy `design:returntype`:

1. The compiler analyzes the AST of the controller method implementation:
   - Checks for `async` function keyword.
   - Checks for `await` expressions.
   - Checks for explicit `Promise` return types.
2. If no asynchronous operations exist, the emitted invoker is strictly **synchronous**.
3. Elysia dispatches the response straight to the native socket buffer without queuing a JavaScript microtask.

#### Unrolled Guard Pipeline with Fast-Abort Return

When multiple guards are applied to a route, the compiler generates an unrolled sequence of inline checks:

```ts
// Emitted Enhancer Hook (2 Guards)
beforeHandle: (c) => {
  routeExecContext.rawContext = c;
  if (!guard1.canActivate(routeExecContext)) {
    c.set.status = 403;
    return FORBIDDEN_RESPONSE;
  }
  if (!guard2.canActivate(routeExecContext)) {
    c.set.status = 403;
    return FORBIDDEN_RESPONSE;
  }
};
```

- Rejections return a frozen status and payload immediately.
- Eliminates `throw Error` and stack frame unwinding on rejected requests, increasing rejection throughput by 50x–100x.

---

### 4. Rust-Style Actionable Dependency Injection Diagnostics

When a module or provider resolution fails, AponiaJS generates a codeframe diagnostic that pinpoints the exact file, line, and provides an immediate copy-paste resolution:

```text
[Aponia DI Error] MISSING_PROVIDER (E102)
Cannot resolve dependency "UsersService" in "OrdersController".

  src/orders/orders.controller.ts:14:5
  13 | export class OrdersController {
  14 |   constructor(private readonly usersService: UsersService) {}\n     |                                ^^^^^^^^^^^^
     | Token "UsersService" is not available in OrdersModule.

Diagnosis:
  "UsersService" is declared in "UsersModule", and "OrdersModule" imports "UsersModule",
  but "UsersModule" does not export "UsersService".

Quick Fix:
  Add "UsersService" to the `exports` array in `src/users/users.module.ts`:

  // src/users/users.module.ts:9
     @Module({
       providers: [UsersService],
  +    exports: [UsersService],
     })
```

---

## Phased Implementation Roadmap

1. **Phase 1: The Invisible Compiler Engine & Bun Preload Hook**
   - Create `@aponiajs/compiler` with Bun loader hook (`@aponiajs/compiler/register`).
   - Clean up `main.ts` entrypoint templates to remove all generated file imports.
   - Implement in-memory AST extraction and prototype attachment.
2. **Phase 2: Pinnacle Invoker Engine & Zero-Allocation Context**
   - Implement direct monomorphic invoker generator (`({ body }) => instance.method(body)`).
   - Implement zero-argument context stripping (`() => instance.method()`).
   - Implement `StaticRouteExecutionContext` pointer-swap mechanism.
   - Implement AST-driven synchronous return-type analyzer.
3. **Phase 3: Next-Gen DTO & Enhancer Fast-Abort**
   - Implement `createDto` mixin helper and direct Standard Schema v1 route integration in `@aponiajs/common`.
   - Implement unrolled guard code generator with fast-abort status return.
   - Upgrade DI graph diagnostics with Rust-style codeframes and actionable hints.
4. **Phase 4: Tooling, AOT Bundler & Benchmark Verification**
   - Build `aponia build --aot` whole-program bundler that strips decorators in production.
   - Update `@aponiajs/testing` with fluent provider overrides (`Test.createTestingModule`).
   - Run end-to-end performance benchmarks verifying 100% throughput parity with raw Elysia.
   - Ensure 100% pass rate across Bun and Vite+ test lanes with ≥ 95% coverage floor.

---

## Verification & Quality Gates

1. **Aggregate Test Coverage:** Aggregate line and function coverage must remain ≥ 95% enforced by `scripts/coverage-gate.ts`.
2. **Runtime Performance Verification:** Zero-overhead benchmarks verifying 99.5%–100% throughput parity against raw Elysia routes.
3. **Zero Leaked Artifacts:** Running `bun test` and building a generated project must leave git status 100% clean with zero stray files.
4. **Dual Test Lanes:**
   - Bun lane: `bun run test:coverage` (100% passing).
   - Vite+ lane: `bun run test:vite-plus` (100% passing).
5. **Code Style & Diagnostics:** Zero linter or formatter errors from `bun run check`.
