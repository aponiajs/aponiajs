# Authoring a Plugin Package

A plugin package is a published package that ships an Aponia module contributing
neutral behavior: providers, controllers, `HttpPolicy` transforms, request
lifecycle hooks, and capability requirements. An application imports the module
in `imports`, and the shared request pipeline runs it on every platform.
`@aponiajs/cors` and `@aponiajs/compression` are the reference implementations of
this shape, and this page is the author's side of it;
[Platform Parity](../platforms/platform-parity.md) is the runtime contract.

The whole of the shape is one registration method that returns a
`DynamicModule`. This page is the standard: the contract every module package in
this repository follows, then the authoring path that produces one.

## The contract

`scripts/plugin-standard.spec.ts` enforces the mechanical half of this table; the
two test lanes prove the behavioral half. A package that cannot meet a row states
why in its package `AGENTS.md` rather than inventing a second shape.

| #   | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Evidence                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| P1  | `forRoot(options?)` is the canonical registration; `register(options?)` remains as a deprecated beta alias that delegates to it. A generated package exposes `forRoot` and `forRootAsync` only.                                                                                                                                                                                                                                                                             | static guard + package tests           |
| P2  | A module whose `forRoot` accepts plain options exports `forRootAsync(options: ModuleAsyncOptions<TOptions>)`. The factory may return the options object or a Promise for it; the boot awaits it and validates the resolved value exactly as `forRoot` validates a literal. `useFactory`, `useClass`, and `useExisting` are all accepted. Modules registering a `ConfigurationToken` need no `forRootAsync`: that configuration is already container-resolved and validated. | package tests                          |
| P3  | Malformed options fail at registration with an `AponiaError` carrying a closed code and a frozen `issues` list naming each field. `forRootAsync` reports the same issues when its provider resolves.                                                                                                                                                                                                                                                                        | failure tests per package              |
| P4  | Source is Nest-shaped and domain-first: one barrel `src/index.ts`, the module as `src/<name>.module.ts`, a service as `src/<name>.service.ts`, a controller as `src/<name>.controller.ts`, a policy as `src/<name>.policy.ts`, and type-only contracts as `src/interfaces/<name>.interface.ts`. Constants use `*.constants.ts` only when runtime and types read the same value.                                                                                             | `scripts/source-layout.spec.ts`        |
| P5  | A package contributes neutral artifacts only — providers, controllers, `HttpPolicy`, `RequestLifecycleHook`, and capability requirements — and states the capabilities it serves with `requirePlatformCapabilities`. It states no `platforms` allowlist and ships no per-runtime `adapters/` directory.                                                                                                                                                                     | `scripts/plugin-standard.spec.ts`      |
| P6  | A module that owns a timer, socket, connection, or bounded store closes it in `onModuleDestroy` or `onApplicationShutdown`; closing is idempotent and tested.                                                                                                                                                                                                                                                                                                               | lifecycle tests per package            |
| P7  | No module-level mutable state. Registration state lives on the providers the registration returns.                                                                                                                                                                                                                                                                                                                                                                          | review + `source-layout` guard         |
| P8  | The package README shows `forRoot` and the `AponiaFactory.create` boot, `llms.txt` ships, and both test lanes cover the public contract.                                                                                                                                                                                                                                                                                                                                    | `scripts/documentation.spec.ts`, lanes |

### What a registration returns

- A frozen `DynamicModule`. The module class is the registration's `module`;
  `dynamicModule` derives `id` from the class name and a fresh `instanceId`, so
  two registrations of one class stay distinct.
- The option token is exported when an importer may read it back; store tokens
  are exported only when the store is a supported extension point.
- `forRootAsync` puts the factory-built options behind the same token, so every
  other provider is identical in both forms.

### Diagnostics

An option failure names the field, the rule it broke, and what to do:

```text
The rate-limit registration is invalid: limit must be a positive integer.
```

The code is stable; the `details.issues` array is frozen and safe to print. Do
not paraphrase a code into prose in a README: link the error code instead.

### Conformance kit

`@aponiajs/testing` exports the checks a package uses in its Bun lane. They
return a frozen list of broken rules, so a package asserts the contract rather
than a message.

