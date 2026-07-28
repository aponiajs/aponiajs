# docs — Agent Guide

Read the [repository guide](../AGENTS.md) first.

## What this directory owns

The published documentation set:

| File                        | Covers                                                        |
| --------------------------- | ------------------------------------------------------------- |
| `architecture-and-style.md` | Application layout, naming, and the patterns Aponia expects   |
| `dependency-injection.md`   | Tokens, visibility, providers, and the error codes on failure |
| `native-plugins.md`         | Mounting native Elysia plugins and typing what they add       |
| `logging.md`                | Logger configuration and the bootstrap log lines              |
| `testing.md`                | Testing applications through `application.handle`             |
| `cli.md`                    | The generator catalog, aliases, and options                   |
| `packages.md`               | The published package catalog                                 |
| `releasing.md`              | Channels, the version gate, and the publish flow              |
| `learn/`                    | The ordered chapters that teach the same material in sequence |

## The learning path

`learn/` is the ordered walkthrough: numbered chapters, each opening with the
case it applies to and closing with a link to its successor and to the reference
document that covers it in depth. It teaches; `docs/` proper is the reference.

Adding a chapter means keeping the numbering contiguous, listing it in
`learn/README.md`, and chaining it from its predecessor.
`scripts/learning-path.spec.ts` enforces all three. Renumbering an existing
chapter breaks inbound links, so append rather than insert unless the order is
genuinely wrong.

## Invariants

- A public behavior change ships with its documentation in the same pull
  request, in `docs/` and in the affected package README.
- Documentation is guarded by tests. `scripts/documentation.spec.ts` requires
  `bun add --global @aponiajs/cli` and forbids `bunx aponia`; `ROADMAP.md` must
  carry the current version line. A wording edit can fail `bun test`.
- Every example in a document must compile against the current API. Prefer
  copying from a passing test over writing fresh snippets.
- All content is English. Scan before finishing:
  `rg -nP '[\x{0E00}-\x{0E7F}]' --glob '!node_modules/**' --glob '!dist/**' .`
- `AGENTS.md` is the real file everywhere; `CLAUDE.md` and `GEMINI.md` are
  symlinks to it. Edit `AGENTS.md`.
