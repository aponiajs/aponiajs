# @aponiajs/cli — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

`aponia new`, `aponia generate`, `aponia build`, and the Bun build plugin that
runs the build generators during a bundle. It is independent of the runtime
packages and driven by libraries rather than hand-rolled parsing.

| Domain                                     | Owns                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| `bundler/`                                 | The opt-in Bun plugin that generates before a bundle resolves anything      |
| `commands/`                                | Argument parsing, command contracts, help output, and `runCli`              |
| `generation/`                              | Naming, project discovery, file planning, renderers, module updates, writes |
| `generation/controller-routes.ts`          | Build-time route analysis of controller source                              |
| `generation/controller-invokers.ts`        | Emits route invokers as literal source for the Elysia platform              |
| `generation/module-descriptors.ts`         | Build-time analysis of module, injectable, and gateway source               |
| `generation/descriptor-emitter.ts`         | Emits the module graph as `defineModule` calls for the Elysia platform      |
| `generation/source-imports.ts`             | Which names a file can read, and which one expression reads                 |
| `generation/invoker-generator.ts`          | The `aponia build` command: scans a project and writes both modules         |
| `generation/generated-source-formatter.ts` | Lays the written modules out with the project's formatter, else this one's  |
| `generation/build-report.ts`               | The `CREATE`/`UPDATE`/`DECLINED` lines both entrypoints print               |
| `version.ts`                               | The version stamped into generated manifests                                |
| `templates/`                               | The canonical application starter input                                     |

`generation/schematic-generator.ts` only orchestrates. Configuration lookup,
file planning, rendering, module registration, and filesystem writes remain
separate focused modules. `src/index.ts` is the only public barrel.

## Invariants

- Reuse before build. CLI parsing, AST manipulation, globbing, case conversion,
  and inflection all come from maintained packages. Do not hand-roll them back.
- `runCli` prints `CREATE`/`UPDATE` change lines and returns an exit code. It
  never throws.
- Argument and generator input mistakes use plain `Error`/`TypeError`, not
  `AponiaError`.
- The flags that take no value stay declared in `parseOptions`' yargs-parser
  `boolean` list: that is what keeps a bare flag, `--no-<flag>`, and the short
  aliases meaning what they mean, and what keeps
  `aponia new --dry-run app` reading `app` as the project name. The same
  declaration makes the parser coerce an attached value, so `--dry-run=abc`
  arrived as `dryRun: false` and the guard rejecting a value was unreachable.
  `assertNoAttachedValue` therefore rejects the `--<flag>=<value>` and
  `-<alias>=<value>` spellings before `parseCliArguments` runs, through the same
  `readBooleanFlagValue` the parsed options go through, and `valueLessOptions` is
  the single list both the declaration and the pre-scan read. Extend that list,
  not a second one. `tests/flag-values.test.ts` locks the rejection and the
  position-independence.
- Requested module registration is never skipped silently. When a schematic has
  a registration kind and `--skip-import` was not passed, a target module that
  cannot be found is a plain `Error` raised before any file is written, and the
  message names `--skip-import` as the opt-out. Module lookup stays inside the
  configured source root; do not widen it to match the generated path.
- Absolute paths and traversing paths are rejected in
  `generation/component-names.ts`.
- `generation/controller-invokers.ts` emits what it can prove and declines the
  rest, reporting why. A declined handler stays on the platform's own compile
  path, so a partially generated application is a supported state. Emitted
  entries are keyed by the handler's property key, never by route index: an
  invoker depends only on the handler, and the runtime's metadata order does not
  match a source walk when decorators are stacked.
- The emitted module exports one artifact holding the invokers beside the
  AponiaJS version from `version.ts` and the Elysia version resolved from the
  project, because the platform refuses an artifact built by another release and
  compiles every route itself instead. The Elysia lookup is best-effort: it
  resolves through `Bun.resolveSync` from the project root and records `null`
  when nothing resolves, so `aponia build` still runs on a checkout that has not
  been installed. Keep `ControllerInvokerProvenance` and the platform's
  `AponiaInvokerArtifact` in step by hand, the same way the route parameter
  kinds are kept in step.
