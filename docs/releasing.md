# Releasing npm Packages

AponiaJS uses a synchronized version for every workspace package. Releases
follow [Semantic Versioning 2.0.0](https://semver.org), with
[bumpp](https://github.com/antfu/bumpp) managing version changes.

The release workflow publishes the five usable workspace packages in dependency
order:

1. `@aponiajs/common`
2. `@aponiajs/core`
3. `@aponiajs/platform-elysia`
4. `@aponiajs/cli`
5. `create-aponia`

The `aponiajs` facade remains private until it exports the public framework API.

## Version Policy

- `0.y.z` identifies initial development. The public API is not stable.
- Until `1.0.0`, every release is a prerelease. Cut `alpha` by default, move to
  `beta` when a version is feature complete, and to `rc` when it is frozen. A
  stable `X.Y.Z` — which npm serves as `latest` to everyone who types
  `bun add @aponiajs/common` — needs explicit sign-off, not a routine bump.
- `fix:` commits produce a patch release.
- `feat:` commits produce a minor release.
- a `!` after the commit type or a `BREAKING CHANGE:` footer produces a major
  release.
- `1.0.0` will declare the first stable public API.

Package versions, Git tags, and GitHub releases use the same version. Git tags
use the conventional `v` prefix, for example `v0.2.1`; the package version
remains `0.2.1`.

## Distribution Tags

Every published version lands on exactly one npm distribution tag, derived from
the version itself. `scripts/distribution-tag.ts` owns that mapping, and both CI
and the publish workflows read it, so a channel is never chosen by hand.

| Tag      | Version shape                | Persistent branch | Meaning                                                                     | Install                           |
| -------- | ---------------------------- | ----------------- | --------------------------------------------------------------------------- | --------------------------------- |
| `latest` | `X.Y.Z`                      | `main`            | Stable release. The default install for everyone.                           | `bun add @aponiajs/common`        |
| `rc`     | `X.Y.Z-rc.N`                 | `release/rc`      | Release candidate. Feature frozen; only release-blocking fixes remain.      | `bun add @aponiajs/common@rc`     |
| `beta`   | `X.Y.Z-beta.N`               | `release/beta`    | Feature complete for the target version, still collecting field feedback.   | `bun add @aponiajs/common@beta`   |
| `alpha`  | `X.Y.Z-alpha.N`              | `release/alpha`   | Early preview. The public API may still change without a major bump.        | `bun add @aponiajs/common@alpha`  |
| `next`   | alias                        | —                 | Always points at the newest `alpha`, `beta`, or `rc`. Never a stable build. | `bun add @aponiajs/common@next`   |
| `canary` | `X.Y.Z-canary.<stamp>.<sha>` | —                 | Automated build of `main`. Unreviewed, disposable, never promoted.          | `bun add @aponiajs/common@canary` |

Rules enforced by `bun run release:verify` and the publish workflow:

- A prerelease version can never take `latest`, and a stable version can never
  be published to `alpha`, `beta`, `rc`, `next`, or `canary`.
- Only `alpha`, `beta`, `rc`, and `canary` are accepted prerelease identifiers.
  Any other identifier fails the release gate.
- `next` is only ever applied as an alias after a successful `alpha`, `beta`, or
  `rc` publication. Nothing is published to `next` directly.
- Every npm command in the workflows runs outside the repository checkout. npm
  refuses to run inside it because the workspace declares Bun through
  `devEngines.packageManager`.
- `canary` never receives the `next` alias and is never promoted to another tag.
  Promote by cutting a real `alpha`, `beta`, or `rc`.
- A GitHub release for any non-`latest` tag is marked as a prerelease.
- All five packages share one version, so all five move to the same tag together.

## Release Branches

Every persistent release branch owns exactly one primary npm distribution tag:

- `release/alpha` accepts only `X.Y.Z-alpha.N`.
- `release/beta` accepts only `X.Y.Z-beta.N`.
- `release/rc` accepts only `X.Y.Z-rc.N`.
- `main` accepts only stable `X.Y.Z` releases after explicit sign-off.

`bun run release:branch` enforces that mapping in the release workflow. A
version-derived dist-tag remains the source of truth; the branch is an
additional guard and can never override the version.

Feature and fix branches start from the release branch they target and open a
pull request back into it. During the current prerelease phase,
`release/alpha` is the default. Promote forward with a dedicated branch and
version transition:

```text
release/alpha -> release/beta -> release/rc -> main
```

For example, branch from `release/alpha`, run `bun run version:beta`, and open
the promotion pull request into `release/beta`. Apply a fix first to the least
mature affected channel, then forward-port it through every more mature channel
that also needs it. Do not back-merge a less mature channel into a more mature
one without the matching version transition.

Protect all four release branches with the **CI / verify** check. `next` has no
branch because it is an alias, and canary versions have no branch because CI
stamps them without committing them.

## Required Version Bump

Every push must increase the workspace version. Choose the smallest valid
SemVer increment before pushing:

```bash
bun run version:patch
bun run version:minor
bun run version:major
```

Prerelease channels use the matching commands, which advance the current
prerelease counter or start one from the current stable version:

```bash
bun run version:alpha    # 0.4.0-alpha.0 -> 0.4.0-alpha.1
bun run version:beta     # 0.4.0-alpha.3 -> 0.4.0-beta.0
bun run version:rc       # 0.4.0-beta.2  -> 0.4.0-rc.0
bun run version:promote  # 0.4.0-rc.1    -> 0.4.0
```

To open a prerelease line on a different increment, call the underlying command
directly, for example
`bun run version:bump -- --release preminor --preid alpha --yes`.

Canary versions are never produced locally or committed. CI stamps them with
`bun run release:canary`, which derives `X.Y.Z-canary.<stamp>.<sha>` from the
committed version and the commit being built.

These commands update every package manifest, refresh Bun's dependency
lockfile, synchronize the versions Bun uses when packing internal workspace
dependencies, and verify that package versions remain synchronized. Commit the
generated changes with the rest of the work.

Print the channel a version would publish to at any time:

```bash
bun run release:tag
bun run release:tag 0.4.0-rc.2
```

CI compares the pushed version with the previous push (or pull request base) and
fails when it is unchanged, lower, invalid, or inconsistent. Configure the
repository's branch protection rules to require the **CI / verify** check before
merging into any persistent release branch. That final gate aggregates isolated
version, quality, coverage, Vite+ conformance, example integration, packaging,
and dependency-security jobs so one failure does not hide results from the
other lanes.

## Automated Release Flow

1. Select the increment and channel with the matching `version:*` command.
2. Run `bun run release:dry-run` when package contents changed.
3. Run `bun run test:generated-app` to verify the packed CLI and generated
   application lifecycle.
4. Push the commit and let CI validate the SemVer increase, package contents,
   high-severity dependency advisories, and the distribution tag the version
   resolves to.
5. Merge the pull request into the matching release branch.
6. The release workflow creates the matching `vX.Y.Z` tag and GitHub release,
   marking it as a prerelease for every non-`latest` channel.
7. The npm publish workflow verifies, builds, packs, and publishes the five
   usable packages in dependency order under the resolved tag, then moves the
   `next` alias when the channel is `alpha`, `beta`, or `rc`.

The release workflow runs only for `release/alpha`, `release/beta`,
`release/rc`, and `main`, and rejects a version whose derived tag does not match
the branch. Do not edit package versions, create release tags, or move
distribution tags by hand.

## Canary Flow

The **Publish canary build** workflow runs on a weekday schedule and on manual
dispatch, and only from `main`. It stamps `X.Y.Z-canary.<stamp>.<sha>` into the
manifests, runs the quality gate, and publishes under the `canary` tag. The
stamped version is never committed, never tagged in Git, and never promoted to
another distribution tag.

## npm Authentication

Prefer npm trusted publishing. Configure the GitHub trusted publisher for each
package with:

- organization: `aponiajs`
- repository: `aponiajs`
- workflow: `publish.yml`
- environment: `npm`
- allowed action: `npm publish`

The workflow grants only `contents: read` and `id-token: write`. Trusted
publishing uses short-lived OIDC credentials and automatically associates
provenance with public packages.

For the first publication, before trusted publishing can be configured, create
an `npm` GitHub environment, add an `NPM_TOKEN` environment secret, run the
workflow once, configure trusted publishing for every package, and then remove
the token.

## Manual Publishing

The **Publish npm packages** workflow remains available for recovery. Enter the
expected package version so the workflow can reject an accidental mismatch.

Leave the tag input on `auto` so the channel is derived from the version. A
tag entered by hand is only accepted when the version allows it, so a manual run
cannot move a prerelease onto `latest`. The workflow runs the full quality gate,
packs each workspace, and publishes the resulting archives in dependency order.
