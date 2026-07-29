# Repository Guidelines

This repository **is** the AponiaJS framework, not an application built with it.
Changes here become published npm packages, so treat every edit as public API
work: contracts first, escape hatches preserved, versions synchronized.

## Project Structure & Module Organization

Bun workspace. Framework packages live in `packages/`:

| Package                     | Owns                                                      | Runtime dependencies                                                 |
| --------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| `@aponiajs/common`          | Decorators, contracts, tokens, providers, errors, logging | `reflect-metadata` only                                              |
| `@aponiajs/core`            | Module graph, visibility rules, dependency injection      | `@aponiajs/common`                                                   |
| `@aponiajs/platform-elysia` | Elysia adapter, bootstrap, route mapping, plugin modules  | `common`, `core`, peer `elysia`                                      |
| `@aponiajs/cli`             | `aponia new` and `aponia generate` schematics             | `change-case`, `ts-morph`, `yargs-parser`, `fast-glob`, `inflection` |
| `create-aponia`             | `bun create aponia` entrypoint into the same generator    | `@aponiajs/cli`                                                      |
| `aponiajs`                  | Reserved public facade, private and unpublished           | —                                                                    |

Supporting directories: `examples/` for executable examples, `docs/` for
published documentation, `ROADMAP.md` for milestones and architecture plans,
`scripts/`
for release and documentation guards, `packages/cli/templates/` for generated
application sources.

Package source stays in `src/`. Bun tests live in `packages/*/tests/*.test.ts`,
Vite+ conformance tests in `packages/*/tests-vp/*.conformance.ts`, CLI end-to-end
in `packages/cli/e2e/*.e2e.ts`. Generated applications follow Nest's flat starter
layout; later resources belong in `src/<resource>/`.

Framework package source is domain-first. `src/index.ts` is the only public
barrel; implementation files live under owner directories such as
`routing/`, `graph/`, or `generation/`. Type-only contracts use `*.types.ts`
beside the implementation that owns them, not a package-wide `types/`
directory. Constants use `*.constants.ts` only when runtime and type modules
both need the same value. Keep tests at their documented flat paths because the
Bun test glob depends on that layout. `scripts/source-layout.spec.ts` guards
these boundaries.

`AGENTS.md` is the real file; `CLAUDE.md` and `GEMINI.md` are symlinks to it.
Edit `AGENTS.md`.

For performance, AOT, pseudo-JIT, and benchmark work, read
[`CONTEXT.md`](CONTEXT.md) before changing runtime paths. It records the measured
baseline, theoretical ceilings, terminology, architecture recommendation, and
acceptance gates.

Every package and supporting directory carries its own `AGENTS.md` with the
invariants that apply there. Read this file first, then the one next to the code
being changed:

| Guide                                                            | Covers                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------- |
| [`packages/common`](packages/common/AGENTS.md)                   | Decorators, descriptors, tokens, errors, logging        |
| [`packages/core`](packages/core/AGENTS.md)                       | Module graph, visibility, container                     |
| [`packages/platform-elysia`](packages/platform-elysia/AGENTS.md) | Bootstrap, route mapping, native plugins, context types |
| [`packages/cli`](packages/cli/AGENTS.md)                         | Schematics, templates, generated layout                 |
| [`packages/create-aponia`](packages/create-aponia/AGENTS.md)     | The `bun create aponia` entrypoint                      |
| [`packages/aponiajs`](packages/aponiajs/AGENTS.md)               | The reserved, still-private facade                      |
| [`scripts`](scripts/AGENTS.md)                                   | Release channel derivation and documentation guards     |
| [`docs`](docs/AGENTS.md)                                         | The published documentation set and what guards it      |
| [`docs/learn`](docs/learn/README.md)                             | The ordered chapters that teach the framework           |
| [`examples`](examples/AGENTS.md)                                 | Executable applications built with the framework        |

`scripts/agent-guides.spec.ts` keeps that list and the symlinks honest, and
`scripts/learning-path.spec.ts` keeps the numbered chapters in `docs/learn/`
contiguous, indexed, and chained.

## Build, Test, and Development Commands

- `bun install`: install workspace dependencies.
- `bun run example:basic`: run the minimal Elysia example on its configured port.
  Each other example has its own `example:<name>` script; `examples/README.md`
  lists them.
