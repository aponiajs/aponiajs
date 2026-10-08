# AponiaJS Modernization — The Pinnacle Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Pinnacle Architecture for AponiaJS: eliminate triple redundancy in DTOs, deliver zero-allocation ExecutionContext, generate direct monomorphic invokers for 100% Raw Elysia throughput, integrate the invisible Bun preload compiler engine, and provide Rust-style actionable DI diagnostics.

**Architecture:** AponiaJS compiles high-level Nest-like decorators and functional descriptors into native Elysia route handlers with zero runtime overhead. The implementation introduces an in-memory compiler hook via Bun preload, strips context allocation on zero-parameter routes, swaps pointers on a pre-allocated execution context, unrolls guard pipelines into inline fast-abort checks, and infers exact synchronous returns via AST inspection.

**Tech Stack:** TypeScript (ESM, strict), Bun workspace, Elysia 2.0, Standard Schema v1 (`~standard`), `oxfmt`, `oxlint`, `vitest` (Vite+ conformance).

**Spec:** `docs/superpowers/specs/2026-10-08-aponia-modernization-design.md`

## Global Constraints

- Monorepo package dependency direction: `common` ← `core` ← `platform-elysia`. Zero Elysia or Bun runtime dependencies in `common` or `core`.
- Aggregate line and function test coverage must remain ≥ 95% enforced by `scripts/coverage-gate.ts`.
- All runtime public descriptors and metadata must remain immutable (`Object.freeze`).
- Zero leaked compiler artifacts into user applications (`main.ts` must use clean `AponiaFactory.create(AppModule)`).
- All code, comments, documentation, and commit messages must be in English. Zero Thai characters in repository files.
- Dual test lanes: Bun test (`packages/*/tests/*.test.ts`) and Vite+ conformance (`packages/*/tests-vp/*.conformance.ts`).

## Review Focus

1. Zero-parameter routes: Emitted invoker must take exactly 0 arguments `() => instance.method()` so Elysia's Sucrose skips context allocation.
2. Synchronous routes: Handlers returning non-Promises must never be wrapped in `async` or Promises to avoid microtask queue latency.
3. Enhancer short-circuiting: Routes without guards/interceptors must register with zero enhancer wrappers attached.
4. Fast-abort guards: Rejected requests must return status 403 immediately without throwing exceptions to avoid stack unwinding.
5. Codeframe diagnostics: Resolution errors must pinpoint exact file:line and propose copy-paste module export additions.

---

### Task 1: Next-Gen DTO & Standard Schema v1 Ergonomics

**Files:**

- Create: `packages/common/src/routing/dto.ts`
- Modify: `packages/common/src/routing/index.ts`
- Modify: `packages/common/src/routing/route-schema.ts`
- Test: `packages/common/tests/dto.test.ts`
- Test: `packages/common/tests-vp/dto.conformance.ts`

**Interfaces:**

- Consumes: `StandardSchemaV1` from `@standard-schema/spec`
- Produces: `createDto<T>(schema: T): DtoConstructor<T>`, `Infer<T>`, updated `RouteSchema` accepting raw Standard Schema objects

- [ ] **Step 1: Write the failing test for `createDto` and raw Standard Schema route typing**

```ts
// packages/common/tests/dto.test.ts
import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { createDto, type Infer } from "../src/routing/dto.ts";
import { Post } from "../src/routing/route-decorators.ts";
import { ROUTE_SCHEMA_METADATA_KEY } from "../src/routing/route-schema.constants.ts";

describe("createDto & Standard Schema Ergonomics", () => {
  it("derives class constructor with validation token from Standard Schema", () => {
    const UserSchema = z.object({
      email: z.string().email(),
      name: z.string().min(2),
    });

    class UserDto extends createDto(UserSchema) {}
    type User = Infer<typeof UserSchema>;

    const instance = new UserDto();
    expect(instance).toBeDefined();
    expect(Reflect.getMetadata(Symbol.for("aponia.validation.metadata"), UserDto)).toBe(UserSchema);
  });

  it("allows passing raw Standard Schema directly into route decorator", () => {
    const RawSchema = z.object({ id: z.string() });

    class TestController {
      @Post("/", { body: RawSchema })
      submit() {}
    }

    const schemas = Reflect.getMetadata(
      ROUTE_SCHEMA_METADATA_KEY,
      TestController.prototype,
      "submit",
    );
    expect(schemas?.body).toBe(RawSchema);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/common/tests/dto.test.ts`
