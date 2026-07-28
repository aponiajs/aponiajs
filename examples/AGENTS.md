# examples — Agent Guide

Read the [repository guide](../AGENTS.md) first.

## What this directory owns

Executable applications that must keep working against the workspace packages.

| Example            | Purpose                                                           | Command                        |
| ------------------ | ----------------------------------------------------------------- | ------------------------------ |
| `basic-foundation` | The smallest application: one module, one controller, one service | `bun run example:basic`        |
| `feature-tour`     | Every implemented use case, each covered by an end-to-end test    | `bun run example:feature-tour` |

`feature-tour/README.md` maps each use case to the file that demonstrates it.
A new public feature belongs there, with a case in
`test/feature-tour.e2e-spec.ts`, in the same pull request that ships it.

Bun's default test glob matches `*.spec.ts` but not `*.e2e-spec.ts`, so an
end-to-end file under `test/` never runs during a bare `bun test`.
`bun run test:examples` runs both suites explicitly and CI calls it. Add a new
example's suite to that script or it will silently never run.

## Invariants

- An example is an application built _with_ the framework, so it follows the
  application conventions in [`docs/architecture-and-style.md`](../docs/architecture-and-style.md),
  not the framework-repository layout.
- Examples import workspace packages by package name, resolved through workspace
  links. Never reach into another package's `src/`.
- An example demonstrates a supported feature. When a public API changes, update
  the example in the same pull request; `bun run build` builds examples too, so
  a stale example breaks the build.
- Keep examples small enough to read in one sitting. A feature that needs a long
  explanation belongs in `docs/`.
