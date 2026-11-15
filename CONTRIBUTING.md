# Contributing to AponiaJS

AponiaJS is a framework repository, not an application. Every change here is
published as a public npm package, so a contribution is public API work:
contracts first, escape hatches preserved, versions synchronized.

Read [`AGENTS.md`](AGENTS.md) and [`RULES.md`](RULES.md) before opening a pull
request. They are the normative guides; this page is the short version.

## Branches and release line

| Branch          | Required version | Primary dist-tag |
| --------------- | ---------------- | ---------------- |
| `release/alpha` | `X.Y.Z-alpha.N`  | `alpha`          |
| `release/beta`  | `X.Y.Z-beta.N`   | `beta`           |
| `release/rc`    | `X.Y.Z-rc.N`     | `rc`             |
| `main`          | stable `X.Y.Z`   | `latest`         |

The workspace's release line is on the beta channel, so most work branches from
`release/beta`. Create a dedicated branch — `feature/<short-description>` or
`fix/<short-description>` — and open a pull request into the release branch it
started from. Never add commits directly to a release branch.

Every push raises the synchronized workspace version. Run the smallest valid
`bun run version:alpha|beta|rc|patch|minor|major` and commit its output with the
change; CI fails when the version is unchanged, lower, or inconsistent across
manifests and `bun.lock`.

## Before opening a pull request

```bash
bun install
bun run check
bun run test:coverage
bun run test:vite-plus
bun run test:examples
bun run api:verify
bun run release:dry-run
bun run docs:build
```

- Every behavioral change ships tests in both lanes when the public contract
  changes: `packages/*/tests/*.test.ts` (Bun) and
  `packages/*/tests-vp/*.conformance.ts` (Vite+).
- Coverage floors are enforced: 98% aggregate lines, 95% functions, and 95%
  lines per package. A changed executable line needs a case that runs it.
- A public behavior change ships its documentation in the same pull request, in
  `docs/` and the affected package README.
- Run `bun run api:freeze` only when the public surface deliberately changed,
  and review the snapshot diff with the change that caused it.
- All repository content — code, comments, and documentation — is English.

## Commit and pull request style

Use Conventional Commit subjects, for example `feat(cli): align starter layout
with Nest`. A pull request states its intent, lists the affected packages, links
the relevant issue, and includes the validation results above. Add terminal
output or screenshots only when they clarify CLI, logging, or visible behavior.

Never commit secrets, generated archives, `node_modules/`, or local environment
files.

## Security

Report vulnerabilities privately as described in [`SECURITY.md`](SECURITY.md).
Do not open a public issue for a suspected security defect.
