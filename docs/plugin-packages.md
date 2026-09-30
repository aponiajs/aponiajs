# Authoring a Plugin Package

A plugin package is a published package that ships an Aponia module wrapping a
native Elysia plugin. An application imports the module like any other, declares
it in `imports`, and gets the plugin mounted through the framework's own seam
instead of calling `use()` on the application itself. `@aponiajs/cron` is the
reference implementation of this shape, and this page is the author's side of
it; [Native Elysia Plugins](./native-plugins.md) is the consumer's side.

The whole of the shape is one `register` method that returns a `DynamicModule`.
Everything below is why it is written the way it is.

## What an adapter is worth

A native Elysia plugin needs no adapter. An application can mount one with
`definePlugin`, with `PluginModule.registerAsync`, or with the factory's
`plugins` option, and nothing here discourages that. A package is worth
publishing only when one of these is true:

- **The declaration needs a module to live in.** A registration is a node in
  the compiled graph, so an application names it in `imports` beside its own
  modules, and `application.get` reads it back. Because it is a module,
  `inspectAponiaApplication` lists it — cron's registration appears as the
  module `PluginModule[cron]`, carrying its configuration token, its scheduler
  token, and the plugin token — and the boot reports it on `InstanceLoader`. A
  plugin mounted through the factory's `plugins` option reaches none of that:
  it is outside the graph, so nothing about it is in `compileRootModule`,
  inspection, or a generated artifact.
- **The plugin's options need validating.** A declared
  [configuration](./configuration.md) turns a malformed value into a refused
  boot with a stable code and an issue list, instead of a constructor throwing
  from inside a plugin halfway through a mount.

If neither is true, the application can mount the plugin itself and a package
around it adds a name and a version to maintain. The honest value of this
pattern is narrow, and a README that claims more than it delivers is the first
defect the next reader meets.

## The smallest complete registration

```ts
// packages/widgets/src/module/widgets-module.ts
import { Module, provideFactory, type DynamicModule } from "@aponiajs/common";
import { PluginModule, provideConfiguration } from "@aponiajs/platform-elysia";
import { WidgetsService, readWidgets } from "../service/widgets-service.ts";
import type { WidgetsModuleOptions } from "./widgets-module.types.ts";

@Module({})
export class WidgetsModule {
  static register(options: WidgetsModuleOptions): DynamicModule {
    // The framework's one seam for a plugin built from a value the container
    // already holds. The factory runs once per boot, after the provider it
    // injects exists.
    const pluginModule = PluginModule.registerAsync({
      key: options.key ?? "widgets",
      inject: [WidgetsService],
      useFactory: (service: WidgetsService) => service.buildPlugin(),
    });

    return Object.freeze({
      ...pluginModule,
      imports: Object.freeze([]),
      providers: Object.freeze([
        provideConfiguration(
          options.configuration,
          options.source === undefined ? undefined : { source: options.source },
        ),
        provideFactory(
          WidgetsService,
          [options.configuration],
          (value) => new WidgetsService(readWidgets(value)),
        ),
        ...(pluginModule.providers ?? []),
      ]),
      exports: Object.freeze([options.configuration, WidgetsService]),
    });
  }
}
```

An application consumes it the way it consumes any other module:

```ts
import { Module } from "@aponiajs/common";
import { WidgetsModule } from "@examplejs/widgets";
import { WidgetsConfig } from "./config.ts";

const widgets = WidgetsModule.register({ configuration: WidgetsConfig });

@Module({ imports: [widgets] })
export class AppModule {}
```

