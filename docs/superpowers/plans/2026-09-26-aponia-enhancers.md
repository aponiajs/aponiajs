# Aponia Execution Enhancers (Phase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add guards, interceptors, and exception filters to AponiaJS, compiled into Elysia's own per-route lifecycle hooks.

**Architecture:** Each enhancer kind maps onto a per-route Elysia hook (`beforeHandle`, `afterHandle`, `onError`) passed through the existing `registerNativeRoute` seam. Nothing wraps the handler, so Elysia's source-static handler compilation and the build-time invoker path are untouched. Enhancer classes are declared providers, resolved once per controller while it mounts.

**Tech Stack:** Bun, TypeScript (strict, ESM, explicit `.ts` extensions), Elysia 1.4.x, `reflect-metadata`, Oxfmt/Oxlint via `bun run check`, Bun test plus a Vite+ conformance lane.

**Spec:** `docs/superpowers/specs/2026-09-26-aponia-enhancers-design.md`

## Global Constraints

- All repository content is English. Before finishing, scan:
  `rg -nP '[\x{0E00}-\x{0E7F}]' --glob '!node_modules/**' --glob '!dist/**' .`
- `@aponiajs/common` stays platform-neutral: never import or reference Elysia, HTTP, or Bun types there.
- `routing/native-route.ts` remains the only module that calls Elysia's route registration API.
- No new runtime dependency is added to any package. No RxJS.
- Return frozen data from public APIs. Use `#private` class fields, not `private`. Keep type-only imports under `import type`.
- Enhancer classes must be declared providers. An undeclared one fails the mount with `MISSING_PROVIDER`.
- Enhancers are singletons, resolved once per controller during mount, never per request.
- Scope order is global, then controller, then method. `interceptAfter` runs in reverse of that order.
- Every new runtime source under `packages/*/src/**/*.ts` must appear in LCOV and keep aggregate line and function coverage at or above 95%.
- Run `bun run check`, `bun run test:coverage`, and `bun run test:vite-plus` before submitting.

## Review Focus

Inputs and conditions the spec implies but whose handling no single task's tests pin. Each line names the behavior a reasonable person expects, and the task that owns its test is named beside it.

1. **A route in an application that also supplies a generated invoker artifact.** Enhancers must apply to a route served by a generated invoker exactly as to one the runtime compiled. Owned by Task 8.
2. **An enhancer named on a WebSocket gateway.** Gateways are providers, not controllers; a `@UseGuards()` on a gateway class must be inert rather than silently applied to a message handler. Owned by Task 3.
3. **A guard class that is declared as a provider in a module the controller's module cannot reach.** This must fail as `MISSING_PROVIDER`, the same code as an undeclared class, not as a different error. Owned by Task 5.
4. **`interceptAfter` when the handler throws.** The after half must not run; the error must reach the filters. Owned by Task 8.
5. **`@UseGuards()` with no arguments, or with a value that is not a class.** A JavaScript caller has no type checker. Owned by Task 2.

---

### Task 0: Verify the two behaviors the spec has not established

The spec names two behaviors that change the design rather than the tests. Both are cheap to probe and both must be settled before any other task starts.

**Files:**

- Modify: `docs/superpowers/specs/2026-09-26-aponia-enhancers-design.md` (the "What this does not yet establish" section)

**Interfaces:**

- Consumes: nothing.
- Produces: a recorded verdict for each behavior. If either fails, stop and report before continuing — the design changes.

- [ ] **Step 1: Probe whether hooks change a route's synchronous classification**

Write a throwaway probe at the repository root. It must register two routes with the same synchronous handler, one with an `afterHandle` hook and one without, and observe what `onAfterHandle` sees for each.

```ts
import { Elysia } from "elysia";

const observations: Record<string, string> = {};

for (const withHook of [false, true]) {
  const label = withHook ? "with afterHandle" : "without afterHandle";
  const app = new Elysia();
  app.onAfterHandle(({ response }) => {
    observations[label] = response instanceof Promise ? "raw Promise" : "resolved value";
  });
  app.route(
    "GET",
    "/sync",
    () => "sync result",
    (withHook ? { afterHandle: () => undefined } : undefined) as never,
  );

  const response = await app.handle(new Request("http://localhost/sync"));
  observations[`${label} body`] = await response.text();
}

console.log(observations);
```

- [ ] **Step 2: Run it and record the result**

Run: `bun .probe-async-classification.ts`

Expected: all four values read `resolved value` / `sync result`. **If either route reports a raw Promise, stop.** The spec's claim that the build-time invoker is unaffected is wrong and the design must be revisited before Task 5.

- [ ] **Step 3: Probe route-local `onError` precedence**

```ts
import { Elysia } from "elysia";

const order: string[] = [];

const app = new Elysia()
  .onError(() => {
    order.push("root");
    return "from root";
  })
  .route(
    "GET",
    "/boom",
    () => {
      throw new Error("exploded");
    },
    {
      onError: () => {
        order.push("route");
        return "from route";
      },
    } as never,
  );

const response = await app.handle(new Request("http://localhost/boom"));
console.log({ order, status: response.status, body: await response.text() });
```

- [ ] **Step 4: Run it and record the result**

Run: `bun .probe-onerror-precedence.ts`

Expected: `order` is `["route"]` and the body is `"from route"`. **If the root handler also runs, or runs first, stop**: the default filter cannot sit behind declared filters, and the fallback described in the spec must be designed before Task 7.

- [ ] **Step 5: Delete both probes and record the verdicts in the spec**

```bash
rm -f .probe-async-classification.ts .probe-onerror-precedence.ts
```

Replace the "What this does not yet establish" section with the two verdicts, stating for each what was run and what it returned. If a verdict contradicts the design, say so in the section and stop rather than editing the design to match.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-09-26-aponia-enhancers-design.md
git commit -m "docs(enhancers): record the two probed behaviors"
```

---

### Task 1: Enhancer contracts in `@aponiajs/common`

Type-only public contracts. This task has no runtime behavior, so its evidence is compile-time assertions in the conformance lane plus the `bun run check` gate.

**Files:**

- Create: `packages/common/src/enhancers/enhancer.types.ts`
- Create: `packages/common/tests-vp/enhancer-contracts.conformance.ts`
- Modify: `packages/common/src/index.ts` (add exports)
- Modify: `packages/common/AGENTS.md` (add the `enhancers/` row to the domain table)

**Interfaces:**

- Consumes: `ClassToken`, `RouteContext`, `RequestMethod` from existing `common` modules.
- Produces: `CanActivate`, `AponiaInterceptor`, `ExceptionFilter`, `ArgumentsHost`, `ExecutionContext`, `HttpArgumentsHost`, all exported from `@aponiajs/common`.

- [ ] **Step 1: Write the contract types**

```ts
// packages/common/src/enhancers/enhancer.types.ts
import type { RequestMethod } from "../decorators/decorators.types.ts";
import type { RouteContext } from "../routing/route-schema.types.ts";
import type { ClassToken } from "../tokens/token.types.ts";

