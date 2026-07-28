# examples — Agent Guide

Read the [repository guide](../AGENTS.md) first.

## What this directory owns

Executable applications that must keep working against the workspace packages.

| Example            | Purpose                                                           | Command                        |
| ------------------ | ----------------------------------------------------------------- | ------------------------------ |
| `basic-foundation` | The smallest application: one module, one controller, one service | `bun run example:basic`        |
| `feature-tour`     | Every implemented use case, each covered by an end-to-end test    | `bun run example:feature-tour` |

`feature-tour` numbers its source directories and test files by use case, so a
file name states what it demonstrates. A new public feature belongs there, in a
new numbered directory with a matching numbered suite, in the same pull request
that ships it. `basic-foundation` keeps the flat names `aponia new` generates —
renaming it would misrepresent the generated layout.

Bun's default test glob matches `*.spec.ts` but not `*.e2e-spec.ts`, so an
end-to-end file under `test/` never runs during a bare `bun test`.
`bun run test:examples` globs `examples/*/test/*.e2e-spec.ts` and CI calls it, so
a new suite is picked up as long as it lives there and ends in `.e2e-spec.ts`.

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
