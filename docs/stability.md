# Stability and the public API

The framework is on the `1.0.0-beta.N` line. Until `1.0.0`, every release may
change the public API; from `1.0.0`, a breaking change needs a major version.

## The frozen surface

`docs/public-api.json` lists every name each published package exports from its
barrel, and whether that name is a value or a type. The file is the contract the
guard reads:

- `bun run api:verify` compares the live barrels against the snapshot and fails
  with every difference: a name added, removed, or moved between a value and a
  type, a package that disappeared, a package missing from the snapshot.
- `bun run api:freeze` rewrites the snapshot from the live barrels.
- `scripts/public-api.spec.ts` runs the same comparison in the test lane, so a
  forgotten snapshot update fails `bun run test:coverage`.

A change that adds, removes, or re-kinds an export therefore lands in one pull
request with the snapshot written deliberately. The freeze is not a promise that
the name will never change; it is a promise that the change is visible in review.

Only `src/index.ts` is read, because `scripts/source-layout.spec.ts` makes it the
only public barrel. A bin-only package (`create-aponia`) publishes an executable
rather than a module surface and is covered by its own entrypoint test.

## What the snapshot does not cover

The snapshot records names, not signatures. Changing a parameter type, a default,
an option field, or the shape a function returns does not change the snapshot;
review catches that, and the package's own tests are expected to describe the
behavior. Generated descriptor shapes (`aponia manifest`) are pinned separately
by `scripts/framework-contract.spec.ts`.

## Deprecation

A name that is going away stays exported, documented as deprecated, and marked in
its JSDoc for at least one minor release before removal. Removing it is a
breaking change and needs the major release line. An experimental API is named as
experimental in its documentation and may change in a minor release; nothing is
experimental unless its page says so.

## Changing the surface

1. Make the change in the package's `src/`, with tests.
2. Run `bun run check` and the package's test lane.
3. Run `bun run api:freeze` and review the snapshot diff.
4. Update the package README, `llms.txt`, and `docs/` in the same change.
5. Run the full gates: `bun run test:coverage`, `bun run test:vite-plus`,
   `bun run test:examples`, and `bun run release:dry-run` when package contents
   changed.
