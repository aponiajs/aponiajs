# Repository Guidelines

## Project Structure & Module Organization

This is a Bun workspace for a Nest-inspired framework built around Elysia.
Framework packages live in `packages/`: `common` owns decorators and contracts,
`core` owns the module graph and dependency injection, and
`platform-elysia` owns HTTP integration. `cli` and `create-aponia` generate
applications, while `aponiajs` is the future public facade. Executable examples
belong in `examples/`, architecture documentation in `docs/`, and roadmaps in
`plans/`.

Keep package source in `src/`. Unit tests may be colocated as `*.spec.ts` or
stored in `tests/`; end-to-end tests use `test/*.e2e-spec.ts`. Generated standard
applications follow Nest's flat starter layout, while later resources belong in
`src/<resource>/`.

## Build, Test, and Development Commands

- `bun install`: install workspace dependencies.
- `bun run example:basic`: run the Elysia example on its configured port.
- `bun run build`: build every workspace package.
- `bun test`: run the Bun test suite.
- `bun run test:vite-plus`: run the compatibility lane.
- `bun run check`: format, lint, and type-check the repository.
- `bun run doctor`: diagnose toolchain or package-manager problems.

Use Bun exclusively for documented commands, runtime, and package management.
Keep internal Vite+ configuration behind Bun package scripts.

## Coding Style & Naming Conventions

Write strict TypeScript using ESM, two-space indentation, and explicit `.ts`
extensions for local imports. Oxfmt and Oxlint, invoked by `bun run check`, define the
canonical formatting and lint rules. Use PascalCase for classes and modules,
camelCase for functions and variables, and descriptive suffixes such as
`.module.ts`, `.controller.ts`, and `.service.ts`. Controllers should delegate
business behavior to injectable services.

All repository content, including comments and documentation, must be English.
Before finishing file changes, scan for Thai characters with
`rg -nP '[\x{0E00}-\x{0E7F}]' --glob '!node_modules/**' --glob '!dist/**' .`.

### Reuse Before Build

Search for a maintained library before implementing general-purpose behavior.
Use existing packages for concerns such as CLI parsing, AST manipulation,
validation, globbing, case conversion, inflection, and SemVer. Prefer packages
with active maintenance, TypeScript declarations, a compatible license, and
verified Bun support. Do not duplicate a library's behavior with handwritten
utilities. Write custom code only for Aponia-specific domain behavior when no
suitable maintained package exists, and document that decision in the pull
request or an architecture decision record.

### Clean Code

- Keep modules and functions focused on one responsibility.
- Use descriptive names and explicit types; do not use `any`.
- Prefer small pure functions, immutable data, and early returns.
- Apply KISS, DRY, and YAGNI; avoid speculative abstractions and duplicated logic.
- Keep framework-specific templates separate from parsing, naming, filesystem,
  and source-transformation concerns.
- Make dependency boundaries explicit and wrap third-party APIs only where the
  wrapper expresses Aponia domain behavior.
- Add focused tests for success, failure, and edge cases whenever behavior changes.

## Testing Guidelines

Add tests for every behavioral change. Bun owns the primary suite; Vite+ tests
protect toolchain compatibility. No coverage threshold is currently enforced,
so prioritize module boundaries, dependency resolution, route mapping, CLI
output, and failure cases. Run `bun run check`, `bun test`, and
`bun run test:vite-plus` before submitting.

## Commit & Pull Request Guidelines

Create every feature on a dedicated branch from the latest `main`, named
`feature/<short-kebab-description>`. Do not add feature work directly to
`main`, a documentation branch, or an unrelated feature branch.

The repository has no established commit history yet. Use concise Conventional
Commit subjects, for example `feat(cli): align starter layout with Nest`.
Pull requests should explain intent, list affected packages, link relevant
issues, and include validation results. Add terminal output or screenshots only
when they clarify CLI, logging, or visible behavior. Never commit secrets,
generated archives, `node_modules/`, or local environment files.
