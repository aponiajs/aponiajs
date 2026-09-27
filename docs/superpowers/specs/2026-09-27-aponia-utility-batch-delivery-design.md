# The utility batch — how it lands

Status: design. Delivery design for five utility-surface documents:

| Document                                      | Ships                                                                                                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-09-27-aponia-file-handling-design.md`   | upload documentation and an example, a download helper in `@aponiajs/platform-elysia`, and a static-serving recipe                                    |
| `2026-09-27-aponia-request-context-design.md` | an opt-in per-request store read through `RequestContextService`, in `@aponiajs/platform-elysia`                                                      |
| `2026-09-27-aponia-configuration-design.md`   | `defineConfiguration` in `@aponiajs/common`, `provideConfiguration` and `AponiaElysiaApplication.get` in `@aponiajs/platform-elysia`, two error codes |
| `2026-09-27-aponia-http-client-design.md`     | an example and a recipe; no framework code                                                                                                            |
| `2026-09-27-aponia-logger-seam-design.md`     | a boot-logger observer and a `LOGGER` token over a predefined resolution tier; pre-existing, not replaced                                             |

This document owns what none of them does: the release plan, the shared guard
edits, the `llms.txt` additions, the scope-of-record edit, the error-code
additions, and the order. It designs no feature.

## 1 · The release plan

The workflow facts, read from the files:

- CI runs on every push and pull request (`ci.yml:3-6`), and its `version` job
  requires the pushed version to exceed the base it compares against
  (`ci.yml:35-49`, `verify-release.ts:57-61`).
- A push to `release/alpha`, `release/beta`, `release/rc`, or `main` starts the
  release workflow (`release.yml:3-9`); it creates the tag and GitHub release
  (`release.yml:48-66`) and calls the publish workflow (`release.yml:68-78`).
- The publish workflow packs all six published packages (`publish.yml:112-120`)
  and publishes them in dependency order under the tag the version resolves to
  (`publish.yml:122-130`), then moves the alias tags (`publish.yml:132-144`).
- So a merge into `release/alpha` publishes `@aponiajs/common`, `@aponiajs/core`,
  `@aponiajs/platform-elysia`, `@aponiajs/cli`, `create-aponia`, and
  `@aponiajs/devtools` together under `alpha`, and `next` follows
  (`docs/releasing.md:57-58`). This is true of a merge that changes no package
  content — the http-client document states it for its own docs-only push.

**The batch lands as one branch per document, five branches, each from
`release/alpha`** (`AGENTS.md:489-494`, `docs/releasing.md:80-83`) and merged
into it. Each document's own "Delivery order" states its pieces are
independently shippable, and the five touch disjoint package surfaces except at
the shared guards in §2, which are sequenced by §6.

Every push raises the synchronized version (`AGENTS.md:517-519`), so each branch
raises it at least once with `bun run version:alpha` (`package.json:38`,
`AGENTS.md:513-514`). Every merge publishes all six packages at a new `alpha`
version, so the batch produces **one published alpha version per merged branch —
five** — and at least one version bump per branch.

**No package is added, so no package-registration guard moves.** A new
publishable package would touch, at minimum: six guard specifications —
`scripts/agent-guides.spec.ts` (`:4-15`, and the symlink test `:48-54`),
`scripts/source-layout.spec.ts` (`:11-62`), `scripts/package-llms.spec.ts`
(`:39-56`, and the private-exception test `:100-107`),
`scripts/toolchain-config.spec.ts` (`:24-41`), `scripts/coverage-gate.ts`
(`:98-119`), and `scripts/workspace-versions.ts` (`:3-22`) — and seven other
files: `package.json` (`:34` version list, `:47` release dry-run loop),
`.github/workflows/publish.yml` (`:114-120`, `:140`),
`.github/workflows/canary.yml` (`:66-72`), `docs/packages.md` (`:3`, `:118`),
`docs/releasing.md` (`:7-15`), the root `AGENTS.md` package table (`:25-33`), and
`bun.lock`. Two more guards glob `packages/*` and would pick a new package up
without an edit: `scripts/documentation-versions.spec.ts` and
`scripts/retired-literals.spec.ts`. The batch edits one of the package guards
(`source-layout.spec.ts`, §2) for directories inside existing packages, and no
other package-registration file.

## 2 · The shared guard edits

**`scripts/source-layout.spec.ts`** holds an exact-match owner-directory list per
package. The batch adds three directories:

- `packages/common/src` gains `configuration` (`configuration-design.md`,
  "Delivery order" step 6); the list is at `source-layout.spec.ts:15-26`.
- `packages/platform-elysia/src` gains `configuration` (same step) and
  `request-context` (`request-context-design.md`, "Delivery order" step 1); the
  list is at `source-layout.spec.ts:36-45`.
- `packages/core/src` is unchanged: the logger seam's predefined tier is a
  parameter on `compileModuleGraph` and `createContainer`, in the existing
  `graph` and `container` directories (`source-layout.spec.ts:30-31`).

File handling and the http client add no source directory and no source-layout
edit.

**`docs/AGENTS.md`** enumerates the published documents in a table
(`docs/AGENTS.md:9-25`). Three new reference pages are named by their documents
and each needs a row: `docs/configuration.md` (`configuration-design.md`,
"Delivery order" step 5), `docs/files.md` (`file-handling-design.md`,
"Delivery order" step 2), and `docs/request-context.md`
(`request-context-design.md`, "Delivery order" step 3). The http-client
document leaves its recipe's home open ("What this document does not decide"),
so its `docs/AGENTS.md` row is conditional on that plan's choice. The table is a
convention, not a guarded exact set.

**`docs/learn`** is the only place a new chapter is needed. The
`file-handling-design.md` "Delivery order" appends a chapter, `15 · Files`. The
combined edit is: create `docs/learn/15-files.md` opening `# 15 · ` with a
`**Use when:**` line and closing with a `Deep dive:` line; add its row to
`docs/learn/README.md` (`:8-23`); and replace the `Next: nothing — this is the
last chapter.` tail of `docs/learn/14-devtools.md` (`:177`) with a link to
`./15-files.md`. `scripts/learning-path.spec.ts` enforces the contiguous
numbering (`:12-17`), the index listing (`:19-29`), and the chaining
(`:40-52`). No other batch document adds a chapter.

## 3 · `packages/*/llms.txt`

Every published package ships one (`package-llms.spec.ts:39-47`) and lists it in
its manifest `files` array (`:49-56`). The batch's new public exports are
advertised in two files. The Export column names the export each document
settles, or, where a document leaves the name to its plan, the job the export
performs:

| Export                                                                                                            | Package                     | Advertised in                       |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------- |
| `defineConfiguration` (value), `ConfigurationToken`, `ConfigurationOptions` (types)                               | `@aponiajs/common`          | `packages/common/llms.txt`          |
| `LOGGER`, `observeSystemLogger`                                                                                   | `@aponiajs/common`          | `packages/common/llms.txt`          |
| the download helper's export name — a plan decision                                                               | `@aponiajs/platform-elysia` | `packages/platform-elysia/llms.txt` |
| `provideConfiguration`                                                                                            | `@aponiajs/platform-elysia` | `packages/platform-elysia/llms.txt` |
| `RequestContextModule`, `RequestContextService` (values), `RequestContext`, `RequestContextModuleOptions` (types) | `@aponiajs/platform-elysia` | `packages/platform-elysia/llms.txt` |

`AponiaElysiaApplication` is already advertised in
`packages/platform-elysia/llms.txt`; the configuration change adds its `get`
method to that existing bullet. `@aponiajs/core` gains no new export name — the
predefined tier is a parameter on `compileModuleGraph` and `createContainer` —
and the documents do not name a `core/llms.txt` edit. `@aponiajs/cli`,
`create-aponia`, and `@aponiajs/devtools` add no export.

## 4 · The scope-of-record lists

`README.md` carries the not-implemented list at `README.md:564-571`; the root
`AGENTS.md` carries its own at `AGENTS.md:386-390`. Both call their lists the
scope of record.

**One batch item removes a word, and it is README's.** The configuration
document takes "configuration" off the not-implemented list and leaves "secret
redaction" on it. The edit is `README.md:566`, `policy, configuration and secret
redaction, HTTP admission hardening,` becoming `policy, secret redaction, HTTP
admission hardening,`. The root `AGENTS.md` not-implemented list never named
configuration, so it is unchanged there.

The other four documents do not move either not-implemented list:
`request-context-design.md` adds no provider scope, so README's "request and
transient scopes" and `AGENTS.md`'s "non-singleton scopes" stay;
`http-client-design.md` ships no package, so README's "platform-neutral HTTP
packages" stays; file handling and the logger seam name no not-implemented item.

The paired edit on the implemented side is where the batch's surfaces are
recorded. `configuration-design.md` names the validated configuration under
"Implemented" in `README.md` and `AGENTS.md`; `logger-seam-design.md` names the
injectable logger under `AGENTS.md`'s "Current scope" list. Both lists are the
scope of record, so the same phrase is added to `README.md`'s implemented
paragraph (`README.md:542-562`) and to `AGENTS.md`'s (`AGENTS.md:374-386`).

## 5 · The closed `AponiaErrorCode` union

The union is declared at `packages/common/src/errors/aponia-error.types.ts:1-24`,
enumerated in the root `AGENTS.md` (`:321-333`), and taught in
`docs/learn/10-errors.md` (`:141-163`) and `docs/dependency-injection.md`
(`:115-137`). The batch adds exactly two members, both from
`configuration-design.md`: **`INVALID_CONFIGURATION`** and
**`INVALID_CONFIGURATION_VALUE`**. No other batch document adds a code:
`request-context-design.md` states "no new error code"; the download helper
refuses with a `TypeError`; `http-client-design.md` states the union gains no
member; the logger seam adds none.

Every document that has to gain them:

- `packages/common/src/errors/aponia-error.types.ts` — the union.
- `AGENTS.md` — the enumerated list at `:321-333`.
- `docs/learn/10-errors.md` — the failure table at `:141-163`.
- `docs/dependency-injection.md` — the failure table at `:115-137`.

## 6 · The order

**File handling ships first.** Its upload step changes no runtime code, so
nothing in the graph can regress with it, and the topic is named nowhere in the
docs (`file-handling-design.md`, "Why this document" and "What the workspace
does not have"). It is the only document whose first change is documentation
plus an example.

Each other document's blockers:

- **Configuration** — nothing in the batch. Its step 6 guard edit shares
  `source-layout.spec.ts` with request context; whichever lands second rebases.
- **Request context** — nothing in the batch. Its step 1 guard edit is the same
  shared one.
- **HTTP client** — nothing. It adds an example and a recipe and no framework
  code.
- **Logger seam** — its own second change. The observer is shippable alone
  (`logger-seam-design.md`, "Delivery order" 1). The token cannot ship alone:
  a provider that declares `@Inject(LOGGER)` in a module that neither owns nor
  imports the token fails `compileModuleGraph` with `MISSING_PROVIDER`, so the
  token is usable only once it joins the predefined resolution tier and the boot
  binds the resolved logger into `createContainer` — machinery designed in that
  document and implemented nowhere today. The token, the tier, the binding, the
  no-op, and their documentation are one change, and the devtools consumption of
  both is asserted last.

Order within the five: file handling first, then configuration, request context,
the http client, and the logger seam. The only forced pair is the logger seam's
observer before its token.

## 7 · What a surface throws for input it cannot use

The batch's shared convention, stated here once:

> A value the framework cannot use to **build the application** fails the boot
> with an `AponiaError` code — the graph compilers already refuse a duplicate
> module, a cycle, a token twice, an export that cannot resolve. A value an
> application hands to a framework **helper while it runs** is a caller mistake
> and is a `TypeError`, the same class the guides already use for a decorator
> misused at its decoration site and for a CLI argument attached to a flag that
> takes none.

Two documents apply one half each and point here rather than restating the rule:
`configuration-design.md` (§4) refuses an unusable declaration at boot with an
`AponiaError` code, and `file-handling-design.md` refuses a download filename the
helper cannot use with a `TypeError`.

## What this document does not decide

- The implementation of any feature; each document owns its own contract.
- The naming details each document already leaves to its plan — the download
  helper's exported name, the request-context header's validation rule, the
  configuration token's default description.
- Where the http-client recipe lives (its own document's open question), and so
  whether it adds a `docs/AGENTS.md` row.
