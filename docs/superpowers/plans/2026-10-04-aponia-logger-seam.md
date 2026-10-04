# Logger Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify framework, application, and devtools logging by introducing an observable system logger, exporting an injectable `LOGGER` token, and adding a predefined provider resolution tier in `@aponiajs/core`.

**Architecture:**

1. `@aponiajs/common`: Exports `LOGGER` token, `observeSystemLogger` observer registration, and `NOOP_LOGGER`.
2. `@aponiajs/core`: `ModuleGraph` and `AponiaContainer` gain support for predefined providers (`predefined?: readonly Provider[]`) consulted last by `ModuleGraph.locate` after module providers and exported imports.
3. `@aponiajs/platform-elysia`: During bootstrap, notifies logger observers, binds `provideValue(LOGGER, logger ?? NOOP_LOGGER)` as a predefined provider, and supplies it to container and inspection.
4. `@aponiajs/devtools`: Registers an observer to automatically tap the boot logger, eliminating the need to pass `logger` manually to devtools.

**Tech Stack:** TypeScript (strict, ESM), Bun test, Vite+ conformance.

**Spec:** `docs/superpowers/specs/2026-09-27-aponia-logger-seam-design.md`

## Global Constraints

- Predefined tier is consulted last in `locate`: own providers win first, exported imports win second (`AMBIGUOUS_PROVIDER` preserved if multiple imports conflict), predefined providers answer third.
- `logger: false` binds `NOOP_LOGGER` rather than failing the boot.
- `observeSystemLogger` must be called before the first boot log line is written.
- All code, comments, and documentation must be English.
- Aggregate line and function coverage must stay ≥ 95%.

## Review Focus

1. **Ambiguity preservation:** Two imports exporting `LOGGER` must still throw `AMBIGUOUS_PROVIDER` rather than silently falling back to the predefined provider.
2. **Local provider override:** A module that explicitly provides its own value/class/factory for `LOGGER` must resolve its own provider instead of the predefined one.
3. **No-op behavior:** When `logger: false` is configured, injecting `LOGGER` must resolve `NOOP_LOGGER` without throwing, and its methods (`log`, `error`, etc.) must safely no-op.
4. **Introspection safety:** `inspectAponiaApplication` must succeed on graphs containing `@Inject(LOGGER)` without `MISSING_PROVIDER`.
5. **Devtools stream unification:** A provider logging through `@Inject(LOGGER)` must appear in devtools `/logs` stream when devtools is enabled.

---

### Task 1: Observer, Token, and No-op Logger in `@aponiajs/common`

**Files:**

- Create: `packages/common/src/logging/logger-token.ts`
- Create: `packages/common/src/logging/logger-observer.ts`
- Modify: `packages/common/src/index.ts`
- Test: `packages/common/tests/logger-observer.test.ts`

- [ ] **Step 1: Write failing tests for logger token and observer**

Test that `LOGGER` has description `"aponia.logger"`, `observeSystemLogger` adds an observer called by `notifySystemLogger`, returns an unsubscribe function that stops future calls, and `NOOP_LOGGER` safely no-ops.

- [ ] **Step 2: Run test to verify failure**

Run: `bun test packages/common/tests/logger-observer.test.ts`

- [ ] **Step 3: Implement token, observer, and no-op logger**

Export `LOGGER`, `observeSystemLogger`, `notifySystemLogger`, and `NOOP_LOGGER`.
Export `LOGGER`, `observeSystemLogger`, and `NOOP_LOGGER` from `packages/common/src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/common/tests/logger-observer.test.ts`

---

### Task 2: Predefined Resolution Tier in `@aponiajs/core`

**Files:**

- Modify: `packages/core/src/graph/module-graph.ts`
- Modify: `packages/core/src/graph/graph-compiler.ts`
- Modify: `packages/core/src/container/container.ts`
- Test: `packages/core/tests/predefined-providers.test.ts`

- [ ] **Step 1: Write failing tests for predefined provider tier**

Test that:

- A module can resolve a predefined provider without declaring it.
- A module's own provider overrides the predefined provider.
- Two imports exporting the same token still throw `AMBIGUOUS_PROVIDER`.
- Unrelated missing tokens still throw `MISSING_PROVIDER`.

- [ ] **Step 2: Run test to verify failure**

Run: `bun test packages/core/tests/predefined-providers.test.ts`

- [ ] **Step 3: Implement predefined providers in `ModuleGraph` and `AponiaContainer`**

Update `ModuleGraph` constructor and `#locate` logic to consult predefined providers last when `candidates.size === 0`.
Update `compileModuleGraph` and `createContainer` to accept optional `predefined?: readonly Provider[]`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/tests/predefined-providers.test.ts`

---

### Task 3: Platform Bootstrap, Inspection, and Devtools Integration

**Files:**

- Modify: `packages/platform-elysia/src/application/application-bootstrap.ts`
- Modify: `packages/platform-elysia/src/inspection/application-inspection.ts`
- Modify: `packages/devtools/src/module/devtools-module.ts`
- Test: `packages/platform-elysia/tests/injected-logger.test.ts`
- Test: `packages/platform-elysia/tests-vp/injected-logger.conformance.ts`
- Test: `packages/devtools/tests/devtools-logger-seam.test.ts`

- [ ] **Step 1: Write failing tests for `@Inject(LOGGER)` in platform controllers and services**

- [ ] **Step 2: Bind `LOGGER` in bootstrap and inspection; notify observers on logger creation**

- [ ] **Step 3: Connect devtools module to logger observer**

- [ ] **Step 4: Run all integration and conformance tests**

---

### Task 4: Documentation, LLMs References, and Final Verification

**Files:**

- Modify: `packages/core/AGENTS.md` (document predefined tier)
- Modify: `docs/logging.md` (document `@Inject(LOGGER)`)
- Modify: `packages/common/llms.txt`
- Modify: `packages/devtools/README.md`
- Version bump: `bun run version:beta`
- Verification: `bun run check`, `bun run test:coverage`, `bun run test:vite-plus`, `bun run test:examples`, `bun run build`, `bun audit --audit-level=high`
- Push to `origin/tanya` (PR #64)
