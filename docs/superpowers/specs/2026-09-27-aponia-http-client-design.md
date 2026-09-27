# An outbound HTTP client provider

Status: design.

## Why this document

Nothing in AponiaJS calls outbound HTTP. Every package the repository publishes
serves a request or shapes a response; none of them makes a call, and no document
states what a service should inject when it needs to call another service. Taking
up that question is a **scope change**, because it is the first time the framework
is asked to have an opinion about the client half of the wire — and this document
answers it by deciding the framework will not ship a client surface, and by
designing the pattern an application uses instead.

The question arrives with a real argument against asking it at all. A maintained
fetch client is already injectable as a plain value provider:

```ts
provideValue(USERS_API, ofetch.create({ baseURL, headers, timeout, retry }));
```

`createToken` (packages/common/src/tokens/token.ts:3), `provideValue`
(packages/common/src/providers/provider.ts:9), `provideFactory`
(:17), the module `exports`/`imports` visibility rule
(packages/core/AGENTS.md:40-44), and `@Inject` (docs/dependency-injection.md:55-83)
are everything the line above needs, and they exist today. The counter-argument is
that a new package would be a tax on a solved problem. The section "What the
framework adds" answers it by enumerating what a package would add over that line
and finding each candidate thin; the recommendation is the pattern, and the
document designs the pattern rather than a package.

## What the framework has today

Each fact below is read from a file or a command; the evidence list repeats them
so a verifier can check one sentence at a time.

**No framework source makes an outbound call.** `rg -n "\bfetch\b"
packages/*/src --glob '*.ts'` answers exactly one hit,
`packages/devtools/src/server/devtools-server.ts:143`, and it is the _serving_
side — the handler `Bun.serve` is given, not a call the framework makes:

```ts
// packages/devtools/src/server/devtools-server.ts:140-144
const server = Bun.serve({
  hostname: host,
  port,
  fetch: (request) => routeRequest(request, handlers),
});
```

No workspace manifest declares an HTTP client:
`rg -n "axios|ofetch|ky|got|node-fetch|undici" packages/*/package.json package.json`
answers nothing. (The one `undici-types` in `bun.lock:694` is the type package
`@types/node` depends on, not a client.) So nothing is even available to call
outbound with today.

**Bun ships `fetch` and nothing ergonomic over it.** The installed declarations
declare one global, with no instance defaults:

```ts
// node_modules/.bun/bun-types@1.4.2/node_modules/bun-types/globals.d.ts:2145
declare function fetch(
  input: string | URL | Request,
  init?: BunFetchRequestInit,
): Promise<Response>;
```

A base URL, default headers, a timeout, and a retry policy are not built from that
signature. They are what an ergonomic layer supplies, and the repository declares
`@types/bun` as `^1.4.2` (root `package.json:53`), installed at `1.4.2`, with
`bun@1.4.2` in `packageManager`.

**Nest, this repository's reference for application organization, chose `fetch`
too.** The framework takes Nest's shape as its model (`docs/architecture-and-style.md`,
"Design direction"), so Nest's own client is the relevant prior art, and it is
read rather than recalled. The current chapter
(`https://docs.nestjs.com/application/http-client`; its source is
`content/application/http-client.md` in `nestjs/docs.nestjs.com`, read
2026-09-27) states:

> Most applications call other services over HTTP. The `@nestjs/http-client`
> package provides a client for this, built on the `fetch` API that ships with
> Node.js.

and, of the module it supersedes:

> This package replaces the Axios-based `HttpModule` from `@nestjs/axios`, which
> this chapter used to describe.

> The `@nestjs/axios` package remains available, and both packages can be
> installed side by side while you migrate.

The features it adds over bare `fetch` are the required surface — "base URLs,
default headers, JSON bodies, path and query parameters, typed responses", plus
"timeouts, retries, interceptors, and named clients". Two of its decisions are
recorded here because this document follows them: "Retries are on by default",
and "The timeout applies to each attempt, not to the whole call." One it does not
make is runtime response checking — "Nothing checks it at runtime, so validate
responses from APIs you don't control" — and this document's boundary is drawn in
the same place.