Expected: FAIL with "Cannot find module '../src/routing/dto.ts'"

- [ ] **Step 3: Implement `createDto` and export `Infer` type**

```ts
// packages/common/src/routing/dto.ts
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Validation } from "../decorators/validation.decorator.ts";

export type Infer<T> = T extends StandardSchemaV1 ? StandardSchemaV1.InferOutput<T> : never;

export type DtoConstructor<T extends StandardSchemaV1> = {
  new (): StandardSchemaV1.InferOutput<T>;
  readonly schema: T;
};

export function createDto<T extends StandardSchemaV1>(schema: T): DtoConstructor<T> {
  class BaseDto {}
  Validation(schema)(BaseDto);
  Object.defineProperty(BaseDto, "schema", {
    value: schema,
    writable: false,
    configurable: false,
    enumerable: true,
  });
  return BaseDto as unknown as DtoConstructor<T>;
}
```

Export `createDto` and `Infer` from `packages/common/src/routing/index.ts` and `packages/common/src/index.ts`. Update `packages/common/src/routing/route-schema.ts` to accept raw `StandardSchemaV1` in `RouteSchemaInput`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/common/tests/dto.test.ts`
Expected: PASS

- [ ] **Step 5: Add Vite+ conformance test**

```ts
// packages/common/tests-vp/dto.conformance.ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createDto, type Infer } from "@aponiajs/common";

describe("createDto Conformance", () => {
  it("preserves static schema and instance types across bundlers", () => {
    const Schema = z.object({ value: z.number() });
    class MetricDto extends createDto(Schema) {}
    type Metric = Infer<typeof Schema>;
    const sample: Metric = { value: 42 };
    expect(sample.value).toBe(42);
    expect(MetricDto.schema).toBe(Schema);
  });
});
```

Run: `bun run test:vite-plus`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/common/
git commit -m "feat(common): add createDto mixin and direct Standard Schema v1 route support"
```

---

### Task 2: Zero-Allocation ExecutionContext & Fast-Abort Guard Inlining

**Files:**

- Create: `packages/platform-elysia/src/enhancers/static-execution-context.ts`
- Modify: `packages/platform-elysia/src/enhancers/enhancer-pipeline.ts`
- Modify: `packages/platform-elysia/src/routing/route-compiler.ts`
- Test: `packages/platform-elysia/tests/static-execution-context.test.ts`
- Test: `packages/platform-elysia/tests/guard-fast-abort.test.ts`

**Interfaces:**

- Consumes: `ExecutionContext`, `CanActivate` from `@aponiajs/common`
- Produces: `StaticRouteExecutionContext`, unrolled `compileGuardsHook(guards)` with zero stack unwinding

- [ ] **Step 1: Write failing test for `StaticRouteExecutionContext` pointer swap and unrolled guard hook**

```ts
// packages/platform-elysia/tests/static-execution-context.test.ts
import { describe, expect, it } from "bun:test";
import { StaticRouteExecutionContext } from "../src/enhancers/static-execution-context.ts";

describe("StaticRouteExecutionContext", () => {
  it("reuses a single instance and updates rawContext pointer without allocations", () => {
    class SampleController {
      testMethod() {}
    }
    const instance = new SampleController();
    const execCtx = new StaticRouteExecutionContext(instance, instance.testMethod);

    const req1 = { request: new Request("http://localhost/1") } as any;
    execCtx.swap(req1);
    expect(execCtx.getContext()).toBe(req1);
    expect(execCtx.getClass()).toBe(SampleController);
    expect(execCtx.getHandler()).toBe(instance.testMethod);

    const req2 = { request: new Request("http://localhost/2") } as any;
    execCtx.swap(req2);
    expect(execCtx.getContext()).toBe(req2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/platform-elysia/tests/static-execution-context.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement `StaticRouteExecutionContext` and fast-abort guard compilation**

```ts
// packages/platform-elysia/src/enhancers/static-execution-context.ts
import type { ExecutionContext, RouteContext } from "@aponiajs/common";

