# aponiajs — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

Nothing yet. `aponiajs` is the reserved public facade: private, unpublished, and
holding a placeholder export until it re-exports a settled framework API.

## Invariants

- The package stays `private` until the facade is real. It is not part of the
  publish order in `.github/workflows/publish.yml`, and `docs/packages.md` tells
  users not to install it.
- It still shares the synchronized workspace version, so `bun run version:*`
  bumps it with everything else.
- Do not re-export a package's private source path here. When the facade lands,
  it re-exports `@aponiajs/common`, `@aponiajs/core`, and
  `@aponiajs/platform-elysia` through their package names.

## Tests

`tests/` and `tests-vp/` exist so the package participates in both lanes. Keep
them meaningful once the facade exports something.