| Check                          | Proves                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| `pluginRegistrationIssues`     | `forRoot` exists, and `forRootAsync` exists unless the package documents why it cannot.          |
| `dynamicModuleIssues`          | The registration names its own module class, is frozen, and carries an id and instance identity. |
| `registrationIsolationIssues`  | Two registrations of one module keep distinct definitions and instance identities.               |
| `optionsTokenIssues`           | The options token is provided and exported where the contract says it should be.                 |
| `asyncRegistrationShapeIssues` | The three asynchronous shapes lower through `moduleOptionsProviders`.                            |
| `teardownIssues`               | Closing twice stops nothing twice.                                                               |

Behavior — the options token resolving, a Promise factory being awaited,
`useClass` and `useExisting` resolving, and teardown running — is asserted by
booting the package's real module through `AponiaFactory.create`; the shape
checks do not replace that boot.

## Generate the package

`aponia g plugin <name>` writes the standard package under `libs/`, and
`aponia library new <name> --kind plugin --scope @name` writes the same package
standalone. It shares one scaffold with `aponia g library`, including the public
barrel, both test lanes, `aponia.library.json`, and the Nest-style
`forRoot` / `forRootAsync` registration. The plugin kind adds the neutral
contribution files:

```text
src/
|-- index.ts
|-- <name>.constants.ts
|-- <name>.controller.ts
|-- <name>.module.ts
|-- <name>.policy.ts
|-- <name>.service.ts
`-- interfaces/
    `-- <name>.interface.ts
```

The module registers the controller, its options, the service, the policy built
with `provideHttpPolicyAsync`, and `requirePlatformCapabilities("<name>", ["http"])`.
The generated source imports no platform package and no HTTP runtime, and the
manifest states no `platforms` array. A native mount belongs in a separate
`adapter` library, never in a plugin.

`aponia library check` validates the generated plugin like any other library,
including the required documentation and the rule that a plugin source imports no
runtime package.

## What an adapter is worth

A native Elysia plugin needs no adapter. An application can mount one with
`definePlugin`, with `PluginModule.registerAsync`, or with the factory's
`plugins` option, and nothing here discourages that. A package is worth
publishing only when one of these is true:

- **The declaration needs a module to live in.** A registration is a node in the
  compiled graph, so an application names it in `imports` beside its own modules,
  and `application.get` reads it back. Because it is a module,
  `inspectAponiaApplication` lists it, and the boot reports it on
  `InstanceLoader`. A plugin mounted through the factory's `plugins` option
  reaches none of that: it is outside the graph, so nothing about it is in
  `compileRootModule`, inspection, or a generated artifact.
- **The plugin's options need validating.** A declared
  [configuration](../build/configuration.md) turns a malformed value into a
  refused boot with a stable code and an issue list, instead of a constructor
  throwing from inside a plugin halfway through a mount.

If neither is true, the application can mount the plugin itself and a package
around it adds a name and a version to maintain. The honest value of this pattern
is narrow, and a README that claims more than it delivers is the first defect the
next reader meets.

## Standard plugin authoring builders

A package contributes through the neutral contract in `@aponiajs/common`:

| Builder                                  | Contributes                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| `provideHttpPolicy(name, handler)`       | one request/response transform; `onRequest` may answer, `onResponse` transforms |
| `provideHttpPolicies(...policies)`       | several policies in one module                                                  |
| `provideHttpPolicyAsync(deps, factory)`  | a policy built once from a validated value or an injected service               |
| `provideRequestLifecycleHook(hook)`      | `onRequest`, `onResponse`, and `onError` observation                            |
| `requirePlatformCapabilities(key, caps)` | the request-path capabilities the registration needs                            |

There is no platform allowlist and no per-platform adapter. A registration that
needs a capability the platform lacks is refused at boot with
`UNSUPPORTED_PLATFORM_FEATURE` naming the package, the capability, and the
platform. `[Platform Parity](../platforms/platform-parity.md)` is the contract;
this page is the author's side of it.

## The smallest complete registration

A route-serving feature is a controller; a request-path feature is an
`HttpPolicy` or a `RequestLifecycleHook`. A plugin that contributes both keeps
them in one registration:

