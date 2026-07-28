# 12 · Releasing

**Use when:** contributing to this repository. Application authors can stop at
chapter 11.

## Every push raises the version

All publishable packages and the root manifest share one version. CI fails when
it is unchanged, lower, invalid, or inconsistent:

```bash
bun run version:alpha    # 0.6.0-alpha.6 -> 0.6.0-alpha.7
bun run version:beta     # move the channel when a version is feature complete
bun run version:rc       # freeze
bun run version:promote  # 0.6.0-rc.1 -> 0.6.0, with sign-off
```

The command updates every manifest, refreshes the lockfile, synchronizes version
references, and verifies consistency. Commit its output with the change.

## The channel is derived, never chosen

`scripts/distribution-tag.ts` maps a version to exactly one npm tag: stable to
`latest`, `-alpha.N` to `alpha`, `-beta.N` to `beta`, `-rc.N` to `rc`,
`-canary.*` to `canary`, with `next` applied only as an alias over the newest
prerelease. Any other identifier fails the gate, and no manual input can move a
prerelease onto `latest`.

```bash
bun run release:tag          # the channel this version resolves to
bun run release:dry-run      # when package contents changed
```

The framework is pre-1.0, so every release is a prerelease. Cutting a bare
`X.Y.Z` needs explicit sign-off.

## Branch and pull request

Branch from the latest `main` as `feature/<short-kebab-description>`, open a pull
request against `main` after the first push, and use Conventional Commit
subjects. Public behavior changes ship with their documentation in the same pull
request.

Deep dive: [releasing](../releasing.md) ·
[repository guidelines](../../AGENTS.md)
