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

## Required Version Bump

Every push must increase the workspace version. Choose the smallest valid
SemVer increment before pushing:

```bash
bun run version:patch
bun run version:minor
bun run version:major
```

These commands update every package manifest, refresh Bun's dependency
lockfile, synchronize the versions Bun uses when packing internal workspace
dependencies, and verify that package versions remain synchronized. Commit the
generated changes with the rest of the work.

CI compares the pushed version with the previous push (or pull request base) and
fails when it is unchanged, lower, invalid, or inconsistent. Configure the
repository's branch protection rules to require the **CI / verify** check before
merging into `main`.

## Automated Release Flow

1. Select a patch, minor, or major increment with the matching `version:*`
   command.
2. Run `bun run release:dry-run` when package contents changed.
3. Run `bun run test:generated-app` to verify the packed CLI and generated
   application lifecycle.
4. Push the commit and let CI validate the SemVer increase.
5. Merge the pull request into `main`.
6. The release workflow creates the matching `vX.Y.Z` tag and GitHub release.
7. The npm publish workflow verifies, builds, packs, and publishes the five
   usable packages in dependency order.

Do not edit package versions or create release tags by hand.

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

Use the `next` distribution tag for prereleases and `latest` for stable
releases. The workflow runs the full quality gate, packs each workspace, and
publishes the resulting archives in dependency order.