```ts
// packages/widgets/src/widgets.module.ts
import {
  Module,
  dynamicModule,
  provideConfiguration,
  provideHttpPolicyAsync,
  requirePlatformCapabilities,
  type DynamicModule,
} from "@aponiajs/common";
import { WidgetsController } from "./widgets.controller.ts";
import { buildWidgetsPolicy } from "./widgets.policy.ts";
import type { WidgetsModuleOptions } from "./interfaces/widgets.interface.ts";

@Module({})
export class WidgetsModule {
  static forRoot(options: WidgetsModuleOptions): DynamicModule {
    const key = options.key ?? "widgets";

    return dynamicModule({
      module: WidgetsModule,
      id: `WidgetsModule[${key}]`,
      instanceId: Symbol.for(`aponia.widgets:${key}`),
      providers: [
        provideConfiguration(options.configuration),
        provideHttpPolicyAsync([options.configuration], (value) => buildWidgetsPolicy(value)),
        requirePlatformCapabilities("widgets", ["http"]),
      ],
      controllers: [WidgetsController],
      exports: [options.configuration],
    });
  }
}
```

An application consumes it the way it consumes any other module:

```ts
import { Module } from "@aponiajs/common";
import { WidgetsModule } from "@examplejs/widgets";
import { WidgetsConfig } from "./config.ts";

const widgets = WidgetsModule.forRoot({ configuration: WidgetsConfig });

@Module({ imports: [widgets] })
export class AppModule {}
```

## Identity and one registration per application

A registration's `key` is its module identity. The seam derives a stable
`instanceId` from it, so two registrations that share a key are not two modules:
the graph refuses the boot with `DUPLICATE_MODULE` rather than mounting one and
dropping the other, which would silently run half of what was declared. `key`
defaults to the package's own name, so two registrations that both omit it
collide.

The service the module provides is exported under its own class token, which is
what makes `application.get(Service)` the ordinary way to read a boot back. That
is also why **one registration per application is the supported shape.** Two
registrations with distinct keys both mount and both run, but they are then two
providers behind one token, so the root module resolves it from two imports that
disagree and the read raises `AMBIGUOUS_PROVIDER`. The graph names the ambiguity
rather than picking a winner, which is the framework's ordinary rule for a token
two imports both export.

State the limitation in the README and pin both codes in tests: two registrations
that share a key are `DUPLICATE_MODULE`, and reading one token two keyed
registrations both provide is `AMBIGUOUS_PROVIDER`.

## Stopping is a provider hook

Work starts when a registration mounts, often before anything listens, and it
has to stop from the module graph rather than from a native plugin.

`application.close()` runs the plan a boot attached whether or not the
application ever called `listen()`: `beforeApplicationShutdown`, then the native
server stop **only if a server exists**, then `onModuleDestroy`, then
`onApplicationShutdown`. A plugin's own teardown is reached through a provider
hook, so an application that is only ever driven through `application.handle()` —
a test, a serverless handler — still stops it.

So the module provides a service that owns the work and implements a provider
lifecycle hook. Cron implements `onApplicationShutdown`, which runs last, after
every other hook this application declared has had its say, and it calls `stop()`
rather than `pause()` and drops the handles afterwards, so a second `close()`
stops nothing a second time. [Lifecycle](../build/lifecycle.md) is the full set
of moments.

## What a build can read

`aponia build` lowers an `imports` / `controllers` / `exports` entry only when
the entry is a **single identifier naming a declaration the build read from the
project's own source** — a `@Module()`, `@Controller()`, `@Injectable()`, or
`@WebSocketGateway()` class under the configured source root. A registration is
not one. `WidgetsModule.forRoot({ ... })` returns a `DynamicModule`, which is a
runtime value rather than a declaration, so the build declines the module that
wrote it — it reports `DECLINED module <Name>: …` and leaves that module out of
`descriptors.generated.ts`. **No spelling changes that.** Written inline in
`imports`, held in a `const` and named there, or spread into the module from the
package's own source, the registration result is the same value and is declined
the same way. An entry that names a module class from an installed package
declines too, because the build reads only the project's own source.

Both spellings mount the same module at run time, which is why the decline is
easy to miss: what runs does not change, only what a build can read. The cost is
the descriptor artifact: the build writes it without the declined module when
another module is still lowerable, and replaces the artifact on disk with an
empty record when the declined module is the only one a build could have lowered.
Either way the artifact holds no declaration for the root the application named,
so bootstrap refuses it whole and lowers the root from its decorators. The
registration mounts, and the declared-graph boot is given up for that root.