- The emitted module has to be assignable to `AponiaApplicationOptions`
  `["invokers"]` and readable by the application's own `check`, because it is
  committed source rather than a build output. Two consequences hold it there.
  Its invoker map is keyed `ClassToken<unknown>` and its invokers declare the
  context parameter `never`, which is what the platform's option accepts — a
  type import from `@aponiajs/common` for the first, and the platform's own
  `never` contract for the second. Each emitted argument is asserted to
  `Parameters<Controller["method"]>[index]`, the annotation the application
  wrote: a guarded property read leaves `undefined` in the alternative and a
  parameter no decorator named is passed `undefined`, and both are exactly what
  the platform's own binding passes, so the annotation is the application's
  promise about its own handler rather than something this emitter can prove.
  `tests/controller-invokers.test.ts` pins the assertion and the token import.
- `generation/descriptor-emitter.ts` always writes a parameter's `property`,
  as the literal `undefined` when the decorator named none. The platform's
  metadata requires the field, so omitting it makes the generated module fail
  the application's own type check; the runtime reads the same `undefined`
  either way.
- `bundler/aponia-build-plugin.ts` is a thin seam over `generateInvokers`, not a
  second generator: it passes `cwd` and `project` through and prints
  `generation/build-report.ts`. Anything the plugin needs to do differently
  belongs in the generator, so `aponia build` and a bundle cannot drift apart.
  It runs in Bun's `onStart` hook because that is the only hook Bun awaits before
  it resolves the first import: `onLoad` is reached only after resolution has
  already failed on the missing module, `onResolve` sees one specifier at a time
  and cannot know which generated names to produce, and `onEnd` runs after
  everything. `bun build` on the command line takes no plugin flag, which is why
  registration is a script that calls `Bun.build`. The plugin's return type is
  the ambient `Bun.BunPlugin`: `bun-types` declares it in the global namespace and
  exports no matching name from the `"bun"` module, so importing it would be
  re-emitted into this package's declarations and fail the declaration build.
  Registration is opt-in, and a build that does not register the plugin must
  behave exactly as it did before.
- A generation failure rejects the build rather than being reported and skipped.
  `generateInvokers` writes nothing unless it completes, so the previous
  artifact is still on disk; a build that continued would bundle it, which is
  what the artifact's version stamp exists to catch. The plugin surfaces the
  generator's own error, which already names the declaration to change.
- `aponia build` only reads source: it never runs the application, so a
  controller that only exists after a side effect is invisible to it. It
  regenerates `<sourceRoot>/invokers.generated.ts` and
  `<sourceRoot>/descriptors.generated.ts` in place on every run and reports each
  as `UPDATE` rather than refusing an existing target, which is the one place
  this package's change lines do not mean "did not exist before". A descriptor
  module left behind after a module was renamed is stale until the next build:
  nothing prunes it, and the entry it still exports boots the module the
  application no longer declares.
- `generation/descriptor-emitter.ts` emits the module graph as data:
  `defineModule` from `@aponiajs/common` plus `defineElysiaControllerRoutes` from
  `@aponiajs/platform-elysia`, which is what makes an application able to boot
  without lowering decorated classes. It never calls Elysia's route API — that
  stays in the platform, and a generated route reaches it through the declared
  plan. It emits exactly the helpers a module's body calls, one import per
  package, and exports `moduleDescriptors`, a frozen record keyed by module class
  name.
- A module is emitted whole or not at all. A module whose collections could not
  be read, whose controller or provider dependencies could not be reduced to
  importable tokens, whose route or schema slot could not be copied, or whose
  name two classes share is left out of the generated module and reported as a
  `DECLINED` line by `runCli`. A controller is declared whole too, so one declined
  route sinks the module that declares it: emitting the controller without the
  route would leave the application answering the platform's 404 where it used to
  answer with the handler.
