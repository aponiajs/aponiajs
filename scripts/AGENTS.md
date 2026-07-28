# scripts — Agent Guide

Read the [repository guide](../AGENTS.md) first. This directory holds the release
and documentation guards that CI enforces.

| File                         | Owns                                                                     |
| ---------------------------- | ------------------------------------------------------------------------ |
| `distribution-tag.ts`        | The single mapping from a version to its npm channel, plus canary stamps |
| `verify-release.ts`          | The release gate: synchronized version, valid SemVer, allowed tag        |
| `sync-version-references.ts` | Version references in the roadmap and lockfile                           |
| `workspace-versions.ts`      | The list of manifests that must share one version                        |
| `canary-version.ts`          | Stamping `X.Y.Z-canary.<stamp>.<sha>` in CI, never committed             |
| `*.spec.ts`                  | Guard tests over the above and over documentation wording                |

## Invariants

- The distribution channel is derived from the version, never chosen by hand:
  stable → `latest`, `-alpha.N` → `alpha`, `-beta.N` → `beta`, `-rc.N` → `rc`,
  `-canary.*` → `canary`, with `next` applied only as an alias over the newest
  `alpha`, `beta`, or `rc`. Any other prerelease identifier fails the gate.
- A prerelease can never take `latest`, and a stable version can never take a
  prerelease tag. Both directions are tested.
- `verify-release.ts` prints `Verified synchronized release version X.`
  verbatim; `verify-release.spec.ts` asserts that line. Add new output on new
  lines instead of rewording it.
- Guard specs make documentation part of the test suite. A wording edit in
  `README.md`, `docs/cli.md`, `docs/packages.md`, or `packages/cli/README.md`
  can fail `bun test`.
- Every push must raise the synchronized workspace version. Run the smallest
  valid `bun run version:*` and commit its output.

## Tests

`bun test scripts/` runs the guards. They are part of the default Bun lane.
