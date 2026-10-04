# Request Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish an opt-in per-request context in `@aponiajs/platform-elysia` accessible anywhere down the call stack through an injectable `RequestContextService` singleton over `AsyncLocalStorage`, providing the in-flight `Request`, a correlation `requestId`, and typed key-value storage.

**Architecture:** A new domain `request-context/` under `packages/platform-elysia/src/` provides `RequestContext` contracts, header validation/sanitization, `RequestContextService`, and dynamic `RequestContextModule.forRoot(options)`. The module mounts one native Elysia plugin using `onRequest` to extract/generate the request ID, populate the response header, and enter the `AsyncLocalStorage` store. A singleton `RequestContextService` wraps the store and exposes `current(): RequestContext | undefined`.

**Tech Stack:** TypeScript (strict, ESM), Node `AsyncLocalStorage` (`node:async_hooks`), Node `crypto.randomUUID` (`node:crypto`), Bun test, Vite+ conformance, Elysia 1.4.30.

**Spec:** `docs/superpowers/specs/2026-09-27-aponia-request-context-design.md`

## Global Constraints

- Runtime stays inside `@aponiajs/platform-elysia`. No Elysia or HTTP APIs in `common` or `core`.
- `ProviderScope` remains `"singleton"`; no request-scoped DI or container changes.
- Zero overhead when not opted in: no plugin, no hook, no header, no modified boot output.
- Module identity is singular: one store per application instance, registered through `RequestContextModule.forRoot()`.
- Aggregate test coverage floor of 95% line and function coverage must be preserved.
- All code, comments, and documentation must be English.

## Review Focus

1. **Header injection prevention:** Malicious/overlong `x-request-id` headers (e.g. carriage returns, newlines, non-printable characters, or > 255 chars) must be discarded and replaced with a freshly generated UUID.
2. **Concurrent isolation:** Multiple concurrent asynchronous requests must maintain completely isolated context stores without cross-talk.
3. **Absence safety:** Calling `RequestContextService.current()` outside a request context (e.g. at startup or in background timers) must safely return `undefined` without throwing.
4. **Error path propagation:** When a route handler throws, the default RFC 9457 Problem Details error filter must still observe the request ID on the store and echo the correlation header.
5. **Leak containment:** Acknowledge and test that while `enterWith` binds within the request lifecycle, `current()` behaves safely on listening servers and test runners.

---

### Task 1: Contracts and Request ID Sanitization

**Files:**

- Create: `packages/platform-elysia/src/request-context/request-context.types.ts`
- Create: `packages/platform-elysia/src/request-context/request-context-header.ts`
- Modify: `scripts/source-layout.spec.ts:38-48`
- Test: `packages/platform-elysia/tests/request-context-header.test.ts`

**Interfaces:**

- Consumes: `InjectionToken<T>` from `@aponiajs/common`
- Produces: `RequestContext`, `RequestContextModuleOptions`, `resolveRequestId`, `isValidRequestId`

- [ ] **Step 1: Write failing tests for request ID sanitization and validation**

Create `packages/platform-elysia/tests/request-context-header.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  isValidRequestId,
  resolveRequestId,
} from "../src/request-context/request-context-header.ts";

describe("request context header validation", () => {
  test("accepts valid printable ASCII request IDs up to 255 characters", () => {
    expect(isValidRequestId("abc-123-XYZ")).toBe(true);
    expect(isValidRequestId("req_1234567890")).toBe(true);
  });

  test("rejects empty, overlong, or whitespace-only IDs", () => {
    expect(isValidRequestId("")).toBe(false);
    expect(isValidRequestId("   ")).toBe(false);
    expect(isValidRequestId("a".repeat(256))).toBe(false);
  });

  test("rejects IDs with newlines, carriage returns, or control characters", () => {
    expect(isValidRequestId("req-123\r\nInjected-Header: evil")).toBe(false);
    expect(isValidRequestId("req-123\n")).toBe(false);
    expect(isValidRequestId("req-\x00-bad")).toBe(false);
  });

  test("resolveRequestId returns valid header verbatim or generates a fallback", () => {
    const generator = () => "generated-uuid-42";
    expect(resolveRequestId("valid-client-id", generator)).toBe("valid-client-id");
    expect(resolveRequestId(null, generator)).toBe("generated-uuid-42");
    expect(resolveRequestId("bad\nid", generator)).toBe("generated-uuid-42");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/platform-elysia/tests/request-context-header.test.ts`

- [ ] **Step 3: Implement request context types and header helper**

