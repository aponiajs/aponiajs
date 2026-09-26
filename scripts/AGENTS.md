# scripts — Agent Guide

Read the [repository guide](../AGENTS.md) first. This directory holds the release
and documentation guards that CI enforces.

| File                         | Owns                                                                     |
| ---------------------------- | ------------------------------------------------------------------------ |
| `distribution-tag.ts`        | The single mapping from a version to its npm channel, plus canary stamps |
| `release-branch.ts`          | The enforced mapping from persistent release branches to primary tags    |
| `verify-release.ts`          | The release gate: synchronized version, valid SemVer, allowed tag        |
| `sync-version-references.ts` | Version references in the Bun lockfile                                   |
| `workspace-versions.ts`      | The list of manifests that must share one version                        |
| `canary-version.ts`          | Stamping `X.Y.Z-canary.<stamp>.<sha>` in CI, never committed             |
| `coverage-gate.ts`           | Aggregate LCOV floor and runtime-source completeness                     |
| `agent-guides.spec.ts`       | Guide inventory, aliases, and mandatory per-turn `RULES.md` loading      |
| `ci-workflows.spec.ts`       | Complete CI, publish, packaging, and dependency-security command matrix  |
| `source-layout.spec.ts`      | Package owner directories, barrels, type-only modules, local imports     |
| `toolchain-config.spec.ts`   | The decorator transpiler options and the single Bun version pin          |
| `package-llms.spec.ts`       | The `llms.txt` every published package ships and lists in `files`        |
| `*.spec.ts`                  | Guard tests over the above and over documentation wording                |

## Invariants

- The distribution channel is derived from the version, never chosen by hand:
  stable → `latest`, `-alpha.N` → `alpha`, `-beta.N` → `beta`, `-rc.N` → `rc`,
  `-canary.*` → `canary`, with `next` applied only as an alias over the newest
  `alpha`, `beta`, or `rc`. Any other prerelease identifier fails the gate.
- A prerelease can never take `latest`, and a stable version can never take a
  prerelease tag. Both directions are tested.
- Persistent release branches map one-to-one to primary tags: `main` →
  `latest`, `release/alpha` → `alpha`, `release/beta` → `beta`, and
  `release/rc` → `rc`. `next` is an alias and canary versions are ephemeral, so
  neither gets a branch.
- `verify-release.ts` prints `Verified synchronized release version X.`
  verbatim; `verify-release.spec.ts` asserts that line. Add new output on new
  lines instead of rewording it.
- Every release script keeps its `if (import.meta.main)` block a single call of
  an exported entry function, and that function returns its result instead of
  exiting. `scripts/*.spec.ts` calls the function directly so the coverage lane
  records the entry body, and keeps a subprocess case only for what the process
  itself proves: the exit code and the output that reaches the terminal.
- A release script appends to the GitHub Actions output file named by
  `GITHUB_OUTPUT`, which creates the file when a pipeline runs the script before
  the file exists. The append replaces a read-then-rewrite, so a path whose
  directory is missing or unwritable still fails instead of being ignored.
- Guard specs make documentation part of the test suite. A wording edit in
  `README.md`, `docs/cli.md`, `docs/packages.md`, or `packages/cli/README.md`
  can fail `bun test`.
- `agent-guides.spec.ts` prevents removal of the root guide's mandatory
  per-turn `RULES.md` loading sequence.
- `source-layout.spec.ts` protects the domain-first package layout. Update the
  guide and guard together when a real new source domain is introduced.
- `package-llms.spec.ts` requires every published package to ship an `llms.txt`
  listed in its manifest `files` array, opening with an `H1` naming the package,
  a blockquote summary, and links that resolve. It discovers packages from the
  workspace, so a new published package is covered without editing the guard;
  `packages/aponiajs` is the pinned private exception.
- Every push must raise the synchronized workspace version. Run the smallest
  valid `bun run version:*` and commit its output.
- `toolchain-config.spec.ts` holds two configuration invariants. Every package
  `tsconfig.json` declares `experimentalDecorators` and `emitDecoratorMetadata`,
  because Bun reads the transpiler configuration from the process working
  directory and a package without them silently serves `404` from its own
  directory. And the Bun version is identical in `package.json`
  (`packageManager` and `devEngines`), `mise.toml`, every workflow's
  `bun-version`, the starter manifest, and the README badge — `packageManager` is
  the source of truth and the rest are asserted against it. Move all of them in
  one change; a version that drifts between them passes locally and fails in CI,
  or measures a release nobody else ran.

## Tests

`bun test scripts/` runs the guards. They are part of the default Bun lane.