- `bun run build`: build every workspace package (`vp pack` per package).
- `bun test`: run the Bun suite across workspaces.
- `bun run test:coverage`: run the complete Bun lane and enforce the repository's
  95% line and function coverage floor.
- `bun run test:vite-plus`: run the Vite+ conformance lane.
- `bun run test:examples`: run both example applications end to end. Bun's
  default glob skips `*.e2e-spec.ts`, so this script is how they reach CI.
- `bun run check`: Oxfmt, Oxlint, and type-aware checking for the repository.
- `bun run doctor`: diagnose toolchain or package-manager problems.
- `bun run test:generated-app`: pack the CLI and boot a generated application.
- `bun run version:patch|minor|major`: bump every manifest, refresh the lockfile,
  sync version references, and verify release consistency.

Narrower runs:

- `bun test packages/core/tests/core.test.ts`: one Bun test file.
- `bun test -t "resolves exported providers"`: one Bun test by name.
- `bun run --filter @aponiajs/cli test`: one package's Bun suite.
- `vp test packages/core/tests-vp/core.conformance.ts`: one conformance file.
- `bun test scripts/documentation.spec.ts`: validate CLI documentation wording.

Use Bun exclusively for documented commands, runtime, and package management.
Keep internal Vite+ configuration behind Bun package scripts.

## Architecture

### Two authoring layers

Decorators are a thin metadata surface; the runtime consumes immutable
descriptors. Understanding this split is required before touching framework code.

`@Module`, `@Controller`, `@Injectable`, `@Inject`, and the HTTP method
decorators in `packages/common/src/decorators/decorators.ts` only write `reflect-metadata`
entries under `Symbol.for("aponia.*.metadata")` keys. They build no graph, no
routes, and no container. `@Injectable()` is intentionally a no-op that exists so
`emitDecoratorMetadata` records `design:paramtypes`.

`compileRootModule` in
`packages/platform-elysia/src/modules/module-compiler.ts` reads
that metadata and lowers decorated classes into frozen `ModuleDefinition`,
`ControllerDefinition`, and `Provider` descriptors. `@aponiajs/core` only ever
sees descriptors — it never imports `reflect-metadata` or decorator logic.
Applications can hand-write descriptors instead (`defineModule`,
`defineElysiaController`, `provideValue`/`provideFactory`/`provideClass`/
`provideAlias`) and skip decorators entirely. Both paths must stay supported.

### Dependency direction

`common` ← `core` ← `platform-elysia`, one-way. Never add Elysia, HTTP, or Bun
runtime APIs to `common`. Never import another package's private source path;
cross-package imports use the package name, resolved through workspace links
(Bun) and the aliases in the root `vite.config.ts` (Vite+).

### Module graph and visibility

`compileModuleGraph` (`packages/core/src/graph/graph-compiler.ts`) walks imports depth-first,
identifies modules by `instanceId ?? id`, and validates eagerly at compile time,
before any instance exists: duplicate module identity, import cycles, duplicate
tokens inside a module, exports of tokens the module cannot resolve, unresolvable
provider dependencies, and unresolvable controller dependencies.

`ModuleGraph.locate` resolves a token against the module's own providers first,
then against imports that **export** that token. A provider that is not exported
is invisible to importers. Two imports exporting the same token raise
`AMBIGUOUS_PROVIDER` rather than picking a winner. Resolutions are memoized per
module.

`AponiaContainer` (`packages/core/src/container/container.ts`) caches one instance per
provider per module — singleton is currently the only scope — and detects
provider dependency cycles during resolution. `get()` deliberately enforces
root-module visibility; `resolveModuleProvider()` is the internal platform SPI
that resolves inside an arbitrary module and is not application API.

### Bootstrap order

`AponiaFactory.create`
(`packages/platform-elysia/src/application/aponia-factory.ts`):

1. create the system logger (`false` disables, an array sets log levels, a
   `LoggerService` replaces it);
2. `compileRootModule` then `createContainer`;
3. create the root `Elysia` named after the root module id with the requested
   `elysia.aot`/`elysia.precompile` policy, optionally passed through
   `configureNative`, which must return the same instance it receives;
4. first pass over `container.graph.modules`: `initializeModule` eagerly
   instantiates providers, and `ElysiaPluginModule` modules mount their native
   plugin;
