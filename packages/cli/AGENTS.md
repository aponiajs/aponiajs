# @aponiajs/cli — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

`aponia new` and `aponia generate`. It is independent of the runtime packages and
driven by libraries rather than hand-rolled parsing.

| Domain        | Owns                                                                        |
| ------------- | --------------------------------------------------------------------------- |
| `commands/`   | Argument parsing, command contracts, help output, and `runCli`              |
| `generation/` | Naming, project discovery, file planning, renderers, module updates, writes |
| `version.ts`  | The version stamped into generated manifests                                |
| `templates/`  | The canonical application starter input                                     |

`generation/schematic-generator.ts` only orchestrates. Configuration lookup,
file planning, rendering, module registration, and filesystem writes remain
separate focused modules. `src/index.ts` is the only public barrel.

## Invariants

- Reuse before build. CLI parsing, AST manipulation, globbing, case conversion,
  and inflection all come from maintained packages. Do not hand-roll them back.
- `runCli` prints `CREATE`/`UPDATE` change lines and returns an exit code. It
  never throws.
- Argument and generator input mistakes use plain `Error`/`TypeError`, not
  `AponiaError`.
- Absolute paths and traversing paths are rejected in
  `generation/component-names.ts`.
- Generated applications follow Nest's flat starter layout; later resources
  belong in `src/<resource>/`.
- A REST CRUD resource also emits `<name>.schema.ts`. It owns the route schemas
  the generated controller passes to its decorators, and both DTOs derive their
  types from it with `Static<typeof …>`.
- Documentation wording is guarded: `scripts/documentation.spec.ts` requires
  `bun add --global @aponiajs/cli` and forbids `bunx aponia` across `README.md`,
  `docs/cli.md`, `docs/packages.md`, and this package's README.

## Tests

`tests/*.test.ts` under Bun. `e2e/generated-application.e2e.ts` packs the CLI and
boots a generated application; it is slow and excluded from the default lanes,
so run it with `bun run test:generated-app` when templates or manifests change.