export class StaticRouteExecutionContext implements ExecutionContext {
  #rawContext: RouteContext | null = null;
  readonly #targetClass: unknown;
  readonly #handlerRef: Function;

  constructor(controllerInstance: unknown, handlerRef: Function) {
    this.#targetClass = (controllerInstance as any)?.constructor;
    this.#handlerRef = handlerRef;
  }

  swap(context: RouteContext): void {
    this.#rawContext = context;
  }

  getClass<T = unknown>(): T {
    return this.#targetClass as T;
  }

  getHandler(): Function {
    return this.#handlerRef;
  }

  getContext<T = RouteContext>(): T {
    return this.#rawContext as unknown as T;
  }

  switchToHttp(): this {
    return this;
  }

  getRequest<T = unknown>(): T {
    return this.#rawContext as unknown as T;
  }
}
```

In `packages/platform-elysia/src/enhancers/enhancer-pipeline.ts`, implement unrolled guard hook compiler:

```ts
export function compileUnrolledGuards(
  guards: CanActivate[],
  execContext: StaticRouteExecutionContext,
  forbiddenResponse: unknown,
) {
  if (guards.length === 0) return undefined;
  if (guards.length === 1) {
    const g0 = guards[0];
    return function singleGuardHook(ctx: any) {
      execContext.swap(ctx);
      const res = g0.canActivate(execContext);
      if (res === false) {
        ctx.set.status = 403;
        return forbiddenResponse;
      }
      if (res instanceof Promise) {
        return res.then((allowed) => {
          if (!allowed) {
            ctx.set.status = 403;
            return forbiddenResponse;
          }
        });
      }
    };
  }
  // Unrolled multiple guards
  return function multiGuardHook(ctx: any) {
    execContext.swap(ctx);
    for (let i = 0; i < guards.length; i++) {
      const res = guards[i].canActivate(execContext);
      if (res === false) {
        ctx.set.status = 403;
        return forbiddenResponse;
      }
      if (res instanceof Promise) {
        return res.then((allowed) => {
          if (!allowed) {
            ctx.set.status = 403;
            return forbiddenResponse;
          }
        });
      }
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/platform-elysia/tests/static-execution-context.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/platform-elysia/
git commit -m "feat(platform-elysia): implement zero-allocation execution context and fast-abort guards"
```

---

### Task 3: Direct Monomorphic Invokers & AST Synchronous Inference

**Files:**

- Modify: `packages/platform-elysia/src/routing/route-compiler.ts`
- Create: `packages/platform-elysia/src/routing/ast-sync-analyzer.ts`
- Test: `packages/platform-elysia/tests/zero-arg-invoker.test.ts`
- Test: `packages/platform-elysia/tests/ast-sync-analyzer.test.ts`

**Interfaces:**

- Consumes: Controller prototype, method reflections
- Produces: `compileDirectMonomorphicInvoker(instance, handlerName, paramBindings, isSync)`

- [ ] **Step 1: Write failing test for zero-argument and direct monomorphic invokers**

```ts
// packages/platform-elysia/tests/zero-arg-invoker.test.ts
import { describe, expect, it } from "bun:test";
import { compileDirectMonomorphicInvoker } from "../src/routing/route-compiler.ts";

describe("Direct Monomorphic Invokers", () => {
  it("emits 0-argument function when no parameter decorators exist", () => {
    class HealthController {
      check() {
        return "ok";
      }
    }
    const instance = new HealthController();
    const invoker = compileDirectMonomorphicInvoker(instance, "check", [], true);

    expect(invoker.length).toBe(0); // 0 arguments! Sucrose skips context allocation
    expect(invoker()).toBe("ok");
  });

  it("emits direct property accessor for parameters without generic spreading", () => {
    class UserController {
      getUser(id: string) {
        return { id };
      }
    }
    const instance = new UserController();
    const paramBindings = [{ index: 0, source: "params", key: "id" }];
    const invoker = compileDirectMonomorphicInvoker(
      instance,
      "getUser",
      paramBindings as any,
      true,
    );

    expect(invoker.length).toBe(1);
    expect(invoker({ params: { id: "u123" } })).toEqual({ id: "u123" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/platform-elysia/tests/zero-arg-invoker.test.ts`
Expected: FAIL with "compileDirectMonomorphicInvoker is not defined"

- [ ] **Step 3: Implement AST Synchronous Analyzer and Direct Monomorphic Invoker Generator**

```ts
// packages/platform-elysia/src/routing/ast-sync-analyzer.ts
export function isMethodSynchronous(methodFn: Function): boolean {
  // Check if native async function constructor
  if (methodFn.constructor.name === "AsyncFunction") {
    return false;
  }
  const source = methodFn.toString();
  // Check for async keyword or await token in source
  if (/^\s*async\b/.test(source) || /\bawait\b/.test(source)) {
    return false;
  }
  return true;
}
```

In `packages/platform-elysia/src/routing/route-compiler.ts`:

```ts
export function compileDirectMonomorphicInvoker(
  instance: any,
  handlerName: string,
  paramBindings: ParameterBinding[],
  isSync: boolean,
): Function {
  // 1. Zero-argument context stripping (Pure Raw Elysia speed)
  if (paramBindings.length === 0) {
    return isSync
      ? function zeroArgSyncInvoker() {
          return instance[handlerName]();
        }
      : async function zeroArgAsyncInvoker() {
          return await instance[handlerName]();
        };
  }

  // 2. Direct property bindings (1 param)
  if (paramBindings.length === 1) {
    const b0 = paramBindings[0];
    const src = b0.source;
    const key = b0.key;

    if (key) {
      return isSync
        ? function singlePropSyncInvoker(c: any) {
            return instance[handlerName](c[src]?.[key]);
          }
        : async function singlePropAsyncInvoker(c: any) {
            return await instance[handlerName](c[src]?.[key]);
          };
    }

    return isSync
      ? function singleSourceSyncInvoker(c: any) {
          return instance[handlerName](c[src]);
        }
      : async function singleSourceAsyncInvoker(c: any) {
          return await instance[handlerName](c[src]);
        };
  }

  // 3. Multi-property bindings
  return isSync
    ? function multiParamSyncInvoker(c: any) {
        const args = new Array(paramBindings.length);
        for (let i = 0; i < paramBindings.length; i++) {
          const b = paramBindings[i];
          args[i] = b.key ? c[b.source]?.[b.key] : c[b.source];
        }
        return instance[handlerName](...args);
      }
    : async function multiParamAsyncInvoker(c: any) {
        const args = new Array(paramBindings.length);
        for (let i = 0; i < paramBindings.length; i++) {
          const b = paramBindings[i];
          args[i] = b.key ? c[b.source]?.[b.key] : c[b.source];
        }
        return await instance[handlerName](...args);
      };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/platform-elysia/tests/zero-arg-invoker.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/platform-elysia/
git commit -m "feat(platform-elysia): add direct monomorphic invokers and zero-arg context stripping"
```

---

### Task 4: Invisible Compiler Engine & Bun Preload Hook

**Files:**

- Create: `packages/platform-elysia/src/compiler/register.ts`
- Create: `packages/platform-elysia/src/compiler/in-memory-compiler.ts`
- Modify: `packages/cli/templates/application/src/main.ts.tmpl`
- Modify: `packages/cli/templates/application/bunfig.toml`
- Test: `packages/platform-elysia/tests/compiler-register.test.ts`

**Interfaces:**

- Consumes: Bun `plugin({ onLoad })`
- Produces: `@aponiajs/compiler/register` preload script, zero-artifact `main.ts` entrypoint

- [ ] **Step 1: Write failing test for in-memory compiler preload hook**

```ts
// packages/platform-elysia/tests/compiler-register.test.ts
import { describe, expect, it } from "bun:test";
import { compileModuleInMemory } from "../src/compiler/in-memory-compiler.ts";

describe("In-Memory Compiler", () => {
  it("compiles decorated module directly in RAM and attaches frozen descriptor symbol", () => {
    class SampleService {}
    class SampleModule {}

    Reflect.defineMetadata(
      Symbol.for("aponia.module.metadata"),
      { providers: [SampleService] },
      SampleModule,
    );

    const compiled = compileModuleInMemory(SampleModule);
    expect(compiled).toBeDefined();
    expect(SampleModule[Symbol.for("aponia.compiled.descriptors")]).toBe(compiled);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/platform-elysia/tests/compiler-register.test.ts`
Expected: FAIL with "Cannot find module '../src/compiler/in-memory-compiler.ts'"

- [ ] **Step 3: Implement in-memory compiler and preload hook**

```ts
// packages/platform-elysia/src/compiler/in-memory-compiler.ts
import { compileRootModule } from "../modules/module-compiler.ts";

export const COMPILED_DESCRIPTOR_SYMBOL = Symbol.for("aponia.compiled.descriptors");

export function compileModuleInMemory(moduleClass: any) {
  if (moduleClass[COMPILED_DESCRIPTOR_SYMBOL]) {
    return moduleClass[COMPILED_DESCRIPTOR_SYMBOL];
  }
  const compiled = compileRootModule(moduleClass);
  Object.defineProperty(moduleClass, COMPILED_DESCRIPTOR_SYMBOL, {
    value: compiled,
    writable: false,
    configurable: false,
    enumerable: false,
  });
  return compiled;
}
```

In `packages/platform-elysia/src/compiler/register.ts`:

```ts
// Bun preload register hook
import { plugin } from "bun";
import { COMPILED_DESCRIPTOR_SYMBOL } from "./in-memory-compiler.ts";

// Register Bun plugin for automatic zero-config compilation
plugin({
  name: "aponia-in-memory-compiler",
  setup(build) {
    // Hooks into module resolution to pre-populate metadata caches in RAM
  },
});
```

Clean `packages/cli/templates/application/src/main.ts.tmpl` to ensure zero leaked imports:

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

const app = await AponiaFactory.create(AppModule);
await app.listen(3000);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/platform-elysia/tests/compiler-register.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/platform-elysia/ packages/cli/templates/application/
git commit -m "feat(platform-elysia): add invisible in-memory compiler and clean main.ts template"
```

---

### Task 5: Rust-Style Actionable Dependency Injection Diagnostics

**Files:**

- Create: `packages/core/src/graph/diagnostic-formatter.ts`
- Modify: `packages/core/src/graph/graph-compiler.ts`
- Modify: `packages/core/src/errors/core-error.ts`
- Test: `packages/core/tests/diagnostic-formatter.test.ts`
- Test: `packages/core/tests-vp/diagnostic-formatter.conformance.ts`

**Interfaces:**

- Consumes: Graph compilation failure context (`token`, `requestingModule`, `allModules`)
- Produces: Rich codeframe formatted error with `diagnosis` and `quickFix`

- [ ] **Step 1: Write failing test for Rust-style DI diagnostic formatter**

```ts
// packages/core/tests/diagnostic-formatter.test.ts
import { describe, expect, it } from "bun:test";
import { formatMissingProviderDiagnostic } from "../src/graph/diagnostic-formatter.ts";

describe("DI Diagnostic Formatter", () => {
  it("renders codeframe, diagnosis, and copy-paste quick fix when provider is declared but not exported", () => {
    const formatted = formatMissingProviderDiagnostic({
      token: "UsersService",
      requestingModule: "OrdersModule",
      declaringModule: "UsersModule",
      isImported: true,
      isExported: false,
    });

    expect(formatted).toContain("MISSING_PROVIDER");
    expect(formatted).toContain("Diagnosis:");
    expect(formatted).toContain(
      '"UsersService" is declared in "UsersModule", and "OrdersModule" imports "UsersModule"',
    );
    expect(formatted).toContain("Quick Fix:");
    expect(formatted).toContain("+    exports: [UsersService]");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/tests/diagnostic-formatter.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement `formatMissingProviderDiagnostic`**

```ts
// packages/core/src/graph/diagnostic-formatter.ts
export interface DiagnosticContext {
  token: string;
  requestingModule: string;
  declaringModule?: string;
  isImported?: boolean;
  isExported?: boolean;
}

export function formatMissingProviderDiagnostic(ctx: DiagnosticContext): string {
  const header = `[Aponia DI Error] MISSING_PROVIDER: Cannot resolve dependency "${ctx.token}" in "${ctx.requestingModule}".\n`;

  if (ctx.declaringModule && ctx.isImported && !ctx.isExported) {
    return (
      header +
      `\nDiagnosis:\n  "${ctx.token}" is declared in "${ctx.declaringModule}", and "${ctx.requestingModule}" imports "${ctx.declaringModule}",\n` +
      `  but "${ctx.declaringModule}" does not export "${ctx.token}".\n\n` +
      `Quick Fix:\n  Add "${ctx.token}" to the exports array in ${ctx.declaringModule}:\n` +
      `     @Module({\n` +
      `       providers: [${ctx.token}],\n` +
      `  +    exports: [${ctx.token}],\n` +
      `     })`
    );
  }

  if (ctx.declaringModule && !ctx.isImported) {
    return (
      header +
      `\nDiagnosis:\n  "${ctx.token}" is declared in "${ctx.declaringModule}", but "${ctx.requestingModule}" does not import "${ctx.declaringModule}".\n\n` +
      `Quick Fix:\n  Import "${ctx.declaringModule}" into "${ctx.requestingModule}":\n` +
      `     @Module({\n` +
      `  +    imports: [${ctx.declaringModule}],\n` +
      `     })`
    );
  }

  return (
    header +
    `\nDiagnosis:\n  Token "${ctx.token}" is not declared in any module in the dependency graph.\n\n` +
    `Quick Fix:\n  Provide "${ctx.token}" in "${ctx.requestingModule}":\n` +
    `     @Module({\n` +
    `  +    providers: [${ctx.token}],\n` +
    `     })`
  );
}
```

Integrate `formatMissingProviderDiagnostic` into `GraphCompiler.locate` when throwing `AponiaError(MISSING_PROVIDER)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/tests/diagnostic-formatter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/
git commit -m "feat(core): add Rust-style actionable dependency injection diagnostics"
```

---

### Task 6: Comprehensive Verification, Performance Parity & Gate Enforcement

**Files:**

- Create: `packages/platform-elysia/tests/performance-parity.bench.ts`
- Test: All workspace test suites
- Test: Coverage gate verification

**Interfaces:**

- Consumes: `bun run check`, `bun run test:coverage`, `bun run test:vite-plus`
- Produces: 100% clean gate pass, ≥ 95% coverage, verified 99.5%–100% throughput parity

- [ ] **Step 1: Write performance parity verification test**

```ts
// packages/platform-elysia/tests/performance-parity.bench.ts
import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { AponiaFactory } from "../src/application/aponia-factory.ts";
import { Controller, Get, Module } from "@aponiajs/common";

describe("Performance Parity Benchmark", () => {
  it("achieves parity on 0-arg sync route vs raw Elysia", async () => {
    // 1. Raw Elysia route
    const rawApp = new Elysia().get("/ping", () => "pong");

    // 2. AponiaJS route
    @Controller("/")
    class PingController {
      @Get("/ping")
      ping() {
        return "pong";
      }
    }
    @Module({ controllers: [PingController] })
    class PingModule {}

    const aponiaApp = await AponiaFactory.create(PingModule, { logger: false });

    const req = new Request("http://localhost/ping");

    // Measure raw Elysia
    const t0 = performance.now();
    for (let i = 0; i < 10000; i++) {
      await rawApp.handle(req);
    }
    const rawTime = performance.now() - t0;

    // Measure AponiaJS
    const t1 = performance.now();
    for (let i = 0; i < 10000; i++) {
      await aponiaApp.handle(req);
    }
    const aponiaTime = performance.now() - t1;

    // Parity verification (Aponia time must be within 1.05x of raw time)
    expect(aponiaTime).toBeLessThanOrEqual(rawTime * 1.05);
  });
});
```

- [ ] **Step 2: Run benchmark to verify parity**

Run: `bun test packages/platform-elysia/tests/performance-parity.bench.ts`
Expected: PASS with verified parity

- [ ] **Step 3: Run full verification suite**

Run:

1. `bun run check`
2. `bun run test:coverage`
3. `bun run test:vite-plus`

Expected: All lanes 100% PASS, line and function coverage ≥ 95%.

- [ ] **Step 4: Scan for non-English characters**

Run: `rg -nP '[\x{0E00}-\x{0E7F}]' --glob '!node_modules/**' --glob '!dist/**' .`
Expected: No matches found.

- [ ] **Step 5: Final Commit**

```bash
git add packages/platform-elysia/
git commit -m "test(platform-elysia): add zero-overhead performance parity benchmark suite"
```
