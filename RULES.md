# Engineering Rules

This file records repository-wide implementation and verification rules derived
from the current AponiaJS codebase. `AGENTS.md` defines architecture, ownership,
and workflow; this file defines the minimum evidence and coding discipline
required for a change to be complete. Package-level `AGENTS.md` files may add
stricter owner-specific requirements, but must not weaken these rules.

The root `AGENTS.md` requires this file to be read completely at the start of
every agent turn. Prior-turn memory or a cached summary is not a substitute.

If documentation and enforcement disagree, fix both in the same change. A green
test run never justifies bypassing an architectural contract.

## Mandatory Test Coverage

### Coverage floor and source completeness

- Every executable framework source, release script, generator, template
  behavior, and public example behavior must be covered by an appropriate test
  lane.
- `bun run test:coverage` is the primary coverage gate. Aggregate line coverage
  and function coverage must each remain at or above 95%.
- The 95% threshold is a minimum safety floor, not a target. Do not lower it,
  round around it, remove the gate, or exclude code merely to make CI pass.
- Every runtime TypeScript source under `packages/*/src/**/*.ts` and every
  executable `scripts/*.ts` file must appear in the LCOV report. The only
  default exclusions are type-only `*.types.ts` files and test specifications.
- New runtime locations must be added to the source-completeness discovery in
  `scripts/coverage-gate.ts` in the same change that introduces them.
- Changed executable lines and functions are expected to have direct test
  evidence. Aim for 100% coverage of touched executable code even when the
  repository aggregate is already above the floor.
- A narrow exception is allowed only when a path is genuinely unreachable,
  platform-owned, or nondeterministic by contract. The pull request must name
  the exact path, explain why direct coverage is impractical, and identify the
  compensating test. Blanket coverage ignores are forbidden.
- Line and function metrics do not replace branch reasoning. Until branch
  coverage is enforced mechanically, tests must explicitly exercise each
  meaningful decision outcome.

### Required behavioral evidence

For every behavior change, cover every applicable category:

1. the successful path and returned contract;
2. invalid input, rejection, and structured error behavior;
3. empty, missing, duplicate, boundary, and ambiguous inputs;
4. state reuse, isolation, lifecycle, and cleanup;
5. synchronous, asynchronous, and Promise-returning behavior;
6. compatibility across supported authoring or toolchain paths;
7. the exact regression before the production fix is considered complete.

Assertions must prove observable behavior. Tests that only execute code, only
assert that it does not throw, or mirror implementation details without checking
the public contract do not count as sufficient evidence.

### Test-lane ownership

| Changed area                                | Required evidence                                                                                                             |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `@aponiajs/common` contracts and decorators | Focused Bun tests; Vite+ conformance when the public contract or emitted types change                                         |
| `@aponiajs/core` graph and container        | Bun success, failure, ambiguity, visibility, cycle, and caching cases; mirrored Vite+ public conformance                      |
| `@aponiajs/platform-elysia`                 | Tests through `AponiaFactory.create` and `application.handle`; Vite+ coverage for public types and supported runtime behavior |
| `@aponiajs/cli` parsing and generation      | Focused Bun tests for planning, rendering, registration, writes, errors, and dry-run behavior                                 |
| CLI templates, manifests, or packed output  | `bun run build` followed by `bun run test:generated-app`                                                                      |
| Executable examples                         | Focused unit tests where useful and `bun run test:examples` for public behavior                                               |
| Release scripts and workflows               | `scripts/*.spec.ts`, workflow guard tests, release verification, and `bun run release:dry-run` when package contents change   |
| Documentation structure or required wording | The relevant guard specification when wording, links, ordering, or indexes are contractual                                    |
| Type-only contracts                         | Compile-time assertions exercised by `bun run check` and the applicable Vite+ conformance lane                                |

When a change crosses owners, satisfy every applicable row. One broad integration
test must not replace focused failure and edge-case tests.

### Test design and isolation

- Prefer public entrypoints over private helpers. Exercise HTTP behavior through
  `application.handle(new Request(...))` when a platform contract is involved.
- Assert `AponiaError.code` and structured `details`; do not couple tests to
  incidental message wording.
- Name tests as complete behavioral statements. A failing test should identify
  the broken contract without reading its body.
- Keep tests deterministic and independent. Unit and conformance lanes must not
  require external networks, fixed ports, wall-clock timing, or execution order.
