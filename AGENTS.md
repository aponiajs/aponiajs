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

`AGENTS.md` is the real file; `CLAUDE.md` and `GEMINI.md` are symlinks to it.
Edit `AGENTS.md`.

## Build, Test, and Development Commands

- `bun install`: install workspace dependencies.
- `bun run example:basic`: run the Elysia example on its configured port.
- `bun run build`: build every workspace package (`vp pack` per package).
- `bun test`: run the Bun suite across workspaces.
- `bun run test:vite-plus`: run the Vite+ conformance lane.
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
decorators in `packages/common/src/decorators.ts` only write `reflect-metadata`
entries under `Symbol.for("aponia.*.metadata")` keys. They build no graph, no
routes, and no container. `@Injectable()` is intentionally a no-op that exists so
`emitDecoratorMetadata` records `design:paramtypes`.

`compileRootModule` in `packages/platform-elysia/src/decorated-module.ts` reads
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

`compileModuleGraph` (`packages/core/src/graph.ts`) walks imports depth-first,
identifies modules by `instanceId ?? id`, and validates eagerly at compile time,
before any instance exists: duplicate module identity, import cycles, duplicate
tokens inside a module, exports of tokens the module cannot resolve, unresolvable
provider dependencies, and unresolvable controller dependencies.

`ModuleGraph.locate` resolves a token against the module's own providers first,
then against imports that **export** that token. A provider that is not exported
is invisible to importers. Two imports exporting the same token raise
`AMBIGUOUS_PROVIDER` rather than picking a winner. Resolutions are memoized per
module.

`AponiaContainer` (`packages/core/src/container.ts`) caches one instance per
provider per module — singleton is currently the only scope — and detects
provider dependency cycles during resolution. `get()` deliberately enforces
root-module visibility; `resolveModuleProvider()` is the internal platform SPI
that resolves inside an arbitrary module and is not application API.

### Bootstrap order

`AponiaFactory.create` (`packages/platform-elysia/src/application.ts`):

1. create the system logger (`false` disables, an array sets log levels, a
   `LoggerService` replaces it);
2. `compileRootModule` then `createContainer`;
3. create the root `Elysia` named after the root module id, optionally passed
   through `configureNative`, which must return the same instance it receives;
4. first pass over `container.graph.modules`: `initializeModule` eagerly
   instantiates providers, and `ElysiaPluginModule` modules mount their native
   plugin;
5. second pass: instantiate each controller, call `buildPlugin`, verify the
   result is a real `Elysia` instance, log `RoutesResolver`/`RouterExplorer`
   lines, and `use()` it into the root application;
6. await `nativeApplication.modules` and wrap everything in
   `AponiaElysiaApplication`.

Route mapping itself lives in `compileDecoratedController`: it joins the
controller path with each route path, converts the declared `RouteSchema` into an
Elysia hook, and registers `plugin.route(method, path, handler, hook)`. Handlers
receive the Elysia context, which `@aponiajs/common` describes platform-neutrally
as `RouteContext`.

### Route validation

Route decorators accept an optional schema (`@Post("/", { body })` or
`@Post({ body })`). `packages/common/src/route-schema.ts` owns the contract:
validators are either Standard Schema implementations (`~standard`, so Zod,
ArkType, and Valibot) or platform-native JSON Schema validators matched
structurally through `NativeSchema` (`static`/`params`, which is how TypeBox and
Elysia `t` arrive without `common` depending on TypeBox). Elysia validates both
kinds natively, so `toElysiaSchema` in `decorated-module.ts` only restores the
TypeBox type at that single boundary. Slots are `body`, `query`, `params`,
`headers`, and `response`; keep `routeSchemaSlots`, `RouteContext`, and the
platform hook builder in sync when adding one.

Handlers receive their input through parameter decorators
(`packages/common/src/route-parameters.ts`): `@Body`, `@Query`, `@Param`,
`@Headers`, `@Cookie`, `@Req`, `@Res`, `@Ctx`, each optionally naming a single
property. Metadata is stored per method under
`Symbol.for("aponia.route-parameters.metadata")`, and `bindParameters` in
`decorated-module.ts` maps the context onto the argument list at request time. A
handler with no parameter decorators receives the whole context as its only
argument, so `RouteContext` and the platform's `ElysiaRouteContext` stay useful
annotations. TypeScript cannot contextually type a decorated method's
parameters, which is why types come from the handler's own annotations rather
than from schema inference — do not reintroduce an inference-based route API to
work around it.

Elysia compiles handlers by statically reading their source (sucrose), so a route
handler must receive the context as a direct call argument, as in
`handler.call(instance, ...bindParameters(parameters, context))`. Hiding it
behind `Reflect.apply(handler, instance, [context])` makes Elysia skip building
and applying parts of the context, and `set.headers` silently stops working.

### Errors

Failures throw `AponiaError` with a code from the closed `AponiaErrorCode` union
in `packages/common/src/error.ts` (`MODULE_CYCLE`, `DUPLICATE_MODULE`,
`DUPLICATE_PROVIDER`, `INVALID_EXPORT`, `AMBIGUOUS_PROVIDER`, `MISSING_PROVIDER`,
`PROVIDER_CYCLE`, `INVALID_CONTROLLER`, `INVALID_MODULE`,
`INVALID_NATIVE_APPLICATION`, `APPLICATION_NOT_LISTENING`,
`UNSUPPORTED_CONTROLLER`) plus frozen structured `details`. Tests assert on those
codes; extend the union instead of throwing a bare `Error`. Argument and
generator input mistakes in the CLI use plain `Error`/`TypeError`.

### CLI

Independent of the runtime packages and driven by libraries rather than
hand-rolled parsing. `arguments.ts` parses with `yargs-parser` and owns the
schematic alias table; `component-names.ts` derives names with `change-case` and
`inflection` and rejects absolute or traversing paths; `project-generator.ts`
renders `templates/application`; `schematic-generator.ts` owns schematic
definitions, `aponia.json` configuration, and flat/spec resolution;
`module-registration.ts` rewrites `@Module()` metadata in generated sources with
`ts-morph`. A REST CRUD resource also emits `<name>.schema.ts`, which owns the
route schemas the generated controller passes to its decorators and from which
both DTOs derive their types with `Static<typeof …>`. `runCli` prints `CREATE`/`UPDATE` change lines and returns an exit
code — it never throws.

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

Create every feature on a dedicated branch from the latest `main`, named
`feature/<short-kebab-description>`. Do not add feature work directly to `main`,
a documentation branch, or an unrelated feature branch.

After every successful push to a feature branch, ensure that an open pull request
targets `main`. Create the pull request immediately when none exists; otherwise
confirm that the existing pull request includes the pushed commit. The pull
request title must follow Conventional Commits, and its description must
summarize the intent, affected areas, and validation results.

Use concise Conventional Commit subjects, for example
`feat(cli): align starter layout with Nest`.

The framework is pre-1.0 and not production ready, so every release is a
prerelease: bump with `version:alpha` (or `version:beta` / `version:rc`) and
never cut a bare `X.Y.Z`, which npm would serve as `latest`, without explicit
sign-off.

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
