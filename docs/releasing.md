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

| Tag      | Version shape                | Meaning                                                                     | Install                           |
| -------- | ---------------------------- | --------------------------------------------------------------------------- | --------------------------------- |
| `latest` | `X.Y.Z`                      | Stable release. The default install for everyone.                           | `bun add @aponiajs/common`        |
| `rc`     | `X.Y.Z-rc.N`                 | Release candidate. Feature frozen; only release-blocking fixes remain.      | `bun add @aponiajs/common@rc`     |
| `beta`   | `X.Y.Z-beta.N`               | Feature complete for the target version, still collecting field feedback.   | `bun add @aponiajs/common@beta`   |
| `alpha`  | `X.Y.Z-alpha.N`              | Early preview. The public API may still change without a major bump.        | `bun add @aponiajs/common@alpha`  |
| `next`   | alias                        | Always points at the newest `alpha`, `beta`, or `rc`. Never a stable build. | `bun add @aponiajs/common@next`   |
| `canary` | `X.Y.Z-canary.<stamp>.<sha>` | Automated build of `main`. Unreviewed, disposable, never promoted.          | `bun add @aponiajs/common@canary` |

Rules enforced by `bun run release:verify` and the publish workflow:

- A prerelease version can never take `latest`, and a stable version can never
  be published to `alpha`, `beta`, `rc`, `next`, or `canary`.
- Only `alpha`, `beta`, `rc`, and `canary` are accepted prerelease identifiers.
  Any other identifier fails the release gate.
- `next` is only ever applied as an alias after a successful `alpha`, `beta`, or
  `rc` publication. Nothing is published to `next` directly.
- `canary` never receives the `next` alias and is never promoted to another tag.
  Promote by cutting a real `alpha`, `beta`, or `rc`.
- A GitHub release for any non-`latest` tag is marked as a prerelease.
- All five packages share one version, so all five move to the same tag together.

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
merging into `main`.

## Automated Release Flow

1. Select the increment and channel with the matching `version:*` command.
2. Run `bun run release:dry-run` when package contents changed.
3. Run `bun run test:generated-app` to verify the packed CLI and generated
   application lifecycle.
4. Push the commit and let CI validate the SemVer increase and report the
   distribution tag the version resolves to.
5. Merge the pull request into `main`.
6. The release workflow creates the matching `vX.Y.Z` tag and GitHub release,
   marking it as a prerelease for every non-`latest` channel.
7. The npm publish workflow verifies, builds, packs, and publishes the five
   usable packages in dependency order under the resolved tag, then moves the
   `next` alias when the channel is `alpha`, `beta`, or `rc`.

Do not edit package versions, create release tags, or move distribution tags by
hand.

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
