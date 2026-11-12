# Support and Release Lifetime

This page states which releases receive fixes, how long a channel stays
supported, and how quickly a report is answered. It covers the framework
packages only; an application's own code and the stores, brokers, and databases
it supplies are its own.

## Channels and support windows

| Channel           | When it is supported                       | Fix policy                                                         |
| ----------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| `alpha`           | Today's published line (`0.6.0-alpha.N`)   | Security and critical correctness fixes on the newest release only |
| `beta`            | From the first published `1.0.0-beta.N`    | Security fixes on the newest release of the channel                |
| `rc`              | From the first published release candidate | Security fixes until the stable release ships                      |
| `latest` (stable) | From `1.0.0`                               | Security fixes on the newest patch; the previous minor for 90 days |
| `canary`          | Never                                      | CI-only previews; no support promise                               |

Before `1.0.0`, the framework is pre-release: a fix lands on the channel that
came next in the promotion order, and an older alpha or beta is not patched.
There is deliberately no long-term-support branch yet — an LTS line starts only
after a stable release has run in production for a release cycle, and promising
one earlier would be a claim the project cannot fund at one maintainer.

Releases are promoted forward only: `release/alpha` → `release/beta` →
`release/rc` → `main`. A fix for a shipped stable release enters through the
channel matching its severity and is promoted forward; the mechanism is the one
[`releasing.md`](./releasing.md) documents.

## Response targets

These are targets for a one-maintainer project with a security process, not
contractual SLAs.

| Stage                                | Target                 |
| ------------------------------------ | ---------------------- |
| Acknowledgement of a security report | 3 business days        |
| Triage and severity assignment       | 7 business days        |
| Critical fix or mitigation           | 7 days after triage    |
| High-severity fix                    | 30 days after triage   |
| Medium-severity fix                  | 90 days after triage   |
| Low-severity fix                     | Next scheduled release |
| Acknowledgement of a defect report   | 7 business days        |

A report that requires coordination with a dependent project, or with npm for a
registry-level issue, may take longer; the status update states why.

## What support covers

- the framework packages published from `packages/`, at the release the report
  names;
- the documented contracts in this directory and the package READMEs;
- the release guards: version synchronization, the publish matrix, the public API
  snapshot, and the documentation checks.

Support does not cover an application's handlers or data model, a third-party
store, broker, or database client, or a deployment platform's configuration. A
report that turns out to be application behavior is answered with the reason and
the contract it conflicts with.

## Reporting

- Suspected vulnerabilities: GitHub private vulnerability reporting on the
  repository's Security tab. Never a public issue. See
  [`SECURITY.md`](../SECURITY.md).
- Defects and questions: GitHub Issues, with the package, version, and a
  reproduction.

## Verification

The support policy and the release guards are checked by the repository's own
lanes:

```bash
bun test scripts
bun run release:verify
bun run release:dry-run
```