- Use temporary directories for filesystem cases and always clean them up.
  Serialize only tests that intentionally share process-global state.
- Mock external boundaries only when needed. Do not mock the Aponia component
  whose behavior the test is intended to prove.
- Prefer exact structural assertions over broad snapshots. Snapshots are
  acceptable only when the complete serialized shape is itself the contract.
- Keep compile-time assertions referenced so `bun run check` cannot silently
  drop them as unused.

### Required verification gates

Before a change is submitted:

1. run `bun run check`;
2. run `bun run test:coverage`;
3. run `bun run test:vite-plus`;
4. run every additional lane selected by the ownership table;
5. run `bun run release:dry-run` when published package contents change.

Do not replace a required gate with a narrower command in final verification.
Narrow commands are for iteration; the complete gates are the delivery evidence.

## Current AponiaJS Coding Style

These conventions were extracted from the current framework packages, release
scripts, and tests. New code should look native to this repository.

### TypeScript and modules

- Use strict TypeScript, ESM, two-space indentation, semicolons, and the formatter
  output produced by `bun run check`.
- Use explicit `.ts` extensions for local imports. Cross-package imports go
  through the public package name, never another package's private source path.
- Keep type-only dependencies under `import type` or an inline `type` import
  specifier so they cannot become runtime edges.
- Do not use `any`. Narrow `unknown`, model closed unions, and use generic
  constraints that preserve the caller's types.
- Prefer `const` type parameters in public helpers when literal inference is
  part of the API contract.

### Ownership and file structure

- Organize source by domain owner such as `routing/`, `graph/`, `generation/`,
  or `application/`; do not create miscellaneous utility or package-wide type
  buckets.
- Keep `src/index.ts` as the only public barrel. Implementation modules remain
  private unless the package contract explicitly exports them.
- Co-locate type-only contracts as `*.types.ts` beside their owning
  implementation. Use `*.constants.ts` only for values shared by runtime and
  type modules.
- Keep orchestration functions thin. Parsing, planning, rendering,
  transformation, filesystem writes, and runtime registration belong to focused
  collaborators.

### Contracts and immutability

- Treat public API edits as contract changes. Preserve decorator and descriptor
  authoring paths, native escape hatches, and the one-way dependency direction
  `common` to `core` to `platform-elysia`.
- Return frozen public descriptors, metadata, arrays, and inspection results.
  Copy caller-owned collections before freezing them.
- Prefer `readonly` contracts and pure functions. Local mutation is acceptable
  for private caches, graph traversal, controlled builders, and performance
  critical internals when ownership is clear.
- Use `#private` class fields for internal state.
- Make platform-specific casts and compatibility shims explicit at the narrowest
  platform boundary.

### Control flow and errors

- Use descriptive verb-led function names and domain-specific variable names.
- Prefer small functions, early returns, and exhaustive switches over deep
  nesting or clever abstraction.
- Apply KISS, DRY, and YAGNI. Extract repeated domain behavior, but do not create
  speculative indirection.
- Framework failures use `AponiaError` with a member of the closed
  `AponiaErrorCode` union and frozen structured details.
- CLI argument and generator-input mistakes use plain `Error` or `TypeError`.
- Preserve the original error when translating only a specific known failure;
  rethrow unknown failures unchanged.

### Dependencies, comments, and performance

- Reuse maintained, typed, Bun-compatible libraries for general-purpose
  behavior. Custom code is reserved for Aponia-specific contracts.
- Comments explain why a constraint, workaround, or optimization exists. Do not
  narrate obvious syntax.
- Add JSDoc to public APIs and internal platform SPIs when ownership or usage is
  not evident from the signature. Mark internal exported platform APIs with
  `@internal`.
- Keep lint suppressions local and explain the invariant that makes the
  suppressed operation safe.
- Runtime hot paths compile or cache reusable work during bootstrap. Avoid
  per-request reflection, generic context mapping, and avoidable allocation.

## Definition of Done

A change is complete only when:

- ownership and dependency direction remain valid;
- public descriptors and metadata remain immutable;
- success, failure, edge, and regression behavior are tested;
- changed runtime sources appear in coverage;
- aggregate line and function coverage remain at least 95%;
- required Bun, Vite+, example, generated-app, and release lanes pass;
- documentation and examples match public behavior;
- no broad coverage exclusion, untyped escape, or unexplained lint suppression
  was introduced;
- `AGENTS.md`, package guides, and this file describe the same enforced reality.