- `generation/descriptor-emitter.ts` reads the analysis rather than re-deriving
  it, and the one place the two must agree is what disqualifies a module. The
  collections' own reasons live in `AnalyzedModule.collectionUnreadable`, which
  also repeats the reason each unreadable element carries; `unreadable` adds the
  module class's constructor reasons, which nothing consults because the
  container never builds a module class. A controller's or provider's own
  `unreadable` list is consulted, and it is what catches a class that declares no
  constructor but extends one: the analysis reports no dependency entries for it
  at all, and the runtime reads the same inherited `design:paramtypes`.
- A copied expression is copied verbatim, which is what the runtime does with it
  too: `compileProvider` passes a non-function provider through unchanged, so a
  `provideValue(...)` call or a factory result is the same value in generated
  source once the names it reads are imported. The emitter imports every name an
  expression reads, resolved through `generation/source-imports.ts`, and declines
  the declaration when a name is not an import or an export of the file it was
  written in — never a guess at what the name meant there.
- `generation/source-imports.ts` is the single rule for "could a generated module
  name this?": a file's imports, its exports, and what one expression reads.
  `parseSourceExpression` parses expression text with the shared in-memory
  project and unwraps the parentheses it wraps the text in, because callers ask
  what the text itself is.
- `aponia build` still leaves decorator metadata load-bearing in two places, and
  the guide states it rather than implying otherwise: WebSocket gateway discovery
  reads `@WebSocketGateway()`/`@SubscribeMessage()` off `provider.useClass`, and a
  `@Validation()` model is resolved to its validator while its routes mount,
  because a generated schema slot names the model class the decorator named.
- Both emitters are covered in the Bun lane only.
  `tests/generated-invokers.integration.test.ts` and
  `tests/generated-descriptors.integration.test.ts` reach
  `@aponiajs/platform-elysia` on purpose: they are the only places the emitters
  and the runtime that consumes their output meet, and they assert the acceptance
  criterion for each — an application booted from a generated module answers
  exactly as one booted from its decorated classes. No Vite+ conformance case is
  warranted for them: the generated modules call platform contracts the
  conformance lane already covers, and what these tests add is CLI-internal
  analysis with no public type or runtime behavior of its own.
- `tsconfig.json` maps `@aponiajs/*` to workspace sources. Without it, a fixture
  written under `tests/` resolves those names through a package `dist` that may
  be stale or absent — the CI test lane installs and runs without building — so a
  fixture would silently exercise an older build. This is a test affordance only:
  the package's own source still imports nothing from the runtime packages.
- `tsconfig.json` also declares `experimentalDecorators` and
  `emitDecoratorMetadata`, which is what makes the package-scoped lane the root
  guide documents (`bun run --filter @aponiajs/cli test`) agree with the root
  lane. Bun selects the transpiler configuration from the **process cwd**, so
  without them this package's integration tests, which boot decorated
  applications, transpiled decorators with stage-3 semantics: the route plan came
  out empty and every request answered `404` with nothing thrown. The options are
  declared in every package's `tsconfig.json`, not only this one, because nothing
  marks which package's fixtures will boot a decorated application next;
  `scripts/toolchain-config.spec.ts` holds that. `tsconfig.build.json` is a
  separate file rather than an extension of this one, so neither option reaches
  the published bundle.
- The build must not read those mappings. `vite.config.ts` points `pack` and its
  declaration step at `tsconfig.build.json`, which is `tsconfig.json` without
  `paths`; with them the declaration emitter follows the mappings into the other
  packages and writes a `.d.ts` beside every source file it finds — 52 of them,
  which the source-layout guard then rejects and a `git add -A` will commit.