That is why the `DECLINED module` line a build prints is the one to read, and why
a README should say so rather than imply a spelling gets around it. A consumer
who would rather keep the declared-graph boot mounts the raw plugin itself
through the factory's `plugins` option — no `imports` entry is involved, so the
root stays declarable — and gives up this module for it, the validated
configuration included. Nothing about a plugin mounted that way reaches
`compileRootModule`, `inspectAponiaApplication`, or a generated artifact.
[Native Elysia Plugins](../platforms/native-plugins.md#the-plugins-option)
states the same trade from the consumer's side.

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
    },
    globals: true,
    include: ["test/**/*.conformance.ts"],
  },
  pack: {
    tsconfig: "tsconfig.build.json",
    dts: true,
    exports: true,
    deps: {
      neverBundle: ["@aponiajs/common", "@aponiajs/core"],
    },
  },
  lint: { options: { typeAware: true, typeCheck: true } },
  fmt: {},
});
```

With `paths` visible to the declaration emitter, `vp pack` follows the mappings
into the other packages' sources and writes a `.d.ts` file beside every source
file it finds — which the source-layout guard then rejects. Every package in this
workspace that declares such mappings keeps a `paths`-free build tsconfig for
this reason.

## Stating the boundary

**An adapter that does not state its boundary sets a false expectation, and the
false expectation is the defect.** Lead the README with the module, the service,
and the boot; state the boundary in the final `## Native escape hatch` section so
the supported path is never buried under a disclaimer. Name the engine, say
plainly that a reader who wants the raw plugin should install it directly, and
name the cost of the wrong assumption. The same paragraph belongs in `llms.txt`,
shortened, because that is the surface an agent reads first.

## Adding a package to this repository

A package is not added by creating its directory. The following shared files were
all edited when `@aponiajs/cron` was added, and a new package needs the same
edits:

| File                                   | What changes                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| `packages/<name>/`                     | The package itself: manifest, `src/`, `test/`, README, `llms.txt`, `AGENTS.md` |
| `package.json` (root)                  | The manifest list in `version:bump`, and the package loop in `release:dry-run` |
| `scripts/workspace-versions.ts`        | The package in `versionedPackageFiles` and in `versionedWorkspacePaths`        |
| `AGENTS.md` (root)                     | The package table, and the guide-index table below it                          |
| `docs/reference/packages.md`           | The catalog table, a section for the package, and every count of packages      |
| `docs/operations/releasing.md`         | The dependency-ordered publish list, and every count of packages               |
| `docs/build/architecture-and-style.md` | The package-boundary table                                                     |
| `scripts/agent-guides.spec.ts`         | The package in `guideDirectories`                                              |
| `scripts/source-layout.spec.ts`        | The package's `src/` layout: its files and its owner directories               |
| `.github/workflows/publish.yml`        | The pack destination and the publish loop                                      |
| `.github/workflows/canary.yml`         | The same, for the nightly canary                                               |

The package's own files follow the workspace's conventions: `src/index.ts` is the
only barrel, implementation lives under owner directories such as `module/` and
`scheduler/` rather than a package-wide `types/` bucket, type-only contracts sit
in `interfaces/<name>.interface.ts`, `tsconfig.json` declares
`experimentalDecorators` and `emitDecoratorMetadata`, and any runtime peer is
pinned to the exact version the rest of the workspace pins.

Three guards discover packages from the workspace and need no edit when one is
added: `scripts/package-llms.spec.ts`, `scripts/coverage-gate.ts`, and the root
`bun run --workspaces` scripts. The root `package.json` `workspaces` glob already
covers `packages/*`.

## In this repository

`packages/cors/` is the worked example, and its two lanes are what a new
package's lanes should mirror. The Bun lane runs real boots through
`AponiaFactory.create` and reads real responses through `application.handle`, so
the policy is observed rather than assumed: an allowed origin answers, a denied
one does not, the preflight is answered without reaching a route, and an invalid
configuration fails the boot with `INVALID_CONFIGURATION_VALUE`. The Vite+ lane
mirrors the contract and adds the compile-time assertions. Reading
`packages/cors/README.md` beside `packages/cors/AGENTS.md` is the fastest way to
see the shape, the boundary paragraph, and the reasons for each choice together.

[Platform Parity](../platforms/platform-parity.md) ·
[Configuration](../build/configuration.md) ·
[Lifecycle](../build/lifecycle.md) ·
[Introspection](../platforms/introspection.md) ·
[Published packages](../reference/packages.md)
