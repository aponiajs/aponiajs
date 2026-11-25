# Authoring a Library

`aponia new my-api --workspace` creates `apps/api` plus `libs/`; the default
single-app layout is unchanged. `aponia g library <name>` writes a workspace
library under `libs/`, registers it as a library project in `aponia-cli.json`,
and adds the `@app/<name>` path alias to the workspace `tsconfig.json`. Add
`--publish` for a publishable npm package; a private workspace library is
imported through the alias, not through a package dependency.

## Workspace project and alias

The generator writes one project entry shaped like `nest-cli.json`.

```json
{
  "widgets": {
    "type": "library",
    "root": "libs/widgets",
    "entryFile": "index",
    "sourceRoot": "libs/widgets/src",
    "compilerOptions": { "tsConfigPath": "libs/widgets/tsconfig.lib.json" }
  }
}
```

The root `tsconfig.json` gains two ESM mappings. An application imports
`@app/widgets`, and `aponia build widgets` builds the library through
`vp pack`.

```bash
aponia g library widgets --publish --scope acme
aponia g plugin widgets --publish --scope acme
aponia library new widgets --kind plugin --scope acme
aponia library check libs/widgets --publish
aponia library publish libs/widgets
```

`aponia library new widgets --scope acme` creates the same publishable package
standalone, outside any Aponia workspace; add `--kind plugin` for a plugin. It
depends only on published AponiaJS packages and can be pushed to npm
independently.

`aponia g library` and `aponia g plugin` share one package scaffold. The
difference is the library kind and the platform declaration a plugin carries, so
an application imports either package the same way.

## What the generator creates

| File                                 | Responsibility                                      |
| ------------------------------------ | --------------------------------------------------- |
| `package.json`                       | Exports, files, scripts, and framework dependencies |
| `src/index.ts`                       | The only public barrel                              |
| `src/<name>.module.ts`               | `forRoot` / `forRootAsync` and the module class     |
| `src/<name>.service.ts`              | The injectable service                              |
| `src/<name>.constants.ts`            | The options token the module provides               |
| `src/interfaces/<name>.interface.ts` | The registration options                            |
| Colocated `src/**/*.spec.ts`         | Bun tests                                           |
| `test/*.conformance.ts`              | Vite+ conformance tests                             |
| `aponia.library.json`                | The machine-readable library contract               |
| `README.md`, `AGENTS.md`, `llms.txt` | Human and agent documentation                       |
| `tsconfig*.json`, `vite.config.ts`   | Package build and test configuration                |

`tsconfig.lib.json` extends the workspace root and is the config Vite+ packs
with, which is the Nest library convention.

A plugin adds two neutral contribution files, `src/<name>.controller.ts` and
`src/<name>.policy.ts`, beside a module that registers the controller, the
service, the options, the `HttpPolicy` built from them, and
`requirePlatformCapabilities("<name>", ["http"])`. It adds no `adapters/`
directory and states no platform: a native mount belongs in a separate `adapter`
library.

A publishable package declares `exports`, `files`, `publishConfig.access`,
`sideEffects: false`, the `aponiajs` and `aponia-library` npm keywords, and
`@aponiajs/common` as a peer dependency. It has no `postinstall` script. A
private workspace package keeps `private: true` and exports its source so the
application can import it without a build step.

## The registration standard

A generated module follows Nest's registration shape. `forRoot` takes literal
options and `forRootAsync` takes a factory with injected dependencies; both
return a `DynamicModule`, and an application imports the result:

```ts
@Module({ imports: [WidgetsModule.forRoot({ greeting: "Hi" })] })
export class AppModule {}

@Module({
  imports: [
    WidgetsModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ greeting: config.greeting }),
    }),
  ],
})
export class AsyncAppModule {}
```