- Generated applications follow Nest's flat starter layout; later resources
  belong in `src/<resource>/`.
- The application starter registers the build plugin. `bun run build` runs
  `scripts/build.ts`, which bundles through `Bun.build` with
  `aponiaBuildPlugin()`, so both generated modules are rewritten before the
  bundler resolves the entrypoint that would read them. `@aponiajs/cli` is a
  starter devDependency for that, and the packed lane installs it into the
  generated project.
- The starter commits both generated modules and `src/main.ts` adopts the
  invoker artifact, so a freshly generated application serves through generated
  route invokers before any build has run. `bun run dev`, `bun start`, and
  `bun test` therefore work on a checkout that has never been built, and now run
  with the optimization rather than without it. The template holds them as
  `src/invokers.generated.ts.tmpl` and
  `src/descriptors.generated.ts.tmpl`, which is what gives the invoker module its
  `{{APONIA_VERSION}}` stamp and the descriptor module its name back on render.
  The framework stamp is the one field that must be substituted rather than
  literal: the runtime compares it with the release that is running, so a literal
  version would make every artifact a fresh application ships refuse itself. A
  build reports both as `UPDATE`, which is the one place this package's change
  lines do not mean "did not exist before".
- `tests/starter-artifact-freshness.test.ts` regenerates the starter's own
  sources and fails when what it produces differs from the committed modules.
  That guard protects the optimization rather than safety: a stale artifact is
  refused by `routing/invoker-artifact.ts` and costs a cold start, so losing it
  is silent. The comparison normalizes `elysia` and nothing else, because that
  field is resolved from what the project has installed — a fact about the
  machine — while the framework stamp and the invokers are decided here.
- `generation/generated-source-formatter.ts` is the only place generated source
  is laid out, and it calls a formatter rather than imitating one. The emitters
  used to hand-wrap their own output and drifted from `oxfmt`; the committed
  modules are read by the application's own `vp check`, so a layout that is
  merely close fails.
- `@aponiajs/cli` declares `oxfmt` as a runtime dependency, at an **exact**
  version. Owning the formatter rather than reaching through `vite-plus` or
  hoping to find one is deliberate: this package formats the code it generates,
  so it needs the formatter the way it needs `ts-morph`. The version is pinned
  rather than ranged because the layout of a committed module has to be a
  property of this package and the sources it read, not of which release
  resolved on the machine that ran the build; a range would let the same sources
  produce different bytes on someone else's install, which is the drift this
  seam exists to remove. `tests/generated-source-formatter.test.ts` asserts the
  manifest entry is an exact version, and
  `tests/starter-artifact-freshness.test.ts` is what notices when the pinned copy
  and the project's copy stop agreeing on the layout.
- That dependency is the fallback, not the first choice. A project's own
  `vite-plus/fmt` is preferred whenever the project has installed `vite-plus`:
  that is the copy whose `vp check` will read the file, so it stays the authority
  even when it is a release this package never saw, and its `fmt` entry is a
  re-export of this same `format`, so preferring it is not a second opinion.
  `Bun.resolveSync` answers from Bun's global install cache when a directory has
  no `node_modules`, which is why the project is only asked when it installed the
  package itself: the cache holds unrelated releases, and formatting with one
  writes a file the project's own check rejects. A checkout where neither copy
  loads is not an error — the emitters' output is valid TypeScript, so both
  modules are still generated, in the layout the emitter wrote them.
- `aponia build` writes what the formatter returns, and a formatter that cannot
  parse the emitted source throws rather than writing it out unformatted. That is
  a fault in this package, not in the project being built, and the message names
  the file.