/**
 * What a guard, an interceptor, and a filter are given about the route they
 * are running for.
 *
 * The request accessor returns `RouteContext`, the platform-neutral description
 * this framework already publishes, rather than a platform type: `common` may
 * not reference Elysia.
 */
export interface HttpArgumentsHost {
  getRequest(): RouteContext;
}

/**
 * What a filter is given. One transport exists, so the per-transport dispatch
 * Nest's `ArgumentsHost` performs is not carried: `switchToHttp()` is the only
 * switch, and it is a thin alias over `getContext()` kept because migrated Nest
 * code calls it on nearly every guard.
 */
export interface ArgumentsHost {
  getContext(): RouteContext;
  switchToHttp(): HttpArgumentsHost;
}

/** What a guard and an interceptor are given. */
export interface ExecutionContext extends ArgumentsHost {
  getClass<T>(): ClassToken<T>;
  getHandler(): (...arguments_: never[]) => unknown;
  getRoute(): Readonly<{ readonly method: RequestMethod; readonly path: string }>;
}

export interface CanActivate {
  canActivate(context: ExecutionContext): boolean | Promise<boolean>;
}

/**
 * An interceptor's two halves.
 *
 * Nest's `intercept(context, next)` with `next.handle()` is deliberately not
 * carried: a callable `next` requires owning the handler invocation, which
 * forfeits Elysia's source-static handler compilation for every route carrying
 * an enhancer. See the design document.
 */
export interface AponiaInterceptor {
  interceptBefore?(context: ExecutionContext): void | Promise<void>;
  interceptAfter?(context: ExecutionContext, response: unknown): unknown | Promise<unknown>;
}

export interface ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): unknown | Promise<unknown>;
}
```

- [ ] **Step 2: Export the contracts from the barrel**

Add to `packages/common/src/index.ts`, keeping the file's existing grouping:

```ts
export type {
  AponiaInterceptor,
  ArgumentsHost,
  CanActivate,
  ExceptionFilter,
  ExecutionContext,
  HttpArgumentsHost,
} from "./enhancers/enhancer.types.ts";
```

- [ ] **Step 3: Write the conformance file with compile-time assertions**

```ts
// packages/common/tests-vp/enhancer-contracts.conformance.ts
import { describe, expect, test } from "vitest";
import type {
  AponiaInterceptor,
  ArgumentsHost,
  CanActivate,
  ExceptionFilter,
  ExecutionContext,
} from "@aponiajs/common";

class ExampleGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}

class AsyncExampleGuard implements CanActivate {
  async canActivate(_context: ExecutionContext): Promise<boolean> {
    return true;
  }
}

class ExampleInterceptor implements AponiaInterceptor {
  interceptBefore(_context: ExecutionContext): void {}
  interceptAfter(_context: ExecutionContext, response: unknown): unknown {
    return response;
  }
}

class ExampleFilter implements ExceptionFilter {
  catch(_exception: unknown, _host: ArgumentsHost): unknown {
    return undefined;
  }
}