Holding the registration in a `const` rather than writing the call inline in
`imports` is not cosmetic; see [What a build can read](#what-a-build-can-read).

## The seam is `PluginModule.registerAsync`

`PluginModule.register(plugin, ...)` and `definePlugin(plugin, ...)` take a
plugin **value**, so the value has to exist when the module is evaluated. A
plugin built from something the container resolved — a validated configuration, a
service the application injected — has no value until the container has built
one, and `PluginModule.registerAsync({ inject, useFactory })` is the framework's
one seam that builds it there.

There is no hand-rolled alternative. The boot recognizes a plugin module by
asking whether its providers include one whose token is a private `ELYSIA_PLUGIN`
token, and asks for the plugin through that token. That token is created with
`createToken`, so its identity is a fresh symbol rather than a name, and it is
not exported from `@aponiajs/platform-elysia`. A `DynamicModule` you assemble by
hand — even one that sets `module: PluginModule` — carries a token of your own,
so nothing recognizes it as a plugin module and the boot mounts no plugin for
it. `registerAsync` is what puts the plugin in the graph.

The factory's `inject` tokens resolve against the module that declares the
plugin provider: its own providers first, then the exports of that module's
`imports`. `registerAsync` also accepts `imports`, so a factory can inject a
token an imported module exports — but a registration is one `DynamicModule`,
and cron keeps the service and the plugin in that one module, because the module
that holds the service has no class an application could name and a split would
need one.

### The shape of the returned value

Three details of the shape above are not stylistic:

- **`providers` is spread with a fallback.** `DynamicModule.providers` is
  optional in its type, so `pluginModule.providers` is possibly `undefined` even
  though the seam always supplies one. `...(pluginModule.providers ?? [])` is
  what keeps the declaration honest about that.
- **The collections the registration owns are restated, not inherited.** The
  result spreads the plugin module, so it inherits whatever that module was
  built with. Cron was registered without imports, so its `imports` is already
  empty; writing `imports: Object.freeze([])` keeps the registration from
  inheriting an import it did not choose.
- **The whole value is frozen**, and the arrays inside it are frozen too. Public
  descriptors in this framework are immutable, and a `DynamicModule` an
  application holds is one.

The returned module is the `module` field's module, not the class `register`
hangs off: cron's registration reports its identity as `PluginModule[cron]`.
The class is only the namespace the method is reached through.

## Identity and one registration per application

A registration's `key` is its module identity. The seam derives a stable
`instanceId` from it, so two registrations that share a key are not two modules:
the graph refuses the boot with `DUPLICATE_MODULE` — cron's carries
`{ module: "PluginModule[cron]" }` — rather than mounting one and dropping the
other, which would silently run half of what was declared. `key` defaults to the
package's own name (`"cron"`), so two registrations that both omit it collide.

The service the module provides is exported under its own class token, which is
what makes `application.get(Service)` the ordinary way to read a boot back. That
is also why **one registration per application is the supported shape.** Two
registrations with distinct keys both mount and both run, but they are then two
providers behind one token, so the root module resolves it from two imports that
disagree and the read raises `AMBIGUOUS_PROVIDER`. The graph names the ambiguity
rather than picking a winner, which is the framework's ordinary rule for a token
two imports both export.

State the limitation in the README and pin both codes in tests. Cron does: its
Bun lane asserts `DUPLICATE_MODULE` for two registrations sharing a key and
`AMBIGUOUS_PROVIDER` when one of two keyed registrations is read back. A later
change that lifts the limitation has to change the README with it. Per-key
tokens minted by `register` would remove the ambiguity, and are deliberately not
part of the shape — they would give every plugin package a second way to name
one thing.

## Stopping is a provider hook

A native plugin starts work when it mounts, often before anything listens. The
work has to stop from the module graph, not from the plugin.

`application.close()` runs the plan a boot attached whether or not the
application ever called `listen()`: `beforeApplicationShutdown`, then the native
server stop **only if a server exists**, then `onModuleDestroy`, then
`onApplicationShutdown`. A plugin's own teardown is reached through the native
stop, so an application that is only ever driven through `application.handle()` —
a test, a serverless handler — never reaches it, and a stop tied to the server
would leave such an application running its jobs forever.

So the module provides a service that owns the work and implements a provider
lifecycle hook. Cron implements `onApplicationShutdown`, which runs last, after
every other hook this application declared has had its say, and it calls `stop()`
rather than `pause()` and drops the handles afterwards, so a second `close()`
stops nothing a second time. [Lifecycle](./lifecycle.md) is the full set of
moments.

## What a build can read

`aponia build` lowers a module only when every `imports` / `controllers` /
`exports` entry names its declaration with a **single identifier**. A call
expression is not one, so `CronModule.register({ ... })` written inline in an
`imports` array declines the module that wrote it — the build reports it as
`DECLINED` — and leaves the committed descriptor artifact serving a graph the
registration is not in. Holding the registration in a `const` and naming that
in `imports` is what keeps the module inferiorable:

```ts
const widgets = WidgetsModule.register({ configuration: WidgetsConfig });

@Module({ imports: [widgets] })
export class AppModule {}
```

Both spellings mount the same module at run time; the difference is what a build
can read. The same rule is stated from the consumer's side in
[Native Elysia Plugins](./native-plugins.md#the-plugins-option), and the reason
that page gives for the `plugins` option is exactly this decline.

## The build configuration

A package whose test `tsconfig.json` maps `@aponiajs/*` to the other packages'
sources needs a **separate** `tsconfig.build.json` without those `paths`, and its
`vite.config.ts` must point both `pack` and `pack.dts` at it:

```ts
// vite.config.ts
import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    alias: {
      "@aponiajs/common": new URL("../common/src/index.ts", import.meta.url).pathname,
      "@aponiajs/core": new URL("../core/src/index.ts", import.meta.url).pathname,
      "@aponiajs/platform-elysia": new URL("../platform-elysia/src/index.ts", import.meta.url)
        .pathname,
    },
    globals: true,
    include: ["tests-vp/**/*.conformance.ts"],
  },
  pack: {
    tsconfig: "tsconfig.build.json",
    dts: {
      tsgo: true,
      tsconfig: "tsconfig.build.json",
    },
    exports: true,
    deps: {
      neverBundle: ["@aponiajs/common", "@aponiajs/platform-elysia", "elysia"],
    },
  },
  lint: { options: { typeAware: true, typeCheck: true } },
  fmt: {},
});
```

With `paths` visible to the declaration emitter, `vp pack` follows the mappings
into the other packages' sources and writes a `.d.ts` file beside every source
file it finds, with the packages that own them — which the source-layout guard
then rejects. Every package in this workspace that declares such mappings keeps
a `paths`-free build tsconfig for this reason.

## Stating the boundary

**An adapter that does not state its boundary sets a false expectation, and the
false expectation is the defect.** Cron's README opens with a section titled
"What this package is, and what it is not" and says, in the reader's own words:

> **This is not a job queue.** There is no persistence: a job that did not run
> because the process was down did not run, and nothing replays it. There are no
> retries: a `run` that throws is the engine's business... There is no
> cross-process coordination and no distributed lock...

Write that paragraph before the usage sections, not after them, and make it
concrete:

- Name the engine and link to it, and say plainly that a reader who wants the
  raw plugin should install it directly.
- Write the sentence as `**This is not a <thing>.**` and then list what the
  package does **not** do. Do not soften it with "currently" or "yet"; a
  guarantee the engine does not give is not a roadmap item.
- Name the cost of the wrong assumption. Cron's says a reader who assumes
  exactly-once "will lose data", which is why the paragraph cannot be dropped.
- Say where the guarantee a reader does want lives — a different package — rather
  than implying a later option will add it.

The same paragraph belongs in `llms.txt`, shortened, because that is the surface
an agent reads first.

## Adding a package to this repository

A package is not added by creating its directory. The following shared files
were all edited when `@aponiajs/cron` was added, and a new package needs the same
edits:

| File                             | What changes                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| `packages/<name>/`               | The package itself: manifest, `src/`, `tests/`, `tests-vp/`, README, `llms.txt`, `AGENTS.md` |
| `package.json` (root)            | The manifest list in `version:bump`, and the package loop in `release:dry-run`               |
| `scripts/workspace-versions.ts`  | The package in `versionedPackageFiles` and in `versionedWorkspacePaths`                      |
| `AGENTS.md` (root)               | The package table, and the guide-index table below it                                        |
| `docs/packages.md`               | The catalog table, a section for the package, and every count of packages                    |
| `docs/releasing.md`              | The dependency-ordered publish list, and every count of packages                             |
| `docs/architecture-and-style.md` | The package-boundary table                                                                   |
| `scripts/agent-guides.spec.ts`   | The package in `guideDirectories`                                                            |
| `scripts/source-layout.spec.ts`  | The package's `src/` layout: its files and its owner directories                             |
| `.github/workflows/publish.yml`  | The pack destination and the publish loop                                                    |
| `.github/workflows/canary.yml`   | The same, for the nightly canary                                                             |

The package's own files follow the workspace's conventions: `src/index.ts` is the
only barrel, implementation lives under owner directories such as `module/` and
`scheduler/` rather than a package-wide `types/` bucket, type-only contracts sit
in `*.types.ts` beside the implementation that owns them, `tsconfig.json`
declares `experimentalDecorators` and `emitDecoratorMetadata`, and `elysia` is a
peer dependency pinned to the exact version the rest of the workspace pins.

Three guards discover packages from the workspace and need no edit when one is
added: `scripts/package-llms.spec.ts`, `scripts/coverage-gate.ts`, and the root
`bun run --workspaces` scripts. The root `package.json` `workspaces` glob already
covers `packages/*`.

## In this repository

`packages/cron/` is the worked example, and its two lanes are what a new
package's lanes should mirror. The Bun lane runs real boots through
`AponiaFactory.create` — timing is the whole subject, so a case that only
compiled the contract would not notice a plugin mounted with no work to do — and
asserts the four behaviors: work actually runs, it receives the options the
validated configuration parsed, `application.close()` stops it, and an invalid
configuration fails the boot with `INVALID_CONFIGURATION_VALUE`. The Vite+ lane
mirrors all four and adds the compile-time contract, because a type derived from
the wrapped plugin's own declaration is where an adapter's claim is actually
checked. Reading `packages/cron/README.md` beside `packages/cron/AGENTS.md` is
the fastest way to see the shape, the boundary paragraph, and the reasons for
each choice together.

[Native Elysia Plugins](./native-plugins.md) ·
[Configuration](./configuration.md) ·
[Lifecycle](./lifecycle.md) ·
[Introspection](./introspection.md) ·
[Published packages](./packages.md)