- The earlier finding that this wiring broke the packed lane named the wrong
  cause, and the corrected one matters: the generated application's `check` does
  **not** type-check the packed CLI's `src/`. The CLI ships `src/` because
  `bin/aponia.ts` imports it, but a consumer never reads it, because a check
  excludes `node_modules`. What failed was a second copy Bun had staged under the
  project's own `BUN_TMPDIR` — `<project>/.tmp/.<hash>.cli/src/...` — which
  `vp check` walks precisely because it is not `node_modules`. The lane now keeps
  `BUN_TMPDIR` outside every directory it runs a check in, so where the lane
  stages a packed workspace cannot reach a consumer's check. That is a lane
  detail and stays in the lane: no starter ignore glob may name a test lane.
  `bun run test:generated-app` is the acceptance test for the wiring — the packed
  CLI's plugin runs inside a generated application's real build, reports `UPDATE`
  for both modules, and that application's own `check`, `test`, `test:e2e`, and
  bundle all pass. It also boots `src/main.ts` before the build and `dist/main.js`
  after it, because a starter that shipped the modules but never adopted them
  would pass every other assertion in that lane.
- A REST CRUD resource emits `<name>.model.ts` with separate `@Validation`
  classes for create bodies, update bodies, and shared path parameters.
  Controllers and services consume those classes directly, and REST CRUD does
  not emit DTO files. Non-REST transports retain their DTO or input scaffolds.
- Gateway schematics emit `@WebSocketGateway()` classes and register them as
  providers. WebSocket CRUD resources use stable
  `<resource>.create|findAll|findOne|update|remove` message events and
  `@MessageBody()` bindings; keep REST and GraphQL output unchanged.
- Documentation wording is guarded: `scripts/documentation.spec.ts` requires
  `bun add --global @aponiajs/cli` and forbids `bunx aponia` across `README.md`,
  `docs/cli.md`, `docs/packages.md`, and this package's README.
- `generation/controller-routes.ts` is pure source analysis: it parses a
  controller file with `ts-morph`, emits nothing, and returns frozen data in
  declaration order. It recognizes only decorators the same file imports from
  `@aponiajs/common`, following named-import aliases and namespace imports, so a
  same-named decorator from another package is never picked up. It repeats that
  package's `RequestMethod` and `RouteParameterKind` unions locally because this
  package does not depend on the runtime packages; keep both in step by hand.
  Only decorated parameters appear in its output, because the runtime's
  whole-context fallback for undecorated parameters is applied while mounting
  routes. Arguments it cannot read statically and a parameter decorator on
  anything but a method parameter throw a plain `Error`.
- `generation/module-descriptors.ts` is the same kind of analysis for the module
  authoring surface: it reads one file's `@Module()`, `@Injectable()`, and
  `@WebSocketGateway()` classes and reports what each declares, including the
  constructor dependencies `@Inject()` names by parameter index and the declared
  parameter types for the rest. It emits nothing. It repeats
  `controller-routes.ts`'s recognition rule — and its binding lookup — rather
  than sharing it, because that file's copy is private to it; keep the two in
  step by hand.
- A declaration the analysis cannot read statically is reported, never dropped: a
  module whose options are not an object literal, a collection that is not an
  array literal, a spread or computed key, a token that is neither a reference
  nor a `createToken(...)` call, a gateway path built at run time, a class whose
  constructor dependencies come from a base class in another file. A class
  declaration's `unreadable` list repeats the reason each unreadable entry and
  dependency carries; a module splits that list in two, because a generated
  module declares the collections and nothing about the module class —
  `collectionUnreadable` for the collections, `unreadable` for those plus the
  module class's own constructor reasons. An omission is therefore never mistaken
  for a declaration with nothing in it, and a module that boots perfectly well is
  not declined for a constructor the container never runs. A plain `Error` is
  reserved for a decorator whose arguments contradict its documented signature
  and for an empty gateway path, which the runtime rejects too.

## Tests

`tests/*.test.ts` under Bun. `e2e/generated-application.e2e.ts` packs the CLI and
boots a generated application; it is slow and excluded from the default lanes,
so run it with `bun run test:generated-app` when templates or manifests change.
