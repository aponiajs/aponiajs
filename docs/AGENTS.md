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
| `libraries.md`              | Authoring, checking, and publishing an AponiaJS library                                                                                   |
| `auth.md`                   | Bearer JWT authentication, OIDC discovery, refresh rotation, revocation, guards, and password hashing                                     |
| `audit.md`                  | Bounded, redacting audit events and the store contract                                                                                    |
| `tenancy.md`                | Request-scoped tenant resolution, guard, and identifier policy                                                                            |
| `queues.md`                 | In-process jobs, retries, dead letters, idempotency, and the transactional outbox                                                         |
| `database.md`               | The Drizzle boundary, transaction variants, repositories, and ordered SQL migrations                                                      |
| `deployment.md`             | Topology, state ownership, readiness and liveness, shutdown, configuration, observability, and failure modes                              |
| `adapters.md`               | Hono, H3, and Nitro delivery adapters and their boundaries                                                                                |
| `stability.md`              | The frozen public API snapshot, compatibility, change classes, and the deprecation policy                                                 |
| `feature-status.md`         | Per-package completeness and the known gaps outside the current release                                                                   |
| `threat-model.md`           | Trust boundaries, the control behind each threat, residual risks, and the review checklist                                                |
| `README.md`                 | The documentation index, reading order, authority order, and the page standard                                                            |
| `ai-agents.md`              | The operating contract for an AI agent: context order, change protocol, safety boundaries, and evidence                                   |
| `metrics.md`                | The Prometheus registry, recorded request metrics, scrape endpoint, and series bounds                                                     |
| `migrating-from-nest.md`    | The package, authoring, validation, error, and CLI mapping from NestJS to AponiaJS                                                        |
| `microservices.md`          | Message patterns, CBOR client/server, and optional broker adapters                                                                        |
| `mcp.md`                    | The standard Model Context Protocol server, protocol negotiation, tools, resources, and prompts                                           |
| `openapi.md`                | Serving an OpenAPI document for an application's routes, what the document reflects, and what it does not claim                           |
| `configuration.md`          | Declaring, validating once at boot, injecting, and reading back a configuration                                                           |
| `lifecycle.md`              | The five moments a provider can hook, what the framework does when one fails, stopping on a signal, and the readiness and liveness probes |
| `eden-treaty.md`            | Native-style application types consumed through Eden Treaty                                                                               |
| `elysia-compatibility.md`   | Supported Elysia versions and how a mismatch fails                                                                                        |
| `introspection.md`          | Projecting a compiled application into frozen, serializable data                                                                          |
| `enhancers.md`              | Guards, interceptors, and exception filters on a route's hooks                                                                            |
| `logging.md`                | Logger configuration and the bootstrap log lines                                                                                          |
| `testing.md`                | Testing applications through `application.handle`, and the `@aponiajs/testing` kit                                                        |
| `request-context.md`        | The per-request async local storage context, request ID correlation, and injectable service                                               |
| `cli.md`                    | The generator catalog, aliases, and options                                                                                               |
| `devtools.md`               | The opt-in devtools API, mounted on the application's own route table, and what each endpoint does and does not report                    |
| `packages.md`               | The published package catalog                                                                                                             |
| `releasing.md`              | Channels, the version gate, and the publish flow                                                                                          |
| `agent/`                    | The read-only MCP surface, tools, recipes, and security defaults                                                                          |
| `learn/`                    | The ordered chapters that teach the same material in sequence                                                                             |

## The generated site

`bun run docs:build` renders every page here, plus `learn/` and `agent/`, into a
static site under `docs-site/` with a shared navigation, an index, and a
previous/next chain inside each group. Internal `.md` links become `.html`
links; a link that leaves `docs/` points at the repository blob URL. The site is
built from these files, so a page only appears there if it exists here, and
`scripts/docs-site.spec.ts` fails when a document has no page or a page keeps a
relative `.md` link. The site also writes `search-index.json` and renders a
search box on every page; the index carries each page's title, headings, and a
plain-text excerpt.

`.github/workflows/docs.yml` builds the same site on every push to `main` and
publishes it to GitHub Pages. It runs the command the workstation runs; do not
give the workflow its own generator or its own copy of the Markdown.

## The learning path

`learn/` is the ordered walkthrough: numbered chapters, each opening with the
case it applies to and closing with a link to its successor and to the reference
document that covers it in depth. It teaches; `docs/` proper is the reference.

Adding a chapter means keeping the numbering contiguous, listing it in
`learn/README.md`, and chaining it from its predecessor.
`scripts/learning-path.spec.ts` enforces all three. Renumbering an existing
chapter breaks inbound links, so append rather than insert unless the order is
genuinely wrong.

## Page standard

Every page is written for a reader who will act on it, including an agent that
has no prior context. Keep the structure stable:

- Open with one `H1` and one short paragraph that states what the page covers,
  who it serves, and what it deliberately leaves out.
- Put the contract before the example: what is enforced, what is guidance, and
  what the framework does not do.
- Show the smallest runnable example. If it calls `application.get`, the same
  snippet shows where the application came from.
- State the failure behavior a reader is likely to hit, with the exact code or
  status rather than a paraphrase.
- End with the verification command and links to the owning package and related
  pages. Do not duplicate a package README; link to it.

Use one idea per `H2`. Use tables for enumerations, option fields, state
ownership, and failure modes. Name the exact identifier, path, command, or
error code; do not introduce a synonym for a framework term. `MUST`,
`MUST NOT`, `SHOULD`, and `MAY` state requirements and recommendations.

For AI readability, front-load the decision, keep one canonical place for each
fact, avoid pronouns that point across sections, and spell out an acronym on
first use. A page that needs another page's contract to be understood is
missing a link, not a paragraph.

Adding a page means adding it to the table above, to the task map in
[`README.md`](./README.md), and to the learning path only when it is
sequential teaching material rather than reference.

## Invariants

- A public behavior change ships with its documentation in the same pull
  request, in `docs/` and in the affected package README.
- Documentation is guarded by tests. `scripts/documentation.spec.ts` requires
  `bun add --global @aponiajs/cli`, forbids `bunx aponia`, requires every module
  package README to show module registration and a factory boot, and rejects a
  snippet that calls `application.get(...)` without showing where the
  application was created. Adapter READMEs must lead with `## Use it` and keep
  raw-plugin guidance in a final `## Native escape hatch`. A wording edit can
  fail `bun test`.
- Every example in a document must compile against the current API. Prefer
  copying from a passing test over writing fresh snippets.
- All content is English. Scan before finishing:
  `rg -nP '[\x{0E00}-\x{0E7F}]' --glob '!node_modules/**' --glob '!dist/**' .`
- `AGENTS.md` is the real file everywhere; `CLAUDE.md` and `GEMINI.md` are
  symlinks to it. Edit `AGENTS.md`.