5. second pass: instantiate each controller; decorated controllers register
   their compiled routes directly on the root application, while low-level
   descriptors fall back to `buildPlugin`, real-`Elysia` validation, and
   `use()`; log `RoutesResolver`/`RouterExplorer` lines for both paths;
6. await `nativeApplication.modules` and wrap everything in
   `AponiaElysiaApplication`.

`compileDecoratedController` delegates route lowering to
`routing/route-compiler.ts`.
That file joins paths, freezes the route plan, converts each declared
`RouteSchema` into an Elysia hook, generates a fixed invoker, and registers
`application.route(method, path, handler, hook)`. Handlers receive the Elysia
context, which `@aponiajs/common` describes platform-neutrally as
`RouteContext`.

### Route validation

Route decorators accept an optional schema (`@Post("/", { body })` or
`@Post({ body })`). The files under `packages/common/src/routing/route-schema*`
own the contract:
validators are either Standard Schema implementations (`~standard`, so Zod,
ArkType, and Valibot) or platform-native JSON Schema validators matched
structurally through `NativeSchema` (`static`/`params`, which is how TypeBox and
Elysia `t` arrive without `common` depending on TypeBox). Elysia validates both
kinds natively, so `toElysiaSchema` in `routing/route-compiler.ts` only restores the
TypeBox type at that single boundary. Slots are `body`, `query`, `params`,
`headers`, and `response`; keep `routeSchemaSlots`, `RouteContext`, and the
platform hook builder in sync when adding one.

Handlers receive their input through parameter decorators
(`packages/common/src/routing/route-parameters.ts`): `@Body`, `@Query`, `@Param`,
`@Headers`, `@Cookie`, `@Req`, `@Res`, `@Ctx`, each optionally naming a single
property. Metadata is stored per method under
`Symbol.for("aponia.route-parameters.metadata")`, and `routing/route-compiler.ts`
compiles the context-to-argument mapping once while mounting the controller. If
a handler has no parameter decorators, one declared parameter receives the whole
context, so `RouteContext` and the platform's `ElysiaRouteContext` stay useful
annotations. A zero-parameter handler skips unused context materialization.
TypeScript cannot contextually type a decorated method's parameters, which is
why types come from the handler's own annotations rather than from schema
inference — do not reintroduce an inference-based route API to work around it.

### Native plugin context types

Compiling a decorated controller erases the plugin instances a module imports, so
nothing statically links `ElysiaPluginModule.register(plugin)` to a handler.
`ElysiaRouteContext<TSchemaOrPlugins, TPlugins>` in
`packages/platform-elysia/src/routing/route-context.types.ts` closes that gap
explicitly: it
accepts one Elysia instance type or a tuple of them and builds the `Singleton`
that `Context` needs. The first argument holds either a route schema or the
plugins — an all-optional `InputSchema` also matches an Elysia instance, so the
conditional tests for the plugin shape first and only then treats the argument as
a schema. Applications shorten the annotation with their own
`AppContext<TSchema extends ElysiaInputSchema = {}>` alias rather than a
framework-level registry; ambient plugin registration through declaration
merging was rejected because it leaks across a whole compilation.

`defineElysiaPlugin` in `plugins/plugin-module.ts` is
`ElysiaPluginModule.register` plus
the plugin it installs, exposed as a real `plugin` property rather than a phantom
type, so `ElysiaPluginSource` accepts both an Elysia instance and that import.
Exporting the result as a value beside a same-named type is what lets an
annotation drop `typeof`; TypeScript has no other way to name a value in a type
position. The merge mirrors Elysia's own `.use()` signature —
`~Singleton` for `decorator`, `store`, `derive`, and `resolve`, plus `~Ephemeral`
derives and resolves, which are the `scoped` ones. `~Volatile` is excluded because
a plugin-local derive never reaches a controller mounted beside the plugin.
Keep the type and that runtime behavior in step; `tests/plugin-context.test.ts`
asserts both, and its compile-time assertions fail `bun run check` when the
mapping widens or drops a plugin type.

Elysia compiles handlers by statically reading their source (sucrose), so
generated route invokers must expose every context field they use directly and
call the controller with `handler.call(instance, ...)`. Binding is compiled and
cached during bootstrap, and synchronous handlers must stay off Elysia's async
composition path while declared or inferred Promise handlers remain awaited;
never forward every request through a generic context mapper. Hiding context
behind `Reflect.apply`, or passing the whole context to a generic helper,
respectively drops required fields or makes Elysia materialize every optional
field. Both break the route contract or its hot path.

