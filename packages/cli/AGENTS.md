# @aponiajs/cli — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

`aponia new` and `aponia generate`. It is independent of the runtime packages and
driven by libraries rather than hand-rolled parsing.

| Domain                              | Owns                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `commands/`                         | Argument parsing, command contracts, help output, and `runCli`              |
| `generation/`                       | Naming, project discovery, file planning, renderers, module updates, writes |
| `generation/controller-routes.ts`   | Build-time route analysis of controller source                              |
| `generation/controller-invokers.ts` | Emits route invokers as literal source for the Elysia platform              |
| `generation/module-descriptors.ts`  | Build-time analysis of module, injectable, and gateway source               |
| `generation/invoker-generator.ts`   | The `aponia build` command: scans a project and writes that module          |
| `version.ts`                        | The version stamped into generated manifests                                |
| `templates/`                        | The canonical application starter input                                     |

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
- `aponia build` only reads source: it never runs the application, so a
  controller that only exists after a side effect is invisible to it. It
  regenerates `<sourceRoot>/invokers.generated.ts` in place on every run and
  reports the file as `UPDATE` rather than refusing an existing target, which is
  the one place this package's change lines do not mean "did not exist before".
- `tsconfig.json` maps `@aponiajs/*` to workspace sources. Without it, a fixture
  written under `tests/` resolves those names through a package `dist` that may
  be stale or absent — the CI test lane installs and runs without building — so a
  fixture would silently exercise an older build. This is a test affordance only:
  the package's own source still imports nothing from the runtime packages.
- The build must not read those mappings. `vite.config.ts` points `pack` and its
  declaration step at `tsconfig.build.json`, which is `tsconfig.json` without
  `paths`; with them the declaration emitter follows the mappings into the other
  packages and writes a `.d.ts` beside every source file it finds — 52 of them,
  which the source-layout guard then rejects and a `git add -A` will commit.
- `tests/generated-invokers.integration.test.ts` reaches `@aponiajs/platform-elysia`
  on purpose. It is the only place the emitter and the runtime that consumes its
  output meet, and it asserts the acceptance criterion for build-time route code
  generation: an application with a generated invoker module answers exactly as
  one without it.
- Generated applications follow Nest's flat starter layout; later resources
  belong in `src/<resource>/`.
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
- A declaration the analysis cannot read statically is reported in its
  `unreadable` list, never dropped: a module whose options are not an object
  literal, a collection that is not an array literal, a spread or computed key,
  a token that is neither a reference nor a `createToken(...)` call, a gateway
  path built at run time, a class whose constructor dependencies come from a base
  class in another file. That list repeats the reason each unreadable entry and
  dependency carries, so one check decides whether the declaration can be
  lowered, and an omission is never mistaken for a declaration with nothing in
  it. A plain `Error` is reserved for a decorator whose arguments contradict its
  documented signature and for an empty gateway path, which the runtime rejects
  too.

## Tests

`tests/*.test.ts` under Bun. `e2e/generated-application.e2e.ts` packs the CLI and
boots a generated application; it is slow and excluded from the default lanes,
so run it with `bun run test:generated-app` when templates or manifests change.
