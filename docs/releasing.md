# Releasing npm Packages

The release workflow publishes the five usable workspace packages in dependency
order:

1. `@aponiajs/common`
2. `@aponiajs/core`
3. `@aponiajs/platform-elysia`
4. `@aponiajs/cli`
5. `create-aponia`

The `aponiajs` facade remains private until it exports the public framework API.

## Before a Release

1. Update all package versions and internal dependency ranges together.
2. Run `bun run release:dry-run` and inspect every package archive.
3. Run `vp check`, `bun test`, `vp test`, and `bun run build`.
4. Merge the release changes into `main`.

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

## Triggering a Release

Publish from the GitHub Actions page with the **Publish npm packages** workflow,
or publish a GitHub release after the package versions have been updated.

Use the `next` distribution tag for prereleases and `latest` for stable
releases. The workflow runs the full quality gate, packs each workspace, and
publishes the resulting archives in dependency order.