**The Reuse Before Build rule forbids a handwritten client.** `AGENTS.md:413-424`
requires general-purpose behavior to come from a maintained package, and names
the criteria: "active maintenance, TypeScript declarations, a compatible license,
and verified Bun support", with custom code reserved for "Aponia-specific domain
behavior when no suitable maintained package exists." The same section states the
sibling rule, "Standards beat bespoke contracts: when an ecosystem specification
already exists for a boundary, adopt it instead of inventing an Aponia-only
shape." `fetch` is that specification for the call itself.

**The injection machinery a service needs already exists and adds nothing.** The
four provider factories are `provideValue` (packages/common/src/providers/provider.ts:9),
`provideFactory` (:17), `provideClass` (:30), and `provideAlias` (:42); the token
constructor is `createToken` (packages/common/src/tokens/token.ts:3), and
`tokenName` (:10) is how a token renders in diagnostics. `docs/dependency-injection.md`
documents all of them — `:8-53` for the providers, `:55-83` for tokens and
`@Inject`, `:85-107` for visibility. Resolution is the module's own providers
first, then the imports that `export` the token (packages/core/AGENTS.md:40-44),
so a client bound in one module and exported reaches only the modules that import
it.

**The obvious home for a shared surface is closed.** The dependency direction is
`common` ← `core` ← `platform-elysia`, one-way, and `AGENTS.md:132-134` forbids
adding "Elysia, HTTP, or Bun runtime APIs" to `common`. `common`'s only runtime
dependency is `reflect-metadata` (`AGENTS.md:27`, packages/common/AGENTS.md:9-11);
its manifest also declares `@standard-schema/spec`, but every import of it is
type-only (`packages/common/src/routing/route-schema.ts:1`), so it contributes no
runtime edge.

**The framework's inbound error contract is not an outbound one.** `HttpError`
and the RFC 9457 Problem Details mapping are the platform's _response_ to a
failing request (`AGENTS.md`, "Errors"). A service's failed _call_ is application
domain; the closed `AponiaErrorCode` union has no member for it and this document
does not add one.

## What changes

Nothing in framework code changes. What changes is that the framework states an
answer where it has none, and publishes the pattern that answer implies.

| #   | Today                                                                                     | Change                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | No framework call site calls outbound HTTP; no document says what a service should inject | `docs/` gains the recipe: a token, one configured client, and the provider that binds it                                                 |
| 2   | The substrate is chosen by whoever writes the first call                                  | The substrate is the platform's own `fetch`; the ergonomic layer is `ofetch`, named with the criteria applied and its runner-up recorded |
| 3   | The injection shape is whatever a service invents                                         | Fixed: `createToken` + `provideValue`/`provideFactory`, module-scoped and exported, resolved by the existing graph                       |
| 4   | Nothing states whether the framework owns a client                                        | It does not: no package ships, and the recipe is documentation, not API                                                                  |

## The contract this settles

### 1. The substrate is `fetch`; the ergonomic layer is `ofetch`

The call is the platform's `fetch` (globals.d.ts:2145). The layer over it is a
maintained library, chosen by the four criteria the repository names and by fit.
`ofetch` is chosen; `ky` is the runner-up and is named below with why it lost.

| Criterion    | `ofetch`                                                                                                      | `ky`                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Bun support  | documented: a `proxy` option and `HTTP_PROXY`/`HTTPS_PROXY` handling are described for Bun                    | documented: "Ky targets modern browsers, Node.js, Bun, and Deno."              |
| Declarations | ships `./dist/index.d.ts`                                                                                     | ships `./distribution/index.d.ts`                                              |
| License      | MIT                                                                                                           | MIT                                                                            |
| Maintenance  | repository pushed 2026-09-27; last main-branch commit 2026-07-08; stable `1.5.1` (2025-11-01); `2.0` in alpha | repository pushed 2026-09-16; commits 2026-09-14; release `2.1.0` (2026-08-28) |
| Runtime deps | 3 (`ufo`, `destr`, `node-fetch-native`)                                                                       | 0                                                                              |
| Fit          | runtime-agnostic; `create({ baseURL, headers, timeout, retry })` is the required surface one-for-one          | browser-first; `engines: node >=22`                                            |
| Adoption     | 32.5M weekly downloads                                                                                        | 7.9M weekly downloads                                                          |

