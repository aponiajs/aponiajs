# create-aponia — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The `bun create aponia <name>` entrypoint. It is a thin `bin` wrapper that
forwards into the same generator `@aponiajs/cli` exposes — it holds no schematic
logic of its own, and must not grow any.

## Invariants

- Generator behavior belongs in `@aponiajs/cli`. Changing what a new project
  looks like means editing `packages/cli/templates/application`, never this
  package.
- The package ships one version with the rest of the workspace and is published
  in dependency order after `@aponiajs/cli`.
- The published surface is the `bin` entry. Keep the package free of runtime
  dependencies beyond `@aponiajs/cli`.

## Tests

Covered indirectly through the CLI suite and
`packages/cli/e2e/generated-application.e2e.ts`. Run
`bun run test:generated-app` when the entrypoint or its manifest changes.
