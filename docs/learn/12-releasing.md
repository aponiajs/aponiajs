# 12 · Releasing

**Use when:** contributing to this repository. Application authors can stop at chapter 11.

## Every push raises the version

All publishable packages and the root manifest share one version. CI fails when it is unchanged, lower, invalid, or inconsistent:

```bash
bun run version:alpha    # X.Y.Z-alpha.N -> X.Y.Z-alpha.N+1
bun run version:beta     # move the channel when the version is feature complete
bun run version:rc       # freeze
bun run version:promote  # X.Y.Z-rc.N -> X.Y.Z, with sign-off
```

The command updates every manifest, refreshes the lockfile, synchronizes version references, and verifies consistency. Commit its output with the change.

## Channels

The npm tag is derived from the version by `scripts/distribution-tag.ts` and is never chosen by hand:

| Version          | Tag      |
| ---------------- | -------- |
| stable `X.Y.Z`   | `latest` |
| `X.Y.Z-alpha.N`  | `alpha`  |
| `X.Y.Z-beta.N`   | `beta`   |
| `X.Y.Z-rc.N`     | `rc`     |
| `X.Y.Z-canary.*` | `canary` |

`next` is an alias over the newest alpha, beta, or rc. Any other prerelease identifier fails the gate.

```bash
bun run release:tag          # print the resolved channel
bun run release:dry-run      # when package contents changed
```

## Branch and pull request

Branch from the release channel the work targets and open the pull request back into that branch. Routine work currently starts from `release/beta`.

| Branch          | Version         | npm tag  |
| --------------- | --------------- | -------- |
| `release/alpha` | `X.Y.Z-alpha.N` | `alpha`  |
| `release/beta`  | `X.Y.Z-beta.N`  | `beta`   |
| `release/rc`    | `X.Y.Z-rc.N`    | `rc`     |
| `main`          | stable `X.Y.Z`  | `latest` |

Promotions move forward through those branches in order. Canary versions exist only inside CI. Public behavior changes ship with their documentation in the same pull request.

Next: [13 · Enhancers](./13-enhancers.md) · Deep dive: [releasing](../operations/releasing.md)