Each cell was read on 2026-09-27 from the npm registry
(`https://registry.npmjs.org/<package>` and its `/latest`), the npm downloads
API, and the GitHub API record for `unjs/ofetch` and `sindresorhus/ky`; neither
package is installed in this checkout. The two are close, and
the runner-up is stated rather than buried: **`ky` loses on fit, not on quality.**
It is browser-first — its readme opens "Ky is a tiny and elegant HTTP client based
on the Fetch API" and leads with browser targets — it pins `engines` to Node 22,
and its typed body is method-chained (`.json<T>()`) where `ofetch` returns the
typed value from the call itself. It wins on the two criteria this document weighs
least: release recency, and zero runtime dependencies where `ofetch` carries
three. For a server-side Bun framework, an explicitly runtime-agnostic client with
four times the adoption is the better default, and the choice is reversible at the
recipe level — a service names `$Fetch` and one configuration object, not a
framework type.

### 2. The injection shape is a token and a value or factory provider

There is no new provider kind, no new resolution tier, and no new decorator. A
client is a value the application owns, bound to a token it names, and the module
that binds it exports the token so importers can reach it (pattern from
docs/dependency-injection.md:8-53 and packages/core/AGENTS.md:40-44):

```ts
// http.module.ts — the application's own module, not a framework export.
import { createToken, Module, provideFactory, provideValue } from "@aponiajs/common";
import { ofetch, type $Fetch } from "ofetch";

export const USERS_API_URL = createToken<string>("USERS_API_URL");
export const USERS_API = createToken<$Fetch>("USERS_API");

@Module({
  providers: [
    provideValue(USERS_API_URL, "http://127.0.0.1:4000"),
    provideFactory(USERS_API, [USERS_API_URL], (baseURL: string) =>
      ofetch.create({
        baseURL,
        headers: { accept: "application/json" },
        timeout: 5_000,
        retry: 2,
        retryDelay: 200,
      }),
    ),
  ],
  exports: [USERS_API],
})
export class HttpModule {}
```

`provideFactory` rather than `provideValue` because the client is built from a
base URL the application supplies as its own provider value (`USERS_API_URL`
above), resolved as an injected dependency. The base URL arrives as a supplied
value, not as an inline environment read; an application whose base URL is fixed
can bind `USERS_API` with a single `provideValue` unchanged. Where that value
comes from — and its validation — is the configuration surface's concern, and
this recipe does not depend on that design shipping first. Either way the value
is resolved once and cached per module, like every provider
(packages/core/AGENTS.md:45-46), and a module that does not import `HttpModule`
cannot reach `USERS_API` — the visibility rule does the scoping, which is the
reason to use the container rather than a module-level singleton.

A service injects the token, because `$Fetch` is an interface-like type that
`design:paramtypes` cannot name (docs/dependency-injection.md:55-83):

```ts
@Injectable()
export class UsersService {
  constructor(@Inject(USERS_API) private readonly usersApi: $Fetch) {}

  findUser(id: string): Promise<User> {
    return this.usersApi<User>(`/users/${id}`);
  }
}
```

### 3. Configuration is instance defaults, overridable per call

The recipe pins the five things the brief asks for at `ofetch.create`:

- **base URL** (`baseURL`) — resolved once per client, so no call site repeats a
  host;
- **default headers** (`headers`) — merged under each call's own headers;
- **timeout** (`timeout`, milliseconds) — per attempt; ofetch arms a fresh
  `AbortSignal.timeout` on each retry (`ofetch` `src/fetch.ts`);
- **retries** (`retry`, `retryDelay`) — stated explicitly, because a client that
  retries without its policy being written down is a client nobody can reason
  about;
