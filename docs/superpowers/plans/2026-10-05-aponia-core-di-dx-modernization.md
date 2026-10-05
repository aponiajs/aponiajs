# Core DI & DX Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernize `@aponiajs/core`, `@aponiajs/common`, and `@aponiajs/testing` with NestJS-aligned ergonomics and superior developer experience: actionable diagnostic hints on missing providers, `@Global()` modules, `forwardRef()` circular reference support, complete Provider Scopes (`Scope.REQUEST`, `Scope.TRANSIENT`), and a fluent `Test.createTestingModule` test harness.

**Architecture:** Five structured phases maintaining strict one-way dependency direction (`common` ← `core` ← `platform-elysia` / `testing`). Descriptor-first lowering ensures hand-written definitions and decorated classes have identical runtime capabilities. Eager graph validation catches misconfigurations at boot before instances exist.

**Tech Stack:** Bun, TypeScript (strict, ESM, explicit `.ts` extensions), `bun test` for primary Bun lane, `vitest` under Vite+ for conformance testing.

**Spec:** [`docs/superpowers/specs/2026-10-05-aponia-core-di-dx-modernization-design.md`](../specs/2026-10-05-aponia-core-di-dx-modernization-design.md)

---

## Global Constraints

- **Language:** All repository content (code, comments, documentation, test names) must be English. Verify with `rg -nP '[\x{0E00}-\x{0E7F}]' --glob '!node_modules/**' --glob '!dist/**' .` before finalizing.
- **Dependency Flow:** `common` ← `core` ← `platform-elysia`. Never import `platform-elysia` or runtime HTTP APIs in `core` or `common`. Never import `reflect-metadata` in `core`.
- **Public API:** `src/index.ts` remains the only public barrel per package. Local imports use explicit `.ts` extensions.
- **Descriptors First:** Keep decorated paths and handwritten descriptor paths (`defineModule`, `provideClass`, etc.) in complete parity.
- **Performance:** Diagnostic analysis (searching all modules for missing tokens) runs _only_ when a resolution fails, keeping successful bootstrap hot paths instant.
- **Verification Gates:** Each task must pass `bun run check`, `bun run test:coverage` (≥95%), and `bun run test:vite-plus`.

---

## Tasks Overview

- [ ] **Task 1: Actionable Diagnostic Errors & Graph Insights**
- [ ] **Task 2: Global Modules (`@Global()` / `global: true`)**
- [ ] **Task 3: Circular Dependencies Handling (`forwardRef`)**
- [ ] **Task 4: Provider Scopes (`Scope.REQUEST` & `Scope.TRANSIENT`)**
- [ ] **Task 5: Testing DX (`Test.createTestingModule`)**
- [ ] **Task 6: Documentation, Conformance & Full Lane Verification**

---

### Task 1: Actionable Diagnostic Errors & Graph Insights

**Files:**

- Modify: `packages/core/src/graph/module-graph.ts`
- Modify: `packages/core/src/graph/graph-compiler.ts`
- Modify: `packages/common/src/errors/aponia-error.types.ts`
- Test: `packages/core/tests/graph.test.ts`
- Conformance: `packages/core/tests-vp/core.conformance.ts`

**Objective:**
When `locate(module, token)` fails, instead of a bare `MISSING_PROVIDER` error, inspect all modules in `ModuleGraph` to find if `token` is declared elsewhere. Generate precise hints in `error.details.hints`.

- [ ] **Step 1: Write failing tests for diagnostic hints**
      Add cases in `packages/core/tests/graph.test.ts`:
  1. Token declared in an imported module, but not exported -> Hint suggests adding token to exports.
  2. Token declared in an unimported module -> Hint suggests importing that module and exporting the token.
  3. Token nowhere in the application -> Hint suggests declaring a provider or adding it to the module.
  4. Circular provider dependency visual formatting.

- [ ] **Step 2: Implement graph diagnostic analyzer**
      In `packages/core/src/graph/module-graph.ts`:
      Add `#buildMissingProviderError(requestingModule: ModuleDefinition, token: Token<unknown>): AponiaError`:
  - Query all modules in `this.#moduleSet` where `module.providers` contains `token`.
  - Check whether the owning module is already in `requestingModule.imports`.
  - Assemble actionable hints:
    - `"Token '${tokenName}' is declared in '${owner.id}', but not exported. Add '${tokenName}' to '${owner.id}.exports'."`
    - `"Token '${tokenName}' is declared in '${owner.id}'. Add '${owner.id}' to '${requestingModule.id}.imports' and ensure it is exported."`
  - Populate `details.hints: readonly string[]`.