describe("enhancer contracts", () => {
  test("accept a synchronous and an asynchronous guard", () => {
    const guards: readonly CanActivate[] = [new ExampleGuard(), new AsyncExampleGuard()];
    expect(guards).toHaveLength(2);
  });

  test("accept an interceptor declaring either half alone", () => {
    const onlyBefore: AponiaInterceptor = { interceptBefore: () => undefined };
    const onlyAfter: AponiaInterceptor = { interceptAfter: (_c, response) => response };
    expect([onlyBefore, onlyAfter]).toHaveLength(2);
  });

  test("accept a filter taking an ArgumentsHost", () => {
    const filters: readonly ExceptionFilter[] = [new ExampleFilter()];
    expect(filters).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Run the conformance lane**

Run: `bun run test:vite-plus`
Expected: PASS, including the three new cases.

- [ ] **Step 5: Run the type gate**

Run: `bun run check`
Expected: no errors. A contract that is too narrow for one of the reference implementations fails here.

- [ ] **Step 6: Commit**

```bash
git add packages/common/src/enhancers/enhancer.types.ts packages/common/src/index.ts packages/common/tests-vp/enhancer-contracts.conformance.ts packages/common/AGENTS.md
git commit -m "feat(common): add the enhancer contracts"
```

---

### Task 2: Enhancer decorators and their metadata

**Files:**

- Create: `packages/common/src/enhancers/enhancer-decorators.ts`
- Create: `packages/common/src/enhancers/enhancer-decorators.types.ts`
- Create: `packages/common/tests/enhancer-decorators.test.ts`
- Modify: `packages/common/src/index.ts`

**Interfaces:**

- Consumes: `ClassToken` from `../tokens/token.types.ts`.
- Produces: `UseGuards`, `UseInterceptors`, `UseFilters`, `Catch`, `getEnhancerMetadata`, and the `EnhancerMetadata` type.

- [ ] **Step 1: Write the failing test**

```ts
// packages/common/tests/enhancer-decorators.test.ts
import { describe, expect, test } from "bun:test";
import {
  Catch,
  UseFilters,
  UseGuards,
  UseInterceptors,
  getEnhancerMetadata,
} from "@aponiajs/common";

class AuthGuard {}
class OwnerGuard {}
class TimingInterceptor {}

class NotFoundError extends Error {}

@Catch(NotFoundError)
class NotFoundFilter {}

@UseGuards(AuthGuard)
@UseInterceptors(TimingInterceptor)
class GuardedController {
  @UseGuards(OwnerGuard)
  @UseFilters(NotFoundFilter)
  read(): string {
    return "read";
  }

  unguarded(): string {
    return "unguarded";
  }
}

describe("enhancer decorators", () => {
  test("records guards declared on the controller", () => {
    const metadata = getEnhancerMetadata(GuardedController);

    expect(metadata.guards).toEqual([AuthGuard]);
  });

  test("records method enhancers against the method's own key", () => {
    const metadata = getEnhancerMetadata(GuardedController, "read");

    expect(metadata.guards).toEqual([OwnerGuard]);
    expect(metadata.filters).toEqual([NotFoundFilter]);
  });

  test("records the error types @Catch named on the filter class itself", () => {
    expect(getCatchMetadata(NotFoundFilter)).toEqual([NotFoundError]);
  });

  test("reports an empty catch list for a filter that declares none", () => {
    class CatchAllFilter {}

    expect(getCatchMetadata(CatchAllFilter)).toEqual([]);
  });

  test("reports empty collections for a method that declares none", () => {
    const metadata = getEnhancerMetadata(GuardedController, "unguarded");

    expect(metadata).toEqual({ guards: [], interceptors: [], filters: [] });
  });

  test("reports empty collections for a class that declares none", () => {
    class Plain {}

    expect(getEnhancerMetadata(Plain)).toEqual({ guards: [], interceptors: [], filters: [] });
  });

  test("rejects a value that is not a class", () => {
    expect(() => UseGuards("not a class" as never)).toThrow(TypeError);
  });

  test("rejects a call with no arguments", () => {
    expect(() => UseGuards()).toThrow(TypeError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/common/tests/enhancer-decorators.test.ts`
Expected: FAIL — `getEnhancerMetadata` is not exported.

- [ ] **Step 3: Write the types**

```ts
// packages/common/src/enhancers/enhancer-decorators.types.ts
import type { ClassToken } from "../tokens/token.types.ts";

/**
 * The enhancers a class or one of its methods declares, in declaration order.
 *
 * Every entry is the class itself. A filter's matched types are not held here:
 * `@Catch(...)` decorates the filter class, so they are read from that class
 * through `getCatchMetadata` when the filter is resolved. Keeping one copy of
 * the fact is what makes `@UseFilters(SomeFilter)` behave the same however it
 * is written.
 */
export interface EnhancerMetadata {
  readonly guards: readonly ClassToken<unknown>[];
  readonly interceptors: readonly ClassToken<unknown>[];
  readonly filters: readonly ClassToken<unknown>[];
}
```

- [ ] **Step 4: Write the decorators**

```ts
// packages/common/src/enhancers/enhancer-decorators.ts
import "reflect-metadata";
import type { ClassToken } from "../tokens/token.types.ts";
import type { EnhancerMetadata } from "./enhancer-decorators.types.ts";

const enhancerMetadataKey = Symbol.for("aponia.enhancers.metadata");
const catchMetadataKey = Symbol.for("aponia.enhancers.catch.metadata");
const emptyMetadata: EnhancerMetadata = Object.freeze({
  guards: Object.freeze([]),
  interceptors: Object.freeze([]),
  filters: Object.freeze([]),
});

type EnhancerKind = "guards" | "interceptors";

export function UseGuards(
  ...guards: readonly ClassToken<unknown>[]
): ClassDecorator & MethodDecorator {
  return createEnhancerDecorator("guards", guards);
}

export function UseInterceptors(
  ...interceptors: readonly ClassToken<unknown>[]
): ClassDecorator & MethodDecorator {
  return createEnhancerDecorator("interceptors", interceptors);
}

export function UseFilters(
  ...filters: readonly ClassToken<unknown>[]
): ClassDecorator & MethodDecorator {
  return createEnhancerDecorator("filters", filters);
}

/**
 * Names the error types a filter answers. Applied to the filter class, exactly
 * as Nest applies it. `@Catch()` with no arguments matches anything.
 */
export function Catch(...exceptions: readonly unknown[]): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(catchMetadataKey, Object.freeze([...exceptions]), target);
  };
}

/**
 * The types a filter answers, or an empty list when it declared none, which
 * means it catches anything.
 */
export function getCatchMetadata(filter: ClassToken<unknown>): readonly unknown[] {
  return (Reflect.getOwnMetadata(catchMetadataKey, filter) as readonly unknown[] | undefined) ?? [];
}

export function getEnhancerMetadata(
  target: ClassToken<unknown>,
  propertyKey?: string | symbol,
): EnhancerMetadata {
  const onClass = Reflect.getOwnMetadata(enhancerMetadataKey, target) as
    Partial<EnhancerMetadata> | undefined;
  if (propertyKey === undefined) {
    return mergeMetadata(onClass);
  }

  const onPrototype = Reflect.getOwnMetadata(enhancerMetadataKey, target.prototype) as
    ReadonlyMap<string | symbol, Partial<EnhancerMetadata>> | undefined;

  return mergeMetadata(onClass, onPrototype?.get(propertyKey));
}

function mergeMetadata(
  ...sources: readonly (Partial<EnhancerMetadata> | undefined)[]
): EnhancerMetadata {
  return Object.freeze({
    guards: Object.freeze(sources.flatMap((source) => source?.guards ?? [])),
    interceptors: Object.freeze(sources.flatMap((source) => source?.interceptors ?? [])),
    filters: Object.freeze(sources.flatMap((source) => source?.filters ?? [])),
  });
}

function createEnhancerDecorator<TEntry>(
  kind: EnhancerKind | "filters",
  entries: readonly TEntry[],
): ClassDecorator & MethodDecorator {
  if (entries.length === 0) {
    throw new TypeError(`@Use${kind} needs at least one enhancer.`);
  }
  for (const entry of entries) {
    const candidate = entry;
    if (typeof candidate !== "function") {
      throw new TypeError(`@Use${kind} accepts enhancer classes only.`);
    }
  }

  return ((target: object, propertyKey?: string | symbol) => {
    const holder = propertyKey === undefined ? (target as ClassToken<unknown>) : target;
    const existing =
      (Reflect.getOwnMetadata(enhancerMetadataKey, holder) as
        | Partial<EnhancerMetadata>
        | ReadonlyMap<string | symbol, Partial<EnhancerMetadata>>
        | undefined) ?? new Map<string | symbol, Partial<EnhancerMetadata>>();

    if (propertyKey === undefined) {
      const onClass = (existing as Partial<EnhancerMetadata>) ?? {};
      Reflect.defineMetadata(
        enhancerMetadataKey,
        { ...onClass, [kind]: [...(onClass[kind] ?? []), ...entries] },
        holder,
      );
      return;
    }

    const byMethod =
      existing instanceof Map ? existing : new Map<string | symbol, Partial<EnhancerMetadata>>();
    const current = byMethod.get(propertyKey) ?? {};
    byMethod.set(propertyKey, {
      ...current,
      [kind]: [...(current[kind] ?? []), ...entries],
    });
    Reflect.defineMetadata(enhancerMetadataKey, byMethod, holder);
  }) as ClassDecorator & MethodDecorator;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test packages/common/tests/enhancer-decorators.test.ts`
Expected: PASS, six cases.

- [ ] **Step 6: Export from the barrel**

Add to `packages/common/src/index.ts`:

```ts
export {
  Catch,
  UseFilters,
  UseGuards,
  UseInterceptors,
  getCatchMetadata,
  getEnhancerMetadata,
} from "./enhancers/enhancer-decorators.ts";
export type { EnhancerMetadata } from "./enhancers/enhancer-decorators.types.ts";
```

- [ ] **Step 7: Run the gate and commit**

```bash
bun run check
git add packages/common/src/enhancers packages/common/src/index.ts packages/common/tests/enhancer-decorators.test.ts
git commit -m "feat(common): add the enhancer decorators"
```

---

### Task 3: Carry enhancer declarations on a compiled route

Both authoring paths must produce the same compiled shape.

**Files:**

- Modify: `packages/platform-elysia/src/routing/route-compiler.types.ts`
- Modify: `packages/platform-elysia/src/routing/route-compiler.ts` (`compileElysiaRoutes`)
- Modify: `packages/platform-elysia/src/routing/route-plan.types.ts` (`ElysiaRoutePlan`)
- Modify: `packages/platform-elysia/src/controllers/controller-definition.ts` (`compileElysiaRoutePlan`)
- Create: `packages/platform-elysia/tests/route-enhancers.test.ts`

**Interfaces:**

- Consumes: `getEnhancerMetadata`, `getCatchMetadata`, `EnhancerMetadata` from Task 2.
- Produces: `CompiledElysiaRoute.enhancers: EnhancerMetadata`. Both compilers populate it; a route that declares none carries the frozen empty metadata.

- [ ] **Step 1: Write the failing test**

```ts
// packages/platform-elysia/tests/route-enhancers.test.ts
import { describe, expect, test } from "bun:test";
import { Controller, Get, Injectable, Module, UseGuards } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";

class AuthGuard {
  canActivate(): boolean {
    return true;
  }
}

@Injectable()
@UseGuards(AuthGuard)
@Controller("plain")
class PlainController {
  @Get()
  read(): string {
    return "read";
  }
}

@Controller("open")
class OpenController {
  @Get()
  read(): string {
    return "open";
  }
}

@Module({ controllers: [PlainController, OpenController], providers: [AuthGuard] })
class AppModule {}

describe("compiled route enhancers", () => {
  test("a controller that declares no enhancer mounts no lifecycle hook", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });
    const open = application
      .getNativeApplication()
      .routes.find((route) => route.path === "/open") as
      { hooks?: Record<string, unknown> } | undefined;

    expect(open?.hooks?.beforeHandle).toBeUndefined();
    expect(open?.hooks?.afterHandle).toBeUndefined();
    await application.close();
  });

  test("a controller that declares a guard still mounts without error", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });

    expect(application.getNativeApplication().routes.map((route) => route.path)).toContain(
      "/plain",
    );
    await application.close();
  });
});
```

This task adds no mounted behavior, so its test proves the property that must not change: a controller declaring no enhancer still mounts a route carrying no lifecycle hooks. The proof that a declared enhancer reaches the route arrives with the enhancer itself — Task 6 for guards, Task 7 for filters, Task 8 for interceptors. Until then the second case only pins that compilation accepts the declaration.

- [ ] **Step 2: Run it to verify it fails or passes for the wrong reason**

Run: `bun test packages/platform-elysia/tests/route-enhancers.test.ts`
Expected: FAIL — `UseGuards` has no effect on the compiled route, so the assertion the test is a placeholder for cannot be written yet.

- [ ] **Step 3: Extend the compiled route type**

In `packages/platform-elysia/src/routing/route-compiler.types.ts`:

```ts
import type { EnhancerMetadata } from "@aponiajs/common";

export interface CompiledElysiaRoute {
  readonly method: RequestMethod;
  readonly path: string;
  readonly propertyKey: string | symbol;
  readonly parameters: readonly RouteParameterMetadata[];
  readonly capabilities: readonly RouteParameterKind[];
  readonly schema: RouteSchema | undefined;
  readonly declaredParameterCount: number | undefined;
  readonly declaredReturnKind: "promise" | "synchronous" | "unknown";
  /** The enhancers this route declares, before any global ones are merged. */
  readonly enhancers: EnhancerMetadata;
}
```

- [ ] **Step 4: Populate it in the decorated compiler**

In `compileElysiaRoutes`, add to the returned frozen object:

```ts
enhancers: mergeEnhancerMetadata(
  getEnhancerMetadata(controller),
  getEnhancerMetadata(controller, route.propertyKey),
),
```

with a local helper that concatenates the three collections from a class-level and a method-level reading in that order. Add `getEnhancerMetadata` and `EnhancerMetadata` to the `@aponiajs/common` import at the top of the file.

- [ ] **Step 5: Populate it in the declared-plan compiler**

Add to `ElysiaRoutePlan`:

```ts
/** Guards this route declares, as classes the container resolves. */
readonly guards?: readonly ClassToken<unknown>[];
/** Interceptors this route declares, as classes the container resolves. */
readonly interceptors?: readonly ClassToken<unknown>[];
/** Filters this route declares. Each filter's matched types come from its own `@Catch()`. */
readonly filters?: readonly ClassToken<unknown>[];
```

and in `compileElysiaRoutePlan`:

```ts
enhancers: Object.freeze({
  guards: Object.freeze([...(plan.guards ?? [])]),
  interceptors: Object.freeze([...(plan.interceptors ?? [])]),
  filters: Object.freeze([...(plan.filters ?? [])]),
}),
```

- [ ] **Step 6: Run the tests and the gate**

Run: `bun test packages/platform-elysia/tests/route-enhancers.test.ts && bun run check`
Expected: PASS. A route on a controller that declares nothing carries the frozen empty metadata, so nothing about its mount changes.

- [ ] **Step 7: Pin that a gateway ignores enhancer decorators**

Gateways are class providers, not controllers, and a message handler is not a route. Add a case declaring `@UseGuards(...)` on a `@WebSocketGateway()` class and assert the gateway still registers and answers its event normally. A guard decorator on a gateway must be inert, not silently applied to message dispatch. This is Review Focus item 2.

- [ ] **Step 8: Commit**

```bash
git add packages/platform-elysia/src/routing packages/platform-elysia/src/controllers packages/platform-elysia/tests/route-enhancers.test.ts
git commit -m "feat(platform-elysia): carry enhancer declarations on a compiled route"
```

---

### Task 4: Global enhancers as application options

**Files:**

- Modify: `packages/platform-elysia/src/application/application.types.ts`
- Modify: `packages/platform-elysia/src/application/application-bootstrap.ts`
- Create: `packages/platform-elysia/tests/global-enhancers.test.ts`

**Interfaces:**

- Consumes: `EnhancerMetadata` from Task 2, `CompiledElysiaRoute.enhancers` from Task 3.
- Produces: `AponiaApplicationOptions.guards`, `.interceptors`, `.filters`, each `readonly ClassToken<unknown>[] | undefined`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/platform-elysia/tests/global-enhancers.test.ts
import { describe, expect, test } from "bun:test";
import { Controller, Get, Injectable, Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";

const seen: string[] = [];

@Injectable()
class GlobalGuard {
  canActivate(): boolean {
    seen.push("global");
    return true;
  }
}

@Controller()
class AppController {
  @Get()
  read(): string {
    return "read";
  }
}

@Module({ controllers: [AppController], providers: [GlobalGuard] })
class AppModule {}

describe("global enhancers", () => {
  test("an option-level guard runs for a controller that declares none", async () => {
    const application = await AponiaFactory.create(AppModule, {
      logger: false,
      guards: [GlobalGuard],
    });

    const response = await application.handle(new Request("http://localhost/"));

    expect([response.status, await response.text()]).toEqual([200, "read"]);
    expect(seen).toEqual(["global"]);
    await application.close();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/platform-elysia/tests/global-enhancers.test.ts`
Expected: FAIL — `guards` is not an accepted option, and `seen` stays empty.

- [ ] **Step 3: Add the options**

In `AponiaApplicationOptions`:

```ts
/**
 * Guards every route runs, before any a controller or a handler declares.
 *
 * There is deliberately no `useGlobalGuards()` method: routes mount during
 * `AponiaFactory.create`, so a method called on the returned application could
 * not affect them.
 */
readonly guards?: readonly ClassToken<unknown>[];
readonly interceptors?: readonly ClassToken<unknown>[];
readonly filters?: readonly ClassToken<unknown>[];
```

- [ ] **Step 4: Thread them to the mount**

In `application-bootstrap.ts`, build the global metadata once before the controller loop:

```ts
const globalEnhancers: EnhancerMetadata = Object.freeze({
  guards: Object.freeze([...(options.guards ?? [])]),
  interceptors: Object.freeze([...(options.interceptors ?? [])]),
  filters: Object.freeze([...(options.filters ?? [])]),
});
```

and pass it into `registerControllerRoutes`, which forwards it to `registerElysiaControllerRoutes` and `registerCompiledElysiaRoutes`. Do not merge it into the compiled routes: the compiled plan is the controller's own declaration and stays that way.

- [ ] **Step 5: Run it to verify it passes**

Run: `bun test packages/platform-elysia/tests/global-enhancers.test.ts`
Expected: PASS. (`canActivate` is not consulted yet — this task only proves the option reaches the mount.)

- [ ] **Step 6: Run the lane and commit**

```bash
bun run --filter @aponiajs/platform-elysia test
git add packages/platform-elysia/src/application packages/platform-elysia/tests/global-enhancers.test.ts
git commit -m "feat(platform-elysia): accept global enhancers as application options"
```

---

### Task 5: Resolve enhancer instances from the container

**Files:**

- Create: `packages/platform-elysia/src/controllers/enhancer-resolver.ts`
- Create: `packages/platform-elysia/tests/enhancer-resolution.test.ts`
- Modify: `packages/platform-elysia/src/application/application-bootstrap.ts`

**Interfaces:**

- Consumes: `AponiaContainer.resolveModuleProvider(module, token)`; `getCatchMetadata` from Task 2.
- Produces: `resolveEnhancers(container, module, metadata): ResolvedEnhancers`, where each collection holds instances in declaration order and an undeclared or unreachable class raises `MISSING_PROVIDER`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/platform-elysia/tests/enhancer-resolution.test.ts
import { describe, expect, test } from "bun:test";
import { Controller, Get, Injectable, Module, UseGuards } from "@aponiajs/common";
import { AponiaFactory, type AponiaError } from "@aponiajs/platform-elysia";

@Injectable()
class UndeclaredGuard {
  canActivate(): boolean {
    return true;
  }
}

@Injectable()
class DeclaredGuard {
  canActivate(): boolean {
    return true;
  }
}

@Controller("a")
@UseGuards(UndeclaredGuard)
class AController {
  @Get()
  read(): string {
    return "a";
  }
}

@Controller("b")
@UseGuards(DeclaredGuard)
class BController {
  @Get()
  read(): string {
    return "b";
  }
}

@Module({ controllers: [AController, BController], providers: [DeclaredGuard] })
class AppModule {}

describe("enhancer resolution", () => {
  test("an undeclared enhancer class fails the mount with MISSING_PROVIDER", async () => {
    await expect(AponiaFactory.create(AppModule, { logger: false })).rejects.toMatchObject({
      code: "MISSING_PROVIDER",
    });
  });
});
```

Split into two modules while implementing if `AController`'s failure prevents the second case from being observed at all: the second case is a separate `AppModule` whose controller declares only `DeclaredGuard` and inside which every route mounts.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/platform-elysia/tests/enhancer-resolution.test.ts`
Expected: FAIL — the mount succeeds because nothing resolves the declared guard yet.

- [ ] **Step 3: Write the resolver**

```ts
// packages/platform-elysia/src/controllers/enhancer-resolver.ts
import type { AponiaContainer } from "@aponiajs/core";
import type { ClassToken, EnhancerMetadata, ModuleDefinition } from "@aponiajs/common";

export interface ResolvedFilter {
  readonly instance: ExceptionFilter;
  readonly catch: readonly unknown[];
}

export interface ResolvedEnhancers {
  readonly guards: readonly CanActivate[];
  readonly interceptors: readonly AponiaInterceptor[];
  readonly filters: readonly ResolvedFilter[];
}

/**
 * Every enhancer a controller declares, resolved once while that controller
 * mounts.
 *
 * Resolution goes through `resolveModuleProvider`, the same function the
 * container resolves every other dependency through, so an enhancer is subject
 * to the module graph's visibility rules and an undeclared or unreachable class
 * raises the same `MISSING_PROVIDER` a missing provider does.
 */
export function resolveEnhancers(
  container: AponiaContainer,
  module: ModuleDefinition,
  metadata: EnhancerMetadata,
): ResolvedEnhancers {
  return Object.freeze({
    guards: Object.freeze(
      metadata.guards.map((guard) => resolveOne<CanActivate>(container, module, guard)),
    ),
    interceptors: Object.freeze(
      metadata.interceptors.map((interceptor) =>
        resolveOne<AponiaInterceptor>(container, module, interceptor),
      ),
    ),
    filters: Object.freeze(
      metadata.filters.map((filter) => resolveFilter(container, module, filter)),
    ),
  });
}

function resolveOne<T>(
  container: AponiaContainer,
  module: ModuleDefinition,
  token: ClassToken<unknown>,
): T {
  return container.resolveModuleProvider(module, token) as T;
}

function resolveFilter(
  container: AponiaContainer,
  module: ModuleDefinition,
  filter: ClassToken<unknown>,
): ResolvedFilter {
  return Object.freeze({
    instance: resolveOne<ExceptionFilter>(container, module, filter),
    catch: getCatchMetadata(filter),
  });
}
```

- [ ] **Step 4: Call it while a controller mounts**

In `application-bootstrap.ts`, after `container.instantiateController(module, controller)` and before the routes are registered:

```ts
const enhancers = resolveEnhancers(container, module, compiledEnhancers);
```

where `compiledEnhancers` is the controller's class-level metadata merged with each route's own. Resolve **once per controller**, not per route: an enhancer is a singleton, and resolving twice would surface a second time in a resolution-count test.

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test packages/platform-elysia/tests/enhancer-resolution.test.ts`
Expected: PASS, `MISSING_PROVIDER`.

- [ ] **Step 6: Add the unreachable-module case**

Add a module that declares the guard but does not export it, imported by a module whose controller uses it. Assert the same `MISSING_PROVIDER`. This is Review Focus item 3.

- [ ] **Step 7: Run the lane and commit**

```bash
bun run --filter @aponiajs/platform-elysia test
git add packages/platform-elysia/src/controllers/enhancer-resolver.ts packages/platform-elysia/src/application packages/platform-elysia/tests/enhancer-resolution.test.ts
git commit -m "feat(platform-elysia): resolve enhancer instances while a controller mounts"
```

---

### Task 6: Guards, end to end

**Files:**

- Modify: `packages/platform-elysia/src/routing/route-compiler.ts` (the hook builder)
- Create: `packages/platform-elysia/tests/guards.test.ts`
- Modify: `packages/platform-elysia/AGENTS.md`

**Interfaces:**

- Consumes: `ResolvedEnhancers` from Task 5.
- Produces: a route-local `beforeHandle` that runs guards in order and refuses with a Problem Details 403.

- [ ] **Step 1: Write the failing test**

```ts
// packages/platform-elysia/tests/guards.test.ts
import { describe, expect, test } from "bun:test";
import { Controller, Get, Injectable, Module, UseGuards } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";

const calls: string[] = [];

@Injectable()
class AllowGuard {
  canActivate(): boolean {
    calls.push("allow");
    return true;
  }
}

@Injectable()
class DenyGuard {
  canActivate(): boolean {
    calls.push("deny");
    return false;
  }
}

@Injectable()
class AsyncDenyGuard {
  async canActivate(): Promise<boolean> {
    calls.push("async-deny");
    return false;
  }
}

@Controller("open")
class OpenController {
  @Get()
  read(): string {
    calls.push("handler");
    return "read";
  }
}

@Controller("denied")
@UseGuards(DenyGuard)
class DeniedController {
  @Get()
  read(): string {
    calls.push("handler");
    return "read";
  }
}

@Controller("ordered")
@UseGuards(AllowGuard, AsyncDenyGuard)
class OrderedController {
  @Get()
  read(): string {
    calls.push("handler");
    return "read";
  }
}

@Module({
  controllers: [OpenController, DeniedController, OrderedController],
  providers: [AllowGuard, DenyGuard, AsyncDenyGuard],
})
class AppModule {}

describe("guards", () => {
  test("a refusing guard answers Problem Details 403 and never calls the handler", async () => {
    calls.length = 0;
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/denied"));

    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(calls).toEqual(["deny"]);
    await application.close();
  });

  test("guards run in declaration order and an async guard can refuse", async () => {
    calls.length = 0;
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/ordered"));

    expect(response.status).toBe(403);
    expect(calls).toEqual(["allow", "async-deny"]);
    await application.close();
  });

  test("a controller with no guards calls its handler and records nothing", async () => {
    calls.length = 0;
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/open"));

    expect([response.status, await response.text()]).toEqual([200, "read"]);
    expect(calls).toEqual(["handler"]);
    await application.close();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/platform-elysia/tests/guards.test.ts`
Expected: FAIL — `/denied` answers 200 and the handler runs.

- [ ] **Step 3: Build the guard hook**

Extend the route hook builder so that, when `resolved.guards.length > 0`, the emitted hook object gains:

```ts
beforeHandle: async (context: RouteContext) => {
  for (const guard of guards) {
    if ((await guard.canActivate(executionContextFor(context))) === false) {
      throw httpErrors.forbidden("A guard refused this request.");
    }
  }
  return undefined;
},
```

The `throw` is the whole refusal: Elysia handles a thrown error carrying `toResponse()` through its native path, which `packages/platform-elysia/README.md` states and `tests/http-error.test.ts` pins, so the response is already Problem Details with `403` before this task adds anything. **No error hook is registered in this task.** Task 7's default filter is what maps errors that are _not_ `HttpError`, and it leaves this path returning what it returns today.

`executionContextFor(context)` builds the `ExecutionContext` from the compiled route, the controller token, and the context. Build it once per request at most: construct the object lazily so a route with no enhancers never allocates one.

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test packages/platform-elysia/tests/guards.test.ts`
Expected: PASS, three cases.

- [ ] **Step 5: Add the no-enhancer regression case**

Add to the same file a case asserting a controller with no enhancers mounts a route whose hook object is `undefined` when it declares no schema — the property the spec's Testing section pins. Read it through `application.getNativeApplication().routes` and assert no `beforeHandle` is present.

- [ ] **Step 6: Cover the declared-descriptor path**

Add a case using `defineElysiaControllerRoutes` with `guards` in the plan, asserting the same 403. Both authoring paths must produce the same mounted behavior.

- [ ] **Step 7: Run the gates and commit**

```bash
bun run check && bun run test:coverage
git add packages/platform-elysia/src/routing/route-compiler.ts packages/platform-elysia/tests/guards.test.ts packages/platform-elysia/AGENTS.md
git commit -m "feat(platform-elysia): run guards as a route-local beforeHandle"
```

---

### Task 7: Exception filters and the default Problem Details mapping

**Files:**

- Create: `packages/platform-elysia/src/errors/default-exception-filter.ts`
- Create: `packages/platform-elysia/tests/exception-filters.test.ts`
- Modify: `packages/platform-elysia/src/application/application-bootstrap.ts`
- Modify: `docs/architecture-and-style.md` or the errors section of the platform guide, wherever the Problem Details mapping is described

**Interfaces:**

- Consumes: `ResolvedEnhancers.filters` from Task 5, `HttpError`/`httpErrors` from `errors/`.
- Produces: `isFilterMatch(filterClass, exception): boolean`, reading the class's own `@Catch()` metadata, and `registerDefaultExceptionFilter(application, logger): void`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/platform-elysia/tests/exception-filters.test.ts
import { describe, expect, test } from "bun:test";
import { Catch, Controller, Get, Injectable, Module, UseFilters } from "@aponiajs/common";
import { AponiaFactory, httpErrors } from "@aponiajs/platform-elysia";

class NotFoundError extends Error {}

@Catch(NotFoundError)
@Injectable()
class NotFoundFilter {
  catch(): unknown {
    return new Response("handled by filter", { status: 404 });
  }
}

@Catch()
@Injectable()
class CatchAllFilter {
  catch(): unknown {
    return new Response("caught anything", { status: 503 });
  }
}

@Catch()
@Injectable()
class UndecidedFilter {
  catch(): unknown {
    return undefined;
  }
}

@Controller("mapped")
@UseFilters(NotFoundFilter)
class MappedController {
  @Get("missing")
  missing(): string {
    throw new NotFoundError("nope");
  }

  @Get("plain")
  plain(): string {
    throw new Error("unmapped");
  }
}

@Controller("all")
@UseFilters(CatchAllFilter)
class AllController {
  @Get()
  boom(): string {
    throw new Error("anything");
  }
}

@Controller("undecided")
@UseFilters(UndecidedFilter)
class UndecidedController {
  @Get()
  boom(): string {
    throw new Error("still unmapped");
  }
}

@Controller("http")
class HttpController {
  @Get()
  forbidden(): string {
    throw httpErrors.forbidden("no");
  }
}

@Module({
  controllers: [MappedController, AllController, UndecidedController, HttpController],
  providers: [NotFoundFilter, CatchAllFilter, UndecidedFilter],
})
class AppModule {}

describe("exception filters", () => {
  test("a filter answers the type @Catch named", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/mapped/missing"));

    expect([response.status, await response.text()]).toEqual([404, "handled by filter"]);
    await application.close();
  });

  test("an unhandled error becomes Problem Details without leaking the stack", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/mapped/plain"));
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(body).not.toContain("unmapped");
    expect(body).not.toContain("at ");
    await application.close();
  });

  test("@Catch() with no arguments answers anything", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/all"));

    expect([response.status, await response.text()]).toEqual([503, "caught anything"]);
    await application.close();
  });

  test("a filter returning undefined does not consume the error", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/undecided"));

    expect(response.status).toBe(500);
    await application.close();
  });

  test("HttpError keeps its own Problem Details status", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/http"));

    expect(response.status).toBe(403);
    await application.close();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/platform-elysia/tests/exception-filters.test.ts`
Expected: FAIL — every case answers 500 with Elysia's own error body.

- [ ] **Step 3: Implement the default filter**

```ts
// packages/platform-elysia/src/errors/default-exception-filter.ts
import { AponiaError } from "@aponiajs/common";
import type { LoggerService } from "@aponiajs/common";
import type { Elysia } from "elysia";
import { HttpError } from "./http-error.ts";

/**
 * Maps an error nobody handled to a Problem Details response.
 *
 * Registered once on the root application rather than compiled into each
 * route's hooks, so a controller that declares no enhancer mounts exactly the
 * hook object it mounted before enhancers existed.
 *
 * The response never carries the stack or the cause: an application that could
 * turn this off could ship a stack trace.
 */
export function registerDefaultExceptionFilter(
  application: Elysia,
  logger: LoggerService | undefined,
): void {
  application.onError(({ error, set }) => {
    if (error instanceof HttpError) {
      return error.toResponse();
    }

    logger?.error(error, "ExceptionsHandler");
    set.status = 500;
    return {
      type: "about:blank",
      title: "Internal Server Error",
      status: 500,
      detail: "The server could not complete this request.",
    };
  });
}
```

Adapt the `HttpError` branch to whatever the existing class actually exposes — read `errors/http-error.ts` and use its own response builder rather than adding one.

- [ ] **Step 4: Register it in bootstrap**

In `bootstrapAponiaApplication`, after the root `Elysia` is created and before any controller mounts:

```ts
registerDefaultExceptionFilter(nativeApplication, logger);
```

- [ ] **Step 5: Emit declared filters as a route-local `onError`**

In the route hook builder, when `resolved.filters.length > 0`, emit an `onError` that walks the filters in order, calls `isFilterMatch`, and answers the first match. A filter returning `undefined` does not consume the error. Guard against a filter that throws: catch it, log, and return `undefined` so the default filter answers rather than the throw escaping into a second failure.

- [ ] **Step 6: Run it to verify it passes**

Run: `bun test packages/platform-elysia/tests/exception-filters.test.ts`
Expected: PASS, four cases.

- [ ] **Step 7: Cover a filter that throws, and the native-error mapping for WebSocket gateways**

Add a case where a filter's own `catch` throws, asserting one clean 500 and one log line rather than a second failure. Add a case asserting a gateway's `WEBSOCKET_HANDLER_ERROR` frame is unchanged, so the new root `onError` did not alter WebSocket error behavior.

- [ ] **Step 8: Update the documentation and commit**

Update whichever document states that native errors are not mapped to Problem Details — it is now false.

```bash
bun run check && bun run test:coverage && bun run test:vite-plus
git add packages/platform-elysia docs/
git commit -m "feat(platform-elysia): map unhandled errors to Problem Details"
```

---

### Task 8: Interceptors

**Files:**

- Modify: `packages/platform-elysia/src/routing/route-compiler.ts`
- Create: `packages/platform-elysia/tests/interceptors.test.ts`

**Interfaces:**

- Consumes: `ResolvedEnhancers.interceptors` from Task 5.
- Produces: `interceptBefore` merged into the route's `beforeHandle` after the guards, and `interceptAfter` merged into `afterHandle` in reverse declaration order.

- [ ] **Step 1: Write the failing test**

```ts
// packages/platform-elysia/tests/interceptors.test.ts
import { describe, expect, test } from "bun:test";
import { Controller, Get, Injectable, Module, UseInterceptors, UseGuards } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";

const order: string[] = [];

@Injectable()
class OuterInterceptor {
  interceptBefore(): void {
    order.push("outer:before");
  }
  interceptAfter(_context: unknown, response: unknown): unknown {
    order.push("outer:after");
    return `${String(response)}+outer`;
  }
}

@Injectable()
class InnerInterceptor {
  interceptBefore(): void {
    order.push("inner:before");
  }
  interceptAfter(_context: unknown, response: unknown): unknown {
    order.push("inner:after");
    return `${String(response)}+inner`;
  }
}

@Injectable()
class TimingInterceptor {
  interceptBefore(): void {
    order.push("timing:before");
  }
}

@Injectable()
class PassThroughInterceptor {
  interceptAfter(_context: unknown, response: unknown): unknown {
    return undefined;
  }
}

@Injectable()
class ThrowingGuard {
  canActivate(): boolean {
    throw new Error("guard exploded");
  }
}

@Injectable()
class AfterMustNotRun {
  interceptAfter(): unknown {
    order.push("after-ran");
    return undefined;
  }
}

@Controller("wrapped")
@UseInterceptors(OuterInterceptor, InnerInterceptor)
class WrappedController {
  @Get()
  read(): string {
    order.push("handler");
    return "value";
  }
}

@Controller("passthrough")
@UseInterceptors(PassThroughInterceptor)
class PassThroughController {
  @Get()
  read(): string {
    return "value";
  }
}

@Controller("guarded")
@UseGuards(ThrowingGuard)
@UseInterceptors(AfterMustNotRun)
class GuardedController {
  @Get()
  read(): string {
    return "value";
  }
}

@Module({
  controllers: [WrappedController, PassThroughController, GuardedController],
  providers: [
    OuterInterceptor,
    InnerInterceptor,
    TimingInterceptor,
    PassThroughInterceptor,
    ThrowingGuard,
    AfterMustNotRun,
  ],
})
class AppModule {}

describe("interceptors", () => {
  test("before runs in declaration order and after runs in reverse, wrapping the response", async () => {
    order.length = 0;
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/wrapped"));

    expect([await response.text(), order]).toEqual([
      "value+inner+outer",
      ["outer:before", "inner:before", "handler", "inner:after", "outer:after"],
    ]);
    await application.close();
  });

  test("returning undefined from interceptAfter leaves the response unchanged", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/passthrough"));

    expect(await response.text()).toBe("value");
    await application.close();
  });

  test("interceptAfter does not run when the handler or a guard throws", async () => {
    order.length = 0;
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/guarded"));

    expect(response.status).toBe(500);
    expect(order).toEqual([]);
    await application.close();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/platform-elysia/tests/interceptors.test.ts`
Expected: FAIL — all three cases, since nothing consumes the interceptor metadata.

- [ ] **Step 3: Merge the interceptor halves into the hook object**

In the route hook builder:

- `beforeHandle`: guards first, then `interceptBefore` in declaration order, inside the same function so ordering is one loop rather than two hooks;
- `afterHandle`: `interceptAfter` in **reverse** declaration order, each returning the value the next receives, with `undefined` meaning "leave it".

Global, controller, and method scope concatenate in that order; the reverse applies to the concatenated list, not per scope.

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test packages/platform-elysia/tests/interceptors.test.ts`
Expected: PASS, three cases.

- [ ] **Step 5: Cover Review Focus items 1 and 4**

Add a case booting an application with a generated invoker artifact and an intercepted route, asserting the interceptor still wraps the response. Add a case where the handler itself throws and asserting `interceptAfter` did not run and the error reached the filters.

- [ ] **Step 6: Run the gates and commit**

```bash
bun run check && bun run test:coverage && bun run test:vite-plus
git add packages/platform-elysia/src/routing/route-compiler.ts packages/platform-elysia/tests/interceptors.test.ts
git commit -m "feat(platform-elysia): run interceptors around a route"
```

---

### Task 9: Documentation and repository gates

**Files:**

- Create: `docs/enhancers.md`
- Modify: `docs/learn/README.md` and a new final chapter `docs/learn/10-enhancers.md`
- Modify: `packages/platform-elysia/README.md`
- Modify: `packages/common/README.md`
- Modify: `packages/platform-elysia/AGENTS.md`, `packages/common/AGENTS.md`
- Modify: `AGENTS.md` (move guards, interceptors, and exception filters out of "Not implemented" and into "Implemented")

**Interfaces:**

- Consumes: everything above.
- Produces: no code.

- [ ] **Step 1: Write `docs/enhancers.md`**

Cover: the three kinds and what each maps to; declaration through decorators, plans, and options; that an enhancer must be a declared provider; the scope order; the guard refusal contract; the default filter and why it cannot be removed; and the deviations from Nest, copied from the spec's "Deviations from Nest" section rather than restated.

- [ ] **Step 2: Add the learning chapter**

Follow the constraints in `docs/AGENTS.md`: the number must stay contiguous, the chapter must open with `# 10 · <title>` and contain `**Use when:**`, must be listed in `docs/learn/README.md`, and the previous chapter must link to it. Run `bun test scripts/learning-path.spec.ts` to confirm.

- [ ] **Step 3: Update the package guides and the root guide**

Add the `enhancers/` domain row to `packages/common/AGENTS.md` and `packages/platform-elysia/AGENTS.md`, and move the three features from "Not implemented" to "Implemented" in the root `AGENTS.md`. Delete the Problem Details gap from both lists, since Task 7 closed it.

- [ ] **Step 4: Run the documentation guards**

Run: `bun test scripts/documentation.spec.ts scripts/agent-guides.spec.ts scripts/learning-path.spec.ts`
Expected: PASS.

- [ ] **Step 5: Run the complete gate set**

```bash
bun run check
bun run test:coverage
bun run test:vite-plus
bun run test:examples
```

Expected: all pass, aggregate line and function coverage at or above 95%.

- [ ] **Step 6: Scan for non-English content and commit**

```bash
rg -nP '[\x{0E00}-\x{0E7F}]' --glob '!node_modules/**' --glob '!dist/**' .
git add docs packages AGENTS.md
git commit -m "docs(enhancers): document guards, interceptors, and exception filters"
```
