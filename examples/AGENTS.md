# examples — Agent Guide

Read the [repository guide](../AGENTS.md) first.

## What this directory owns

One runnable application per topic, each named after what it demonstrates:
`basic`, `multiple-routers`, `dependency-injection`, `validation`,
`request-parameters`, `native-plugins`, `descriptors`, `websockets`.
`examples/README.md` is the index, with the port and command for each.

Every example keeps the same shape — `src/app.module.ts`, `src/main.ts`,
`test/application.ts` for the request helpers, `test/*.e2e-spec.ts` for the
assertions — so moving between them costs nothing. `basic` keeps the flat
`app.*` names `aponia new` generates; renaming it would misrepresent the
generator.

## Invariants

- An example is an application built _with_ the framework, so it follows the
  application conventions in [`docs/architecture-and-style.md`](../docs/architecture-and-style.md),
  not the framework-repository layout.
- Examples import workspace packages by package name, resolved through workspace
  links. Never reach into another package's `src/`.
- An example demonstrates a supported feature. When a public API changes, update
  the example in the same pull request; `bun run build` builds examples too, so
  a stale example breaks the build.
- A new feature gets a new example directory when it is a topic of its own, or a
  case in the closest existing one. Add its `example:<name>` script and a row in
  `examples/README.md`.
- Keep examples small enough to read in one sitting. A feature that needs a long
  explanation belongs in `docs/`.
