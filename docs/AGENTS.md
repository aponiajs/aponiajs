# docs — Agent Guide

Read the [repository guide](../AGENTS.md) first.

## What this directory owns

The published documentation set:

| File                        | Covers                                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `architecture-and-style.md` | Application and framework layout, naming, and expected patterns                                                                           |
| `dependency-injection.md`   | Tokens, visibility, providers, and the error codes on failure                                                                             |
| `websockets.md`             | Nest-style gateways over native Elysia WebSockets                                                                                         |
| `native-plugins.md`         | Mounting native Elysia plugins and typing what they add                                                                                   |
| `plugin-packages.md`        | Authoring a package that ships an Aponia module wrapping a native Elysia plugin                                                           |
| `files.md`                  | Uploaded files, named downloads, and serving static assets                                                                                |
| `openapi.md`                | Serving an OpenAPI document for an application's routes, what the document reflects, and what it does not claim                           |
| `configuration.md`          | Declaring, validating once at boot, injecting, and reading back a configuration                                                           |
| `lifecycle.md`              | The five moments a provider can hook, what the framework does when one fails, stopping on a signal, and the readiness and liveness probes |
| `eden-treaty.md`            | Native-style application types consumed through Eden Treaty                                                                               |
| `elysia-compatibility.md`   | Supported Elysia versions and how a mismatch fails                                                                                        |
| `introspection.md`          | Projecting a compiled application into frozen, serializable data                                                                          |
| `enhancers.md`              | Guards, interceptors, and exception filters on a route's hooks                                                                            |
| `logging.md`                | Logger configuration and the bootstrap log lines                                                                                          |
| `testing.md`                | Testing applications through `application.handle`, and the `@aponiajs/testing` kit                                                        |
| `cli.md`                    | The generator catalog, aliases, and options                                                                                               |
| `devtools.md`               | The opt-in devtools API, mounted on the application's own route table, and what each endpoint does and does not report                    |
| `packages.md`               | The published package catalog                                                                                                             |
| `releasing.md`              | Channels, the version gate, and the publish flow                                                                                          |
| `learn/`                    | The ordered chapters that teach the same material in sequence                                                                             |

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
  `bun add --global @aponiajs/cli` and forbids `bunx aponia`. A wording edit can
  fail `bun test`.
- Every example in a document must compile against the current API. Prefer
  copying from a passing test over writing fresh snippets.
- All content is English. Scan before finishing:
  `rg -nP '[\x{0E00}-\x{0E7F}]' --glob '!node_modules/**' --glob '!dist/**' .`
- `AGENTS.md` is the real file everywhere; `CLAUDE.md` and `GEMINI.md` are
  symlinks to it. Edit `AGENTS.md`.