A module with options builds its registration with
`ConfigurableModuleBuilder` in one `<name>.module-definition.ts` file. That file
exports `ConfigurableModuleClass`, `MODULE_OPTIONS_TOKEN`, `OPTIONS_TYPE`, and
`ASYNC_OPTIONS_TYPE`; the module class extends the generated class and its
`forRoot`/`forRootAsync` delegate to the generated methods. `isGlobal` (or the
package's `global`) is a definition-shaping extra: it is absent from the
injected options and reaches only the module definition.

The asynchronous form accepts the three Nest shapes — `useFactory`, `useClass`,
and `useExisting` — and a Promise a factory answers is awaited before the value
is validated, so a resolved value is refused exactly as a literal is. That
lowering is `moduleOptionsProviders` from `@aponiajs/common`; never restate it
per package. The options token is provided and exported, so a consumer can read
what the registration received.

`register` and `registerAsync` remain as deprecated aliases of `forRoot` and
`forRootAsync` for one release. A registration whose options decide the provider
list — a configuration-token module or one with a `jwt`/`oidc` arm — states that
limit in its package guide and refuses the asynchronous form by name instead of
accepting one that cannot work.

Name the upstream package a library mirrors: `cache` mirrors
`@nestjs/cache-manager`, `cron` mirrors `@nestjs/schedule`, `events` mirrors
`@nestjs/event-emitter`, `http` mirrors `@nestjs/http-client`, `auth` mirrors
`@nestjs/authentication` and `@nestjs/authorization` where they overlap,
`database` mirrors the `@nestjs/drizzle` boundary, `queue` mirrors
`@nestjs/bullmq`'s names, `rate-limit` mirrors `@nestjs/throttler`, and
`microservices` mirrors `@nestjs/microservices`. `audit`, `tenancy`,
`store-redis`, `view`, `compiler`, `platform-core`, `metrics`, `mcp`, and
`idempotency` are Aponia extensions with no Nest counterpart; they adopt the same
builder surface but must not claim parity with a package that does not exist.

Four of those mirrors carry their library's own class surface, not only its
registration names:

- `cron` publishes `Cron`, `Interval`, `Timeout`, `SchedulerRegistry`, and the
  `cronJobs`/`intervals`/`timeouts` switches.
- `auth` publishes `@CurrentUser()`/`@CurrentSession()` and registers
  `AuthGuard` as a global `APP_GUARD` unless `globalGuard: false` is stated.
- `http` splits `forRoot` (app-wide defaults, no client) from `register` (one
  client), and publishes `getHttpClientToken`, `@InjectHttpClient`, and
  `HttpClientInterceptor`.
- `queue` publishes `@Processor`, `WorkerHost`, `@InjectQueue`, `JOB_REF`, and
  `getQueueToken`; the processor name is the job name, and the token is
  `AponiaQueue_<name>` rather than a broker queue.

Each package guide states the deviations that remain — no cross-process cron
lock, no broker worker, no named-client streaming or dispatcher — next to the
surface it publishes.

## Plugin packages

A generated plugin uses the same registration surface as a generated library:
`forRoot(options)` and `forRootAsync({ imports, inject, useFactory })` return a
`DynamicModule`, and the application imports the result. What differs is the
contribution, which is neutral and states no platform:

```ts
// src/widgets.module.ts
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
```

There is no platform allowlist. A registration that needs a request-path
capability the platform lacks is refused at boot with
`UNSUPPORTED_PLATFORM_FEATURE`, naming the package, the capability, and the
platform. The registration key is the module identity, so one registration per
application is the supported shape: two that share a key fail with
`DUPLICATE_MODULE`, and two keyed registrations that both export the service make
its read `AMBIGUOUS_PROVIDER`.

[Authoring a plugin package](./plugin-packages.md) covers the neutral
contribution contract in depth.

A library's source is runtime-neutral: it imports `@aponiajs/common` and never a
platform package or an HTTP runtime. A package that must mount a runtime value
belongs in a separate `adapter` library; `aponia library check` refuses a runtime
import in any other kind.

The generated tests prove the registration without booting an HTTP platform:
`compileRootModule` lowers the `DynamicModule` and `createContainer` resolves
the service. That is the whole contract a library needs and the reason the same
test holds on every platform.

## The library contract

`aponia.library.json` is data an agent or a consumer can read without executing
the package:

```json
{
  "contractVersion": 1,
  "name": "widgets",
  "kind": "module",
  "framework": { "aponia": "1.0.0-beta.63", "bun": ">=1.4.4" },
  "entrypoints": [{ "subpath": ".", "module": "./dist/index.mjs" }],
  "provides": [
    { "kind": "module", "token": "WidgetsModule" },
    { "kind": "provider", "token": "WidgetsService" }
  ],
  "requires": [],
  "security": { "network": false, "filesystem": false, "postinstall": false, "permissions": [] }
}
```

`kind` is `module`, `plugin`, `adapter`, or `utility`. Keep `provides` and the
public barrel in step; `aponia library check` compares them with the package
surface it can see.

A library's source is runtime-neutral, so the manifest states no platform
allowlist. A library that needs a runtime keeps that runtime in
`peerDependencies` or `devDependencies` — never in `dependencies`, which
`aponia library check` refuses because a run-time platform dependency is how a
library stops being portable. A package that must mount a runtime value is an
`adapter` library, separate from the neutral module. The mount contract is
[Authoring a plugin package](./plugin-packages.md); the cross-platform contract
is [Platform Parity](../platforms/platform-parity.md).

## Checking a library

`aponia library check [path]` validates the package manifest, the library
manifest, the public barrel, both test lanes, and the documentation files.
`--publish` additionally requires a non-private package with
`publishConfig.access` set to `public`, npm keywords, a license, a semver
version, and a peer dependency on `@aponiajs/common`. A run-time dependency on a
platform package or runtime (`@aponiajs/platform-elysia`, `elysia`, `hono`,
`h3`) is an issue, and a plugin that states a platform or ships an adapter is an
issue. `--json` prints the frozen result.

`aponia library publish [path]` runs the publish check, build, and `npm pack
--dry-run`. It stops with the exact publish command unless `--yes` is passed;
then it runs `npm publish --access public` with the optional `--tag`.

## Catalog

`aponia library search <query>` searches the bundled catalog by name, kind,
description, or tag. `--remote` adds npm packages tagged `aponia-library`, marked
`unverified`; `--json` prints the entries. The bundled catalog remains curated
data in this repository, not a hosted registry. Every `official` entry names a
published workspace package, and `scripts/library-catalog.spec.ts` holds that
invariant.

## Publishing

The package builds through Vite+ (`bun run build`) and publishes only `dist`,
`llms.txt`, and `aponia.library.json` plus the manifest's normal npm files.
`@aponiajs/common` is the runtime framework dependency; a library must not
depend on `@aponiajs/cli` at runtime.

## Documentation

- [CLI reference](./cli.md)
- [Authoring a plugin package](./plugin-packages.md)
- [Architecture and style](../build/architecture-and-style.md)