Create `packages/platform-elysia/src/request-context/request-context.types.ts`:

```ts
import type { InjectionToken } from "@aponiajs/common";

export interface RequestContext {
  readonly request: Request;
  readonly requestId: string;
  get<T>(key: InjectionToken<T>): T | undefined;
  set<T>(key: InjectionToken<T>, value: T): void;
}

export interface RequestContextModuleOptions {
  readonly header?: string;
  readonly generate?: () => string;
  readonly echo?: boolean;
}
```

Create `packages/platform-elysia/src/request-context/request-context-header.ts`:

```ts
import { randomUUID } from "node:crypto";

const maxRequestIdLength = 255;
// Printable ASCII between 0x21 (!) and 0x7E (~), excluding control characters
const printableAsciiPattern = /^[\x21-\x7E]+$/;

export function isValidRequestId(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxRequestIdLength) {
    return false;
  }
  return printableAsciiPattern.test(trimmed);
}

export function resolveRequestId(
  headerValue: string | null | undefined,
  generate: () => string = randomUUID,
): string {
  if (headerValue && isValidRequestId(headerValue)) {
    return headerValue.trim();
  }
  return generate();
}
```

Update `scripts/source-layout.spec.ts` to add `"request-context"` to `packages/platform-elysia/src` package layout directories.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/platform-elysia/tests/request-context-header.test.ts && bun test scripts/source-layout.spec.ts`

- [ ] **Step 5: Commit changes**

Commit: `git commit -m "feat(platform-elysia): add request context contracts and header validation"`

---

### Task 2: Service, Store, and Module Implementation

**Files:**

- Create: `packages/platform-elysia/src/request-context/request-context.service.ts`
- Create: `packages/platform-elysia/src/request-context/request-context-module.ts`
- Modify: `packages/platform-elysia/src/index.ts`
- Test: `packages/platform-elysia/tests/request-context.test.ts`

**Interfaces:**

- Consumes: `RequestContext`, `RequestContextModuleOptions`, `resolveRequestId`
- Produces: `RequestContextService`, `RequestContextModule`

- [ ] **Step 1: Write failing test for RequestContextService and RequestContextModule**

Create `packages/platform-elysia/tests/request-context.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { AponiaFactory } from "../src/application/aponia-factory.ts";
import { RequestContextModule } from "../src/request-context/request-context-module.ts";
import { RequestContextService } from "../src/request-context/request-context.service.ts";
import { Module } from "@aponiajs/common";

