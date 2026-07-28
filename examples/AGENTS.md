# examples — Agent Guide

Read the [repository guide](../AGENTS.md) first.

## What this directory owns

Executable applications that must keep working against the workspace packages.
`basic-foundation` is the reference application: `bun run example:basic` boots it
on its configured port.

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