### Errors

Failures throw `AponiaError` with a code from the closed `AponiaErrorCode` union
in `packages/common/src/errors/aponia-error.types.ts` (`MODULE_CYCLE`, `DUPLICATE_MODULE`,
`DUPLICATE_PROVIDER`, `INVALID_EXPORT`, `AMBIGUOUS_PROVIDER`, `MISSING_PROVIDER`,
`PROVIDER_CYCLE`, `INVALID_CONTROLLER`, `INVALID_MODULE`,
`INVALID_NATIVE_APPLICATION`, `APPLICATION_NOT_LISTENING`,
`UNSUPPORTED_CONTROLLER`) plus frozen structured `details`. Tests assert on those
codes; extend the union instead of throwing a bare `Error`. Argument and
generator input mistakes in the CLI use plain `Error`/`TypeError`.

### CLI

Independent of the runtime packages and driven by libraries rather than
hand-rolled parsing. `commands/arguments.ts` parses with `yargs-parser`;
`generation/component-names.ts` derives names with `change-case` and
`inflection`; `generation/project-generator.ts` renders
`templates/application`; `generation/schematic-generator.ts` orchestrates
configuration, planning, rendering, module registration, and writes through
focused collaborators in the same directory.
`generation/module-registration.ts` rewrites `@Module()` metadata with
`ts-morph`. A REST CRUD resource also emits `<name>.model.ts`; that model owns
the route schemas the generated controller passes to its decorators and from
which both DTOs derive their types with `Static<typeof …>`. `runCli` prints
`CREATE`/`UPDATE` change lines and returns an exit code — it never throws.

### Current scope

Implemented: decorated modules and HTTP controllers, Standard Schema route
validation, request parameter decorators, singleton DI, class/value/factory/alias providers, explicit tokens,
imports and exports, lifecycle, structured logging, generators, native Elysia
escape hatches. Not implemented: guards, interceptors, middleware, exception filters, Problem Details errors,
non-singleton scopes, testing modules, OpenAPI, authentication, WebSockets,
microservice transports. Check
`ROADMAP.md` before assuming a feature belongs somewhere.

## Coding Style & Naming Conventions

Write strict TypeScript using ESM, two-space indentation, and explicit `.ts`
extensions for local imports. Oxfmt and Oxlint, invoked by `bun run check`,
define the canonical formatting and lint rules. Use PascalCase for classes and
modules, camelCase for functions and variables, and descriptive suffixes such as
`.module.ts`, `.controller.ts`, and `.service.ts`. Controllers delegate business
behavior to injectable services.

Framework-internal conventions that reviewers enforce:

- Return frozen data from public APIs; descriptors and metadata are immutable.
- Use `#private` class fields for internal state, not `private`.
- Keep type-only imports under `import type` (`verbatimModuleSyntax` is on).
- Prefer `const` type parameters for literal inference in public helpers.
- Mark internal-but-exported platform APIs with `@internal`.

All repository content, including comments and documentation, must be English.
Before finishing file changes, scan for Thai characters with
`rg -nP '[\x{0E00}-\x{0E7F}]' --glob '!node_modules/**' --glob '!dist/**' .`.

### Reuse Before Build

Search for a maintained library before implementing general-purpose behavior.
Use existing packages for concerns such as CLI parsing, AST manipulation,
validation, globbing, case conversion, inflection, and SemVer. Prefer packages
with active maintenance, TypeScript declarations, a compatible license, and
verified Bun support. Do not duplicate a library's behavior with handwritten
utilities. Write custom code only for Aponia-specific domain behavior when no
suitable maintained package exists, and document that decision in the pull
request or an architecture decision record.

Standards beat bespoke contracts: when an ecosystem specification already exists
for a boundary, adopt it instead of inventing an Aponia-only shape.

### Clean Code

- Keep modules and functions focused on one responsibility.
- Use descriptive names and explicit types; do not use `any`.
- Prefer small pure functions, immutable data, and early returns.
- Apply KISS, DRY, and YAGNI; avoid speculative abstractions and duplicated logic.
- Keep framework-specific templates separate from parsing, naming, filesystem,
  and source-transformation concerns.