describe("RequestContextModule and RequestContextService", () => {
  test("current() answers undefined when outside any request", () => {
    const service = new RequestContextService();
    expect(service.current()).toBeUndefined();
  });

  test("RequestContextModule.forRoot() produces a dynamic module exporting RequestContextService", () => {
    const dynamicModule = RequestContextModule.forRoot();
    expect(dynamicModule.id).toBe("AponiaRequestContextModule");
    expect(dynamicModule.exports).toContain(RequestContextService);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/platform-elysia/tests/request-context.test.ts`

- [ ] **Step 3: Implement RequestContextService and RequestContextModule**

Create `packages/platform-elysia/src/request-context/request-context.service.ts`:

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { Injectable } from "@aponiajs/common";
import type { RequestContext } from "./request-context.types.ts";

@Injectable()
export class RequestContextService {
  readonly #storage: AsyncLocalStorage<RequestContext>;

  constructor(storage?: AsyncLocalStorage<RequestContext>) {
    this.#storage = storage ?? new AsyncLocalStorage<RequestContext>();
  }

  get storage(): AsyncLocalStorage<RequestContext> {
    return this.#storage;
  }

  current(): RequestContext | undefined {
    return this.#storage.getStore();
  }
}
```

Create `packages/platform-elysia/src/request-context/request-context-module.ts`:

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { type DynamicModule, type InjectionToken, Module, provideValue } from "@aponiajs/common";
import { Elysia } from "elysia";
import { ELYSIA_PLUGIN } from "../plugins/plugin-module.ts";
import { resolveRequestId } from "./request-context-header.ts";
import { RequestContextService } from "./request-context.service.ts";
import type { RequestContext, RequestContextModuleOptions } from "./request-context.types.ts";

const REQUEST_CONTEXT_MODULE_ID = "AponiaRequestContextModule";

class InMemoryRequestContext implements RequestContext {
  readonly #values = new Map<symbol, unknown>();

  constructor(
    readonly request: Request,
    readonly requestId: string,
  ) {}

  get<T>(key: InjectionToken<T>): T | undefined {
    return this.#values.get(key.key) as T | undefined;
  }

  set<T>(key: InjectionToken<T>, value: T): void {
    this.#values.set(key.key, value);
  }
}

@Module({})
export class RequestContextModule {
  static forRoot(options: RequestContextModuleOptions = {}): DynamicModule {
    const storage = new AsyncLocalStorage<RequestContext>();
    const service = new RequestContextService(storage);

    const headerName = (options.header ?? "x-request-id").toLowerCase();
    const generate = options.generate ?? randomUUID;
    const echo = options.echo !== false;

    const plugin = new Elysia({ name: "aponia:request-context", seed: headerName }).onRequest(
      ({ request, set }) => {
        const incomingId = request.headers.get(headerName);
        const requestId = resolveRequestId(incomingId, generate);

        if (echo) {
          set.headers[headerName] = requestId;
        }

        const context = new InMemoryRequestContext(request, requestId);
        storage.enterWith(context);
      },
    );

    return {
      id: REQUEST_CONTEXT_MODULE_ID,
      providers: [
        provideValue(RequestContextService, service),
        provideValue(ELYSIA_PLUGIN, plugin),
      ],
      exports: [RequestContextService],
    };
  }
}
```

Export `RequestContext`, `RequestContextModuleOptions`, `RequestContextService`, and `RequestContextModule` from `packages/platform-elysia/src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/platform-elysia/tests/request-context.test.ts`

- [ ] **Step 5: Commit changes**

Commit: `git commit -m "feat(platform-elysia): implement RequestContextService and RequestContextModule"`

---

### Task 3: Full Integration Suite Across Lifecycle Phases

**Files:**

- Modify: `packages/platform-elysia/tests/request-context.test.ts`
- Create: `packages/platform-elysia/tests-vp/request-context.conformance.ts`

- [ ] **Step 1: Write integration tests covering reach, error path, isolation, and opt-out**

Expand `packages/platform-elysia/tests/request-context.test.ts` to add:

1. **Reach:** A controller delegates to a service, which delegates to a repository; a guard sets a token value; the repository reads `current()?.request`, `current()?.requestId`, and `current()?.get(token)`.
2. **Error Path:** A controller throws; Problem Details response is generated; response headers still contain `x-request-id`.
3. **Concurrent Isolation:** 20 concurrent requests with different header values assert that each receives their own requestId back without cross-contamination.
4. **Header variations:** Missing header generates a UUID; valid header echoed; invalid header (containing newline) replaced.
5. **Echo control:** `echo: false` does not set `x-request-id` response header, but `current()?.requestId` is still available.
6. **Opt-out:** An application without `RequestContextModule` has no `x-request-id` on response and no runtime overhead.

- [ ] **Step 2: Run Bun tests and verify all pass**

Run: `bun test packages/platform-elysia/tests/request-context.test.ts`

- [ ] **Step 3: Create Vite+ conformance test**

Create `packages/platform-elysia/tests-vp/request-context.conformance.ts`:
Mirror public API assertions and request lifecycle handling.

- [ ] **Step 4: Run Vite+ conformance lane**

Run: `bun run test:vite-plus`

- [ ] **Step 5: Commit changes**

Commit: `git commit -m "test(platform-elysia): add complete Bun and Vite+ test suites for request context"`

---

### Task 4: Documentation and Workspace Guards

**Files:**

- Create: `docs/request-context.md`
- Modify: `docs/AGENTS.md`
- Modify: `packages/platform-elysia/README.md`
- Modify: `packages/platform-elysia/llms.txt`

- [ ] **Step 1: Write `docs/request-context.md`**

Document:

- Why request context is needed
- Usage with `RequestContextModule.forRoot()`
- Reading in services, repositories, and guards
- Configuration options (`header`, `generate`, `echo`)
- Deliberate limits (AsyncLocalStorage scope, no request-scoped DI)

- [ ] **Step 2: Update `docs/AGENTS.md`**

Add row for `request-context.md` in the table under `## What this directory owns`.

- [ ] **Step 3: Update `packages/platform-elysia/README.md` and `llms.txt`**

Document the new exports and link `docs/request-context.md`.

- [ ] **Step 4: Run repository verification gates**

Run:

```bash
bun test scripts/package-llms.spec.ts
bun test scripts/source-layout.spec.ts
bun run check
bun run test:coverage
bun run test:vite-plus
```

- [ ] **Step 5: Commit changes**

Commit: `git commit -m "docs(platform-elysia): document request context module and update package LLM references"`
