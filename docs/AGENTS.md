# docs — Agent Guide

Read the [repository guide](../AGENTS.md) first.

## What this directory owns

The published documentation set. `docs/README.md` is the only root index; every
page lives in one category, and each category has its own `README.md`.

| Category      | Owns                                                                                 |
| ------------- | ------------------------------------------------------------------------------------ |
| `build/`      | Layout, modules, injection, configuration, lifecycle, enhancers, testing, and views  |
| `platforms/`  | HTTP platforms, native plugins, WebSockets, Eden Treaty, and application inspection  |
| `services/`   | Auth, auditing, tenancy, jobs, database, metrics, messaging, and served protocols    |
| `tooling/`    | The CLI, library authoring, and plugin-package authoring                             |
| `operations/` | Deployment, release management, and AI-agent operation                               |
| `reference/`  | The package catalog, API index, feature status, stability, support, and threat model |
| `learn/`      | The ordered chapters that teach the same material in sequence                        |
| `agent/`      | The machine-readable manifest, guidance installer, and library checks                |

`public-api.json` is the frozen export snapshot the API page and its guard read.
`redirects.json` is the old-URL map the site serves as static redirects.

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

## Adding or moving a page

Adding a page means, in one change:

1. create it inside its category;
2. link it from that category's `README.md` table;
3. link the category from [`README.md`](./README.md) when the category is new;
4. add a `docs/redirects.json` entry when an existing URL moves;
5. run the guards below.

`scripts/docs-index.spec.ts` fails when a page is not reachable from the root
index or its category README, when a category has no README, or when a
root-level page appears outside `docs/README.md`. `scripts/docs-links.spec.ts`
fails on a missing target, a missing heading anchor, a broken GitHub blob link,
or a redirect that shadows a real page or names a missing target.

Moving a page means adding the old path to `docs/redirects.json`. Do not leave a
stub page behind, and do not redirect two old URLs to each other.
`scripts/docs-site.spec.ts` builds the site and asserts the redirect is served,
is absent from navigation and search, and carries `canonical`, `noindex`, a
meta refresh, and a script that preserves `#anchor`.

## Guards

```bash
bun run docs:lint
bun run docs:build
bun run docs:api
bun test scripts/docs-site.spec.ts scripts/docs-links.spec.ts \
  scripts/docs-index.spec.ts scripts/docs-claims.spec.ts
```

- `markdownlint-cli2` enforces the structural rules; `.markdownlint-cli2.jsonc`
  names the globs and the deliberately disabled rules.
- `scripts/docs-site.spec.ts` covers page generation, navigation groups,
  redirects, link rewriting, heading identifiers, and the learning path chain.
- `scripts/docs-links.spec.ts` resolves every relative link, every internal
  anchor against the headings the site renders, every absolute GitHub blob link
  into this repository, and every redirect entry.
- `scripts/docs-index.spec.ts` holds the one-index contract.
- `scripts/docs-claims.spec.ts` derives the package counts, publish order, and
  library sample version from the workspace and the committed documents.
- `scripts/documentation.spec.ts` and `scripts/documentation-versions.spec.ts`
  cover required CLI wording and release stamps.
- `scripts/learning-path.spec.ts` keeps chapters numbered, indexed, and chained.

## The generated site

`bun run docs:build` renders every Markdown page under `docs/`, including
`learn/` and `agent/`, into a static site under `docs-site/` with shared
navigation, an index, one previous/next chain per group, and a client-side
search index. Internal `.md` links become `.html` links; a link that leaves
`docs/` points at the repository blob URL. Heading identifiers come from the
same GFM slug rules the anchor guard uses, so a fragment that passes the guard
resolves in the built site.

Categories render in this order: Guide, Learn, Build, Platforms, Services,
Tooling, Operations, Reference, Agent. A page only appears in the site if it
exists in `docs/`; the redirect map is the one exception, and it is written
outside navigation and search.

`.github/workflows/docs.yml` builds the same site on every push to `main` and
publishes it to GitHub Pages. It runs the command the workstation runs; do not
give the workflow its own generator or its own copy of the Markdown.

## The learning path

`learn/` is the ordered walkthrough: numbered chapters, each opening with the
case it applies to and closing with a link to its successor and to the reference
document that covers it in depth. It teaches; the categories are the reference.

Adding a chapter means keeping the numbering contiguous, listing it in
`learn/README.md`, and chaining it from its predecessor.
`scripts/learning-path.spec.ts` enforces all three. Renumbering an existing
chapter breaks inbound links, so append rather than insert unless the order is
genuinely wrong.

## Facts and versions

Keep one canonical place for each fact. `reference/packages.md` owns the package
count and the npm split; `reference/feature-status.md` owns per-package
completeness; `operations/releasing.md` owns the publish order. Do not repeat a
count in another page when a link will do.

A document showing this framework's own release uses the current workspace
version. `scripts/documentation-versions.spec.ts` reads the `framework` and
`descriptors` stamps, and `scripts/docs-claims.spec.ts` reads the library
sample. Bump both when `bun run version:*` moves the workspace version.

## Invariants

- A public behavior change ships with its documentation in the same pull
  request, in `docs/` and in the affected package README.
- Documentation is guarded by tests. `scripts/documentation.spec.ts` requires
  `bun add --global @aponiajs/cli` as written in the repository, forbids
  `bunx aponia`, requires every module package README to show module
  registration and a factory boot, and rejects a snippet that calls
  `application.get(...)` without showing where the application was created.
  Adapter READMEs must lead with `## Use it` and keep raw-plugin guidance in a
  final `## Native escape hatch`. A wording edit can fail `bun test`.
- Every example in a document must compile against the current API. Prefer
  copying from a passing test over writing fresh snippets.
- All content is English. Scan before finishing:
  `rg -nP '[\x{0E00}-\x{0E7F}]' --glob '!node_modules/**' --glob '!dist/**' .`
- `AGENTS.md` is the real file everywhere; `CLAUDE.md` and `GEMINI.md` are
  symlinks to it. Edit `AGENTS.md`.
