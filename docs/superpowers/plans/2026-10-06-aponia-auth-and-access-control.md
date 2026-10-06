# Aponia Auth & Access Control System — Implementation Plan

**Goal:** Implement NestJS-aligned Auth & Access Control primitives in `@aponiajs/common` and `@aponiajs/platform-elysia`.

---

### Task 1: Custom Parameter Decorators, SetMetadata, and Reflector (`@aponiajs/common`)

**Files:**

- Create: `packages/common/src/routing/custom-parameter.ts`
- Create: `packages/common/src/routing/custom-parameter.types.ts`
- Modify: `packages/common/src/routing/route-parameters.types.ts`
- Create: `packages/common/src/enhancers/metadata.ts`
- Create: `packages/common/src/enhancers/reflector.ts`
- Modify: `packages/common/src/index.ts`
- Test: `packages/common/tests/reflector.test.ts`
- Conformance: `packages/common/tests-vp/reflector.conformance.ts`

- [ ] **Step 1: Implement `createParamDecorator` and custom parameter types**
- [ ] **Step 2: Implement `SetMetadata` and `Reflector` service**
- [ ] **Step 3: Export from public barrel `@aponiajs/common`**
- [ ] **Step 4: Verify with unit and conformance tests**

---

### Task 2: Parameter Compiler & Invoker Integration (`@aponiajs/platform-elysia`)

**Files:**

- Modify: `packages/platform-elysia/src/routing/route-compiler.ts`
- Test: `packages/platform-elysia/tests/custom-parameters.test.ts`
- Conformance: `packages/platform-elysia/tests-vp/custom-parameters.conformance.ts`

- [ ] **Step 1: Support `kind: "custom"` in `route-compiler.ts`**
- [ ] **Step 2: Connect custom parameter factory output into pipe pipelines**
- [ ] **Step 3: Verify integration tests**

---

### Task 3: Access Control Guards (`@aponiajs/platform-elysia`)

**Files:**

- Create: `packages/platform-elysia/src/security/auth-guard.ts`
- Create: `packages/platform-elysia/src/security/roles-guard.ts`
- Create: `packages/platform-elysia/src/security/security.types.ts`
- Modify: `packages/platform-elysia/src/index.ts`
- Test: `packages/platform-elysia/tests/auth-guards.test.ts`
- Conformance: `packages/platform-elysia/tests-vp/auth-guards.conformance.ts`

- [ ] **Step 1: Implement base `AuthGuard`**
- [ ] **Step 2: Implement `RolesGuard` with `Reflector`**
- [ ] **Step 3: Export from public barrel `@aponiajs/platform-elysia`**
- [ ] **Step 4: Verify test suite**

---

### Task 4: Documentation, Verification, and Push

**Files:**

- Modify: `docs/enhancers.md`
- Modify: `packages/common/README.md`
- Modify: `packages/platform-elysia/README.md`

- [ ] **Step 1: Update documentation and README files**
- [ ] **Step 2: Verify all gates (`bun run check`, `bun run test:coverage`, `bun run test:vite-plus`)**
- [ ] **Step 3: Bump beta version and push to branch tanya (PR #64)**
