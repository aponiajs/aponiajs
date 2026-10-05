# Aponia Middleware and Pipes System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement NestJS-aligned Pipes (`PipeTransform`, `@UsePipes()`, built-in transformation pipes) and Middleware (`AponiaMiddleware`, `MiddlewareConsumer`, `configure()` seam) in AponiaJS.

**Architecture:**

- `@aponiajs/common`: Pipe and Middleware interfaces, `@UsePipes()` decorator, and built-in pipes (`ParseIntPipe`, `ParseFloatPipe`, `ParseBoolPipe`, `ParseUUIDPipe`, `DefaultValuePipe`).
- `@aponiajs/platform-elysia`: Pipe execution engine in parameter binding, and Middleware pipeline execution ahead of route execution.

---

### Task 1: Pipes Contracts and Built-in Pipes (`@aponiajs/common`)

**Files:**

- Create: `packages/common/src/pipes/pipe.types.ts`
- Create: `packages/common/src/pipes/pipe-decorators.ts`
- Create: `packages/common/src/pipes/built-in-pipes.ts`
- Modify: `packages/common/src/routing/route-parameters.ts`
- Modify: `packages/common/src/routing/route-parameters.types.ts`
- Modify: `packages/common/src/index.ts`
- Test: `packages/common/tests/pipes.test.ts`
- Conformance: `packages/common/tests-vp/pipes.conformance.ts`

- [ ] **Step 1: Define Pipe contracts and metadata keys**
- [ ] **Step 2: Implement built-in transformation pipes**
- [ ] **Step 3: Update parameter decorators to accept trailing pipes**
- [ ] **Step 4: Export from barrel and verify with tests**

---

### Task 2: Parameter Pipe Compilation & Route Invoker Integration (`@aponiajs/platform-elysia`)

**Files:**

- Modify: `packages/platform-elysia/src/routing/route-compiler.ts`
- Modify: `packages/platform-elysia/src/routing/route-compiler.types.ts`
- Test: `packages/platform-elysia/tests/pipes-integration.test.ts`
- Conformance: `packages/platform-elysia/tests-vp/pipes.conformance.ts`

- [ ] **Step 1: Compile pipes into route parameter resolution**
- [ ] **Step 2: Resolve pipe classes via container or instantiate directly**
- [ ] **Step 3: Handle transformation failures and convert to RFC 9457 Bad Request responses**
- [ ] **Step 4: Verify test suite**

---

### Task 3: Middleware Contracts and Consumer Seam (`@aponiajs/common` & `@aponiajs/platform-elysia`)

**Files:**

- Create: `packages/common/src/middleware/middleware.types.ts`
- Modify: `packages/common/src/index.ts`
- Create: `packages/platform-elysia/src/middleware/middleware-consumer.ts`
- Modify: `packages/platform-elysia/src/application/application-bootstrap.ts`
- Test: `packages/platform-elysia/tests/middleware.test.ts`
- Conformance: `packages/platform-elysia/tests-vp/middleware.conformance.ts`

- [ ] **Step 1: Define AponiaMiddleware and MiddlewareConsumer contracts**
- [ ] **Step 2: Implement route matching and exclusion proxy**
- [ ] **Step 3: Call module.configure(consumer) during bootstrap**
- [ ] **Step 4: Verify test suite**

---

### Task 4: Documentation, Conformance, and Verification

**Files:**

- Modify: `docs/enhancers.md`
- Modify: `docs/architecture-and-style.md`
- Modify: `packages/common/README.md`
- Modify: `packages/platform-elysia/README.md`

- [ ] **Step 1: Document Pipes and Middleware usage with examples**
- [ ] **Step 2: Run non-English character sweep**
- [ ] **Step 3: Run all gates (`bun run check`, `bun run test:coverage`, `bun run test:vite-plus`)**
- [ ] **Step 4: Commit and push to branch tanya (PR #64)**