- [ ] **Step 3: Format circular dependency visual chains**
      In `packages/core/src/container/container.ts`:
      When throwing `PROVIDER_CYCLE`, format the message with an ASCII chain:
      `ModuleA:ServiceA -> ModuleB:ServiceB -> ModuleA:ServiceA`.

- [ ] **Step 4: Verify test suite**
      Run: `bun test packages/core/tests/graph.test.ts`

---

### Task 2: Global Modules (`@Global()` / `global: true`)

**Files:**

- Modify: `packages/common/src/decorators/decorators.ts`
- Modify: `packages/common/src/decorators/decorators.types.ts`
- Modify: `packages/common/src/modules/module.types.ts`
- Modify: `packages/platform-elysia/src/modules/module-compiler.ts`
- Modify: `packages/core/src/graph/module-graph.ts`
- Modify: `packages/core/src/graph/graph-compiler.ts`
- Test: `packages/core/tests/graph.test.ts`
- Test: `packages/platform-elysia/tests/module-compiler.test.ts`
- Conformance: `packages/core/tests-vp/core.conformance.ts`

**Objective:**
Allow modules decorated with `@Global()` or defined with `global: true` to make their exported providers available across the entire module graph without explicit imports in consuming modules.

- [ ] **Step 1: Write failing tests for global modules**
  1. Provider exported by a `@Global()` module is resolvable in a consumer module without importing the global module.
  2. Local provider in consumer module takes precedence over a global module provider.
  3. Explicitly imported module provider takes precedence over a global module provider.
  4. Two global modules exporting the same token trigger `AMBIGUOUS_PROVIDER`.
  5. Global module without exports triggers a diagnostic error.

- [ ] **Step 2: Add `@Global()` decorator and `ModuleDefinition.global`**
  - In `packages/common/src/decorators/decorators.ts`:
    Export `Global(): ClassDecorator` attaching metadata key `Symbol.for("aponia.global.metadata")`.
  - In `packages/common/src/modules/module.types.ts`:
    Add `readonly global?: boolean;` to `ModuleDefinition` and `ModuleMetadata`.
  - In `packages/platform-elysia/src/modules/module-compiler.ts`:
    Read global metadata when compiling `@Module()` decorated classes.

- [ ] **Step 3: Update `ModuleGraph` compilation and lookup logic**
  - In `compileModuleGraph`:
    - Record `globalModules: readonly ModuleDefinition[]` in `ModuleGraph`.
  - In `ModuleGraph.locate(module, token)`:
    - Precedence:
      1. `module.providers` (Local)
      2. `module.imports` exporting `token` (Explicit)
      3. `this.globalModules` exporting `token` (Global)
      4. Predefined providers fallback
      5. Throw `MISSING_PROVIDER` with diagnostics.

- [ ] **Step 4: Verify test suite**
      Run: `bun test packages/core/tests/graph.test.ts` and `bun test packages/platform-elysia/tests/module-compiler.test.ts`.

---

### Task 3: Circular Dependencies Handling (`forwardRef`)

**Files:**

- Create: `packages/common/src/modules/forward-ref.ts`
- Modify: `packages/common/src/modules/forward-ref.types.ts`
- Modify: `packages/common/src/index.ts`
- Modify: `packages/core/src/graph/graph-compiler.ts`
- Modify: `packages/core/src/container/container.ts`
- Test: `packages/core/tests/container.test.ts`
- Test: `packages/core/tests/graph.test.ts`
- Conformance: `packages/core/tests-vp/core.conformance.ts`

**Objective:**
Support circular dependencies between modules and providers using `forwardRef(() => Target)`, resolving circular provider cycles transparently via lazy proxies.

- [ ] **Step 1: Write failing tests for `forwardRef`**
  1. Circular module imports: `ModuleA` imports `forwardRef(() => ModuleB)` and `ModuleB` imports `forwardRef(() => ModuleA)`.
  2. Circular provider injection: `ServiceA` injects `forwardRef(() => ServiceB)` and `ServiceB` injects `forwardRef(() => ServiceA)`.
  3. Methods on cyclic services execute cleanly without throwing maximum call stack errors.

- [ ] **Step 2: Implement `forwardRef` contract in `@aponiajs/common`**
  - Implement `forwardRef<T>(fn: () => T): ForwardReference<T>`.
  - Implement `isForwardRef(value: unknown): value is ForwardReference`.
  - Implement `resolveForwardRef<T>(target: T | ForwardReference<T>): T`.

