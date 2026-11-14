# Stability and the Public API

The **published** framework is on the `0.6.0-alpha.N` line. The source in this
repository targets the `1.0.0-beta.N` development line, which is not published
under `@beta` yet; one release publishes the whole package set together. Before
`1.0.0` the public API may still change; the release notes and the frozen
snapshot make each change reviewable. From `1.0.0`, a breaking change requires a
major version.

The alpha line is the installable channel today. The beta line becomes the
supported channel only when it is published; a document that names a `@beta`
install command is describing that future release, not the current registry
state.

This page states what is considered public, how a change is classified, and the
evidence a change must carry.

## Compatibility

| Component        | Supported contract                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| Bun              | `1.4.4`, the version pinned by `packageManager` and the CI toolchain                                       |
| Elysia           | `2.0.0-rc.4`, declared as the exact peer of the platform package                                           |
| TypeBox          | `^1.4.6` as Elysia's peer; Aponia does not add a runtime TypeBox edge                                      |
| TypeScript       | The repository toolchain, with `experimentalDecorators` and `emitDecoratorMetadata` required in a consumer |
| Operating system | The Bun-supported platforms the CI lane exercises                                                          |

The application owns its own `tsconfig.json`. A consumer that omits the
decorator options gets a silently empty route plan and `404` responses, not a
framework error. See [Elysia compatibility](./elysia-compatibility.md) for the
exact peer mismatch behavior.

## What counts as public

| Surface                           | Location                                                            | Guarded by                                    |
| --------------------------------- | ------------------------------------------------------------------- | --------------------------------------------- |
| Package exports                   | `packages/*/src/index.ts`                                           | `docs/public-api.json`, `bun run api:verify`  |
| Decorators, metadata keys, tokens | `@aponiajs/common`                                                  | `aponia manifest`, framework contract tests   |
| Descriptor shapes                 | `defineModule`, `defineController`, `provide*`, gateway definitions | `scripts/framework-contract.spec.ts`          |
| Error codes and details           | `AponiaErrorCode` and each package's documented codes               | Focused tests and docs                        |
| HTTP contract                     | Route slots, Problem Details, status helpers                        | Platform tests and docs                       |
| CLI commands and JSON output      | `@aponiajs/cli`                                                     | CLI tests and documentation guards            |
| Library contract                  | `aponia.library.json`                                               | `aponia library check` and its tests          |
| Agent surface                     | `aponia manifest`, `aponia mcp`, tool names and flags               | MCP tests and [agent docs](./agent/README.md) |

Only `src/index.ts` is a public barrel; `scripts/source-layout.spec.ts`
enforces that. A bin-only package (`create-aponia`) publishes an executable
instead of a module surface and is covered by its own entrypoint test.

## Change classification

| Change                                                   | Release class                  | Required evidence                                                |
| -------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------- |
| Documentation, comments, non-behavioral formatting       | Patch                          | `bun run docs:build`, `bun test scripts`, `bun run check`        |
| Additive option, overload, or export                     | Minor before `1.0.0`           | Snapshot diff, tests, docs, package README and `llms.txt`        |
| Changed default, parameter type, or returned shape       | Treated as breaking in review  | Migration note in the page, tests for both paths                 |
| Removed or renamed export, route contract, or error code | Major after `1.0.0`            | Deprecation first where practical, snapshot diff, migration note |
| Experimental API                                         | Named experimental in its page | Same tests as stable code; no compatibility promise              |

Treat a change in behavior as a contract change even when the export list is
unchanged. The snapshot records names, not signatures, so review and tests are
the guard for parameter and return semantics.

## The frozen snapshot

`docs/public-api.json` lists every name each published package exports from its
barrel and whether the name is a value or a type:

- `bun run api:verify` compares the live barrels against the snapshot and names
  every difference: an added, removed, or re-kinded export, a package that
  disappeared, or a package missing from the snapshot.
- `bun run api:freeze` rewrites the snapshot from the live barrels.
- `scripts/public-api.spec.ts` runs the comparison in the test lane, so a
  forgotten snapshot update fails `bun run test:coverage`.

Freezing is not a promise that a name never changes. It is a promise that the
change is visible in review and ships with its documentation.

## Deprecation and removal

- Keep a deprecated export exported, documented as deprecated, and marked with
  `@deprecated` in its JSDoc. Remove it only in a release that is allowed to
  break the surface.
- State the replacement in the same JSDoc and page. A deprecation without a
  migration path is incomplete.
- Before `1.0.0`, a removal still needs a visible release note and a docs
  update; after `1.0.0`, it needs a major version.
- Runtime deprecation warnings are not part of the contract. Consumers discover
  a deprecation through the type surface, the docs, and the release notes.

## Experimental surface

An experimental API is named as experimental in its page and in the package
README. It may change in a minor release and is not covered by the stable
compatibility promise. As of this release, the Nitro 3 RC adapter is
experimental; every other published package is marked complete in
[Feature status](./feature-status.md).

## Changing the surface

1. Make the change in the owning package's `src/` with focused tests.
2. Run `bun run check` and the affected package lane.
3. Run `bun run api:freeze` and review the snapshot diff deliberately.
4. Update the package README, its `llms.txt`, and the documentation page.
5. Bump the synchronized version with the matching `version:*` command.
6. Run the full gates: `bun run test:coverage`, `bun run test:vite-plus`,
   `bun run test:examples`, and `bun run release:dry-run` when package
   contents changed.

The release channel rules and distribution tags live in
[Releasing](./releasing.md). The npm tag is derived from the version; it is
never chosen by hand.

## Support and disclosure

The current release on the active channel is the supported release; older beta
versions are superseded. Security reports follow [SECURITY.md](../SECURITY.md)
and the boundaries in the [threat model](./threat-model.md). A security fix that
changes behavior follows the same snapshot, documentation, and version rules as
any other public change.