- **typed response** — the generic on the call (`this.usersApi<User>(...)`).

Per-call overrides ride the second argument (`this.usersApi<User>("/users", { method: "POST", body })`),
which is the library's surface and not the framework's. The recipe states the
defaults rather than inheriting them: a maintained client changes its defaults
between releases, and the pattern must not.

### 4. A typed response is compile-time; runtime validation is the application's

`ofetch<User>(...)` types the value; it does not check it at run time, the same
boundary Nest draws ("Nothing checks it at runtime, so validate responses from
APIs you don't control"). An application that wants runtime checking puts it in
the client's `onResponse` hook, where the validator can be one of the
application's Standard Schema validators — the same contract its route models
satisfy (packages/common/src/routing/route-schema.ts). The framework supplies no
helper for it, because outbound validation is a policy an application should state
rather than a service the framework should silently perform.

### What the framework adds

The counter-argument at the top of this document is answered by enumerating what a
package would hold that `provideValue(TOKEN, ofetch.create({...}))` does not:

| Candidate addition                                | Verdict                                                                                                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| A frozen token constant a reader imports by name  | A name, not a capability; `createToken` already returns a frozen, identity-carrying token (token.ts:3-8)                                              |
| A module that binds a named client per service    | Expressible today as `defineModule` + `provideFactory`; a package for it is the same value provider with a home                                       |
| Response validation through Standard Schema       | ~10 lines in `onResponse`, and arguably the application's decision; the framework owning it would be speculation                                      |
| Mapping failures to a closed `AponiaErrorCode`    | A category error: outbound failures are application domain, and the union is the framework's inbound contract                                         |
| Outbound calls in the devtools `/requests` record | Genuine framework value and out of scope here — devtools reports what a boot served, not what it called                                               |
| AOT/descriptor support for a client provider      | None needed: a value or factory provider is already lowered, and a token imported by name is accepted (`descriptor-emitter.ts:871`, `:1092`, `:1362`) |

Every candidate is either already expressible or not worth owning. The answer is
thin, and the recommendation is therefore the pattern over the surface.

## Options considered and rejected

**A new leaf package, `@aponiajs/http`.** This is the option the brief costed, and
it is rejected because the added value is thin: the package would re-export a
library's client and a token, and the framework would own a public contract, a
release cadence, and a coverage burden for a wrapper. The full cost of the option
is recorded so the rejection is auditable. A new publishable package would touch:

- the package itself — `packages/http/{package.json,AGENTS.md,CLAUDE.md,GEMINI.md,README.md,llms.txt,tsconfig.json,src/index.ts,tests/,tests-vp/}`,
  where `AGENTS.md` is the real file and `CLAUDE.md`/`GEMINI.md` are symlinks
  (`scripts/agent-guides.spec.ts:48-54`);
- `packages/http/package.json` — a `name`, the synchronized `version`, and
  `files: ["dist", "llms.txt"]`; `scripts/package-llms.spec.ts:39-56` requires the
  `llms.txt` and its listing, and `:15` keeps `packages/aponiajs` the one private
  exception;
- `scripts/workspace-versions.ts:3-22` — one entry in `versionedPackageFiles` and
  one in `versionedWorkspacePaths`, or `bun run version:sync` and the lockfile
  drift;
- `scripts/agent-guides.spec.ts:4-15` — one entry in `guideDirectories`, and the
  root `AGENTS.md` must then index `(packages/http/AGENTS.md)` (`:26-30`);
- `scripts/source-layout.spec.ts:11-62` — one `PackageLayout`, with the owner
  directories the package uses;
- `scripts/toolchain-config.spec.ts:24-42` — it discovers `packages/*`, so
  `packages/http/tsconfig.json` must declare `experimentalDecorators` and
  `emitDecoratorMetadata`;
- `scripts/coverage-gate.ts:98-114` — its glob covers `packages/http/src/**/*.ts`,
  so every runtime source must appear in LCOV and the aggregate 95% floor must
  hold;
- root `package.json:34` — the `version:bump` file list, and `:47` — the
  `release:dry-run` `for package in …` loop;
- `.github/workflows/publish.yml:114-120` — a `07-http` pack destination and pack
  command, plus `:140`, the alias-tag `for package in …` list;
- `.github/workflows/canary.yml:66-72` — the canary pack destinations;
- `docs/packages.md:3,118` and `docs/releasing.md:7,65,160` — "six" becomes
  "seven", plus a table row in the first and the ordered publish list in the
  second;
- the root `AGENTS.md` package table (`:24-33`) and "Current scope" list
  (`:372-390`);
- `vite.config.ts:5-13` — an alias only if a lane outside the package imports it
  by name; a leaf that nothing depends on has none;
- `bun.lock` — the workspace entry;
- and it must clear the release matrix `bun run check`, `bun run test:coverage`,
  `bun run test:examples`, `bun run test:vite-plus`, `bun run build`,
  `bun run test:generated-app`, `bun run release:dry-run`, and
  `bun audit --audit-level=high` (`scripts/ci-workflows.spec.ts:3-11`).

That is the price of a package that adds a token and a re-export. It is not a
price a `provideValue` call justifies.

**The surface in `@aponiajs/common`.** Forbidden outright: `AGENTS.md:132-134`
bans HTTP and Bun runtime APIs from `common`, and this document treats that ban as
absolute. A token alone would technically not import HTTP, but a token is useless
without the client it names, and a `common` that exported a fetch-client contract
would be a different package.

**The surface in `@aponiajs/platform-elysia`.** A category error: the platform is
the _server_ adapter, it lowers routes and mounts plugins, and an outbound client
has nothing to lower. It would also make every application that never calls out
carry the dependency.

**A handwritten wrapper over `fetch`.** Forbidden by Reuse Before Build
(`AGENTS.md:413-424`). The layer this document asks for — base URL, headers,
timeout, retry — is exactly the general-purpose behavior that section reserves for
a maintained package.

**A package that only re-exports the library.** Rejected: it makes the framework's
release cycle the library's — an `ofetch` major would force an Aponia major — and
it gives a reader a framework-shaped name for a library API, which is the
worst of both surfaces.

**A Nest-style `HttpModule.forRoot` with named clients.** Expressible today with
`defineModule` + `provideFactory`, one token per named API. Documenting the
pattern is the recipe; a module that performs it is the thin package again.

**Adopting the library's retry defaults silently.** Rejected: a client that
retries unsafe methods because a library changed its default is a bug no test
sees. The recipe writes `retry`, `retryDelay`, and `timeout` into the
configuration so the policy is in the application's source.

## What this does not change

- **The dependency direction and `common`'s dependency ban.** `common` ← `core` ←
  `platform-elysia` stands, and no HTTP type enters `common` (`AGENTS.md:132-134`).
- **The provider kinds and resolution rules.** `provideValue`, `provideFactory`,
  `provideClass`, and `provideAlias` are unchanged, and resolution stays "own
  providers first, then exporting imports, `AMBIGUOUS_PROVIDER` for two"
  (packages/core/AGENTS.md:40-44).
- **`HttpError` and the Problem Details mapping.** They remain the platform's
  response to a failing inbound request; a failed outbound call is not routed
  through them.
- **The devtools record.** `/requests` still reports what a boot served, not what
  a service called; outbound calls stay invisible to it.
- **The "Current scope" list.** `AGENTS.md:372-390` names what the release
  implements; no framework surface is added here, so the list does not move.
- **Every published package's public API.** None is touched.

## Delivery order

Two changes, and the first proves the second.

1. **The executable case.** An application that binds `USERS_API` with
   `provideFactory`, exports it, injects it into a service, and calls a second
   local application it starts itself. It is an example, so its manifest declares
   `ofetch` — which moves `bun.lock` — and, when it is a new directory, it adds
   its `example:<name>` script and its row in `examples/README.md`
   (`examples/AGENTS.md`). This is the change that makes the pattern real; it
   lands first so the documentation copies working code rather than inventing
   snippets, which the docs guide requires ("Every example in a document must
   compile against the current API").
2. **The documentation.** The recipe — the token, the module, the service, the
   configuration defaults, the typed response, and the runtime-validation
   boundary — in the document that owns it, with its worked example taken from
   step 1.

The synchronized version still rises on the push that carries both, per the
repository's per-push rule (`AGENTS.md`, "Commit & Pull Request Guidelines"), even
though no published package's content changes; the smallest valid command is
`bun run version:alpha`.

## What remains, deliberately

- **The framework ships no client surface.** This document decides that, and it is
  the point of the document rather than a gap in it.
- **Runtime response validation is not provided.** An application that wants it
  writes it into `onResponse`; the framework does not decide for it whether a
  response should be checked.
- **Outbound calls stay invisible to devtools.** Reporting them would be a
  different design — a tap a client publishes to — and a larger one than the brief
  asks for.
- **The framework cannot enforce a timeout or a retry policy.** Those are the
  library's behavior and the application's configuration; nothing in the framework
  observes them.
- **Named clients are expressible but not designed.** A second service is a second
  token and a second `provideFactory`; the recipe does not generalize this into a
  registry.
- **The library choice can age.** The criteria are recorded so the choice can be
  re-weighed, not so it is permanent.

## Testing

- **The recipe is proved by an executable case, not a snippet.** A module binds
  the token with `provideFactory`, a service injects it, and a call against a
  callee the test starts itself — `Bun.serve` on an ephemeral port, never a fixed
  one — returns a parsed, typed body. The case is an example under `examples/**`,
  which `bun run test:examples` runs, not a unit or conformance case. The
  documentation's code is copied from this case.
- **The visibility contract the pattern rests on is pinned by a failing case.** A
  module that does not import the module exporting the token cannot resolve it,
  and the boot fails with `MISSING_PROVIDER`; a module that does import it
  resolves the same cached instance. This is what makes the choice of the
  container over a module singleton testable, and it asserts the code, not the
  message (RULES.md:79-80).
- **The configuration is asserted on behavior.** A `retry` count is asserted
  from the callee's side — how many requests it received — so the recipe's stated
  policy is proved rather than quoted.
- **Documentation guards.** A new published page is inside the `docs/*.md` scan
  (`scripts/documentation-versions.spec.ts:13-21`, `scripts/retired-literals.spec.ts:31-47`),
  and any example directory is inside `examples/**`; both must pass unchanged.
- **No runtime source changes**, so the LCOV source set and the 95% floor are
  unaffected; the full matrix (`bun run check`, `bun run test:coverage`,
  `bun run test:examples`, `bun run test:vite-plus`, `bun run build`,
  `bun run test:generated-app`, `bun run release:dry-run`, and
  `bun audit --audit-level=high` — scripts/ci-workflows.spec.ts:3-11) still runs
  before the push.

Every case carries a mutation that makes it fail alone.

## What this document does not decide

- **Where the recipe lives.** `docs/dependency-injection.md` already owns tokens,
  providers, and visibility (`:8-107`) and could carry a section; the topic is also
  large enough for a page of its own, which would then join the set in
  `docs/AGENTS.md`. That is a documentation-layout decision for the plan.
- **The recipe's names.** `USERS_API`, `HttpModule`, and `$Fetch` above are
  illustrative; the plan settles the example's own names.
- **The library version the example pins.** The recipe names `ofetch` and the
  manifest pins a range; which range is a dependency decision.
- **Whether named clients are documented.** The recipe shows one service; whether
  the page also shows two is a documentation decision the plan makes.
- **The executable case's vehicle.** A new `examples/http-client/` directory or a
  case inside `examples/dependency-injection/` both satisfy "Testing"; the
  examples guide prefers the closest existing example when the topic is a
  variation, and a new directory when it is its own. The plan picks one.
- **Whether outbound observability is ever a devtools feature.** Rejected here as
  out of scope, not designed anywhere; if it is wanted it needs its own document,
  because it would make devtools depend on the client's tap.