- [ ] **Step 3: Integrate with Graph Compiler and DI Container**
  - In `compileModuleGraph`: unwrap forward refs when exploring module imports.
  - In `AponiaContainer.#resolve`: when encountering a dependency cycle where an edge is marked with forward reference, supply an ES Proxy delegating property accesses to the deferred instance once constructed.

- [ ] **Step 4: Verify test suite**
      Run: `bun test packages/core/tests/container.test.ts`.

---

### Task 4: Provider Scopes (`Scope.REQUEST` & `Scope.TRANSIENT`)

**Files:**

- Modify: `packages/common/src/providers/provider.types.ts`
- Modify: `packages/common/src/decorators/decorators.ts`
- Modify: `packages/core/src/container/container.ts`
- Modify: `packages/platform-elysia/src/routing/route-compiler.ts`
- Test: `packages/core/tests/container.test.ts`
- Test: `packages/platform-elysia/tests/request-context.test.ts`
- Conformance: `packages/core/tests-vp/core.conformance.ts`

**Objective:**
Complete the implementation of `"request"` and `"transient"` scopes. Ensure transient providers create a fresh instance per injection, and request-scoped providers instantiate once per incoming request and clean up when the request concludes.

- [ ] **Step 1: Write failing tests for Scopes**
  1. `Scope.TRANSIENT`: Multiple injections receive distinct instances with their own state.
  2. `Scope.REQUEST`: Same request receives identical instance; different requests receive distinct instances.
  3. Scope hierarchy rule: Singleton cannot inject a Request-scoped provider (throws `INVALID_SCOPE_HIERARCHY`).

- [ ] **Step 2: Update `@Injectable` decorator and `Provider` interface**
  - Export `Scope` object: `{ DEFAULT: "singleton", REQUEST: "request", TRANSIENT: "transient" }`.
  - `@Injectable({ scope: Scope.REQUEST })`.
  - Pass scope into lowered provider descriptor.

- [ ] **Step 3: Container scope instantiation engine**
  - For `Scope.TRANSIENT`: skip `#instances` cache; instantiate fresh and resolve dependencies recursively.
  - For `Scope.REQUEST`: resolve through active request context store; tie lifetime to the current request execution.
  - Implement compile-time scope hierarchy validation during graph compilation.

- [ ] **Step 4: Verify test suite**
      Run: `bun test packages/core/tests/container.test.ts`.

---

### Task 5: Testing DX (`Test.createTestingModule`)

**Files:**

- Create: `packages/testing/src/testing-module-builder.ts`
- Create: `packages/testing/src/testing-module.ts`
- Modify: `packages/testing/src/index.ts`
- Test: `packages/testing/tests/testing-module.test.ts`
- Conformance: `packages/testing/tests-vp/testing.conformance.ts`

**Objective:**
Provide a first-class, NestJS-identical testing utility:
`Test.createTestingModule({...}).overrideProvider(Token).useValue(mock).compile()`.

- [ ] **Step 1: Write failing tests for `Test.createTestingModule`**
  1. Compile testing module from metadata.
  2. Override provider with `useValue`.
  3. Override provider with `useClass` or `useFactory`.
  4. Access instances via `moduleRef.get(Token)`.
  5. Boot full app via `moduleRef.createAponiaApplication()`.

- [ ] **Step 2: Implement `Test` and `TestingModuleBuilder`**
  - Construct synthetic root module wrapping provided imports/providers/controllers.
  - Apply provider overrides before compiling the module graph.
  - Return `TestingModule` with `.get()`, `.resolve()`, `.createAponiaApplication()`, and `.close()`.

- [ ] **Step 3: Verify test suite**
      Run: `bun test packages/testing/tests/testing-module.test.ts`.

---

### Task 6: Documentation, Conformance & Full Lane Verification

**Files:**

- Modify: `docs/dependency-injection.md`
- Modify: `docs/testing.md`
- Modify: `packages/core/README.md`
- Modify: `packages/testing/README.md`

**Objective:**
Document new DX features (Global modules, forwardRef, Scopes, Test harness), ensure mirrored Vite+ conformance cases pass, and satisfy all quality gates.

- [ ] **Step 1: Update documentation and README files**
  - Add guide sections for `@Global()`, `forwardRef`, `Scope`, and `Test.createTestingModule`.
- [ ] **Step 2: Non-English character sweep**
      Run: `rg -nP '[\x{0E00}-\x{0E7F}]' --glob '!node_modules/**' --glob '!dist/**' .`
- [ ] **Step 3: Run all verification gates**
  - `bun run check`
  - `bun run test:coverage` (ensure ≥95% coverage maintained)
  - `bun run test:vite-plus`