- Make dependency boundaries explicit and wrap third-party APIs only where the
  wrapper expresses Aponia domain behavior.
- Add focused tests for success, failure, and edge cases whenever behavior changes.

## Testing Guidelines

Add tests for every behavioral change. Bun owns the primary suite; Vite+ tests
protect toolchain compatibility. No coverage threshold is enforced, so prioritize
module boundaries, dependency resolution, route mapping, CLI output, and failure
cases. Run `bun run check`, `bun test`, and `bun run test:vite-plus` before
submitting.

The two lanes are mirrored, not shared. Bun runs `packages/*/tests/*.test.ts`
against workspace links; Vite+ runs `packages/*/tests-vp/*.conformance.ts`, whose
include glob and `@aponiajs/*` source aliases live in the root `vite.config.ts`.
New framework behavior normally needs a case in both.
`packages/cli/e2e/generated-application.e2e.ts` packs the CLI and boots the
generated application, so it is slow and excluded from the default lanes.

Prefer exercising public entrypoints: build an application with
`AponiaFactory.create` and assert through `application.handle(new Request(...))`,
and assert `AponiaError.code` rather than message text. `scripts/*.spec.ts` are
guard tests over documentation wording and version
synchronization — a documentation edit can fail the suite.

## Commit & Pull Request Guidelines

Persistent release branches follow npm's primary distribution channels:

| Branch          | Required version | Primary dist-tag |
| --------------- | ---------------- | ---------------- |
| `release/alpha` | `X.Y.Z-alpha.N`  | `alpha`          |
| `release/beta`  | `X.Y.Z-beta.N`   | `beta`           |
| `release/rc`    | `X.Y.Z-rc.N`     | `rc`             |
| `main`          | stable `X.Y.Z`   | `latest`         |

`next` is an npm alias over the newest alpha, beta, or rc and never owns a
branch. Canary versions are stamped and published by CI without being committed,
so there is no canary branch either.

Create every feature or fix on a dedicated branch from the release branch it is
intended for, named `feature/<short-kebab-description>` or
`fix/<short-kebab-description>`. During the current prerelease phase,
`release/alpha` is the default base and pull-request target. Do not add work
directly to a release branch, a documentation branch, or an unrelated feature
branch.

After every successful push, ensure that an open pull request targets the same
release branch the work started from. Create the pull request immediately when
none exists; otherwise confirm that the existing pull request includes the
pushed commit. The pull request title must follow Conventional Commits, and its
description must summarize the intent, affected areas, and validation results.

Promote a release forward only: `release/alpha` → `release/beta` →
`release/rc` → `main`. Create a dedicated promotion branch from the source
channel, run the matching `version:beta`, `version:rc`, or `version:promote`
command, and open a pull request into the next channel. Never merge a less
mature channel directly into a more mature branch without the matching version
transition.

Use concise Conventional Commit subjects, for example
`feat(cli): align starter layout with Nest`.

The framework is pre-1.0 and not production ready, so routine work targets
`release/alpha` and bumps with `version:alpha`. Use `version:beta` and
`version:rc` only on matching promotion work. Never promote a bare `X.Y.Z` into
`main`, which npm would serve as `latest`, without explicit sign-off.

Every push must raise the synchronized workspace version. The root manifest and
all publishable packages share one version; run the smallest valid
`bun run version:*` command and commit its output with the change. CI's `verify`
job fails when the version is unchanged, lower, invalid, or inconsistent across
manifests or `bun.lock`. Run `bun run release:dry-run` when package contents
change. See `docs/releasing.md`.

The npm distribution tag is derived from the version by
`scripts/distribution-tag.ts`, never chosen by hand: stable → `latest`,
`-alpha.N` → `alpha`, `-beta.N` → `beta`, `-rc.N` → `rc`, `-canary.*` → `canary`,
with `next` applied only as an alias over the newest `alpha`, `beta`, or `rc`.
Any other prerelease identifier fails the release gate. Use `version:alpha`,
`version:beta`, `version:rc`, and `version:promote` to move between channels, and
`release:tag` to print the resolved channel.

Public behavior changes belong in `docs/` and the affected package README as part
of the same pull request. Pull requests should explain intent, list affected
packages, link relevant issues, and include validation results. Add terminal
output or screenshots only when they clarify CLI, logging, or visible behavior.
Never commit secrets, generated archives, `node_modules/`, or local environment
files.
