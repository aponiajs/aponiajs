# Authoring a Library

`aponia new my-api --workspace` creates `apps/api` plus `libs/`; the default
single-app layout is unchanged. `aponia g library <name>` writes a workspace
library under `libs/`, adds it to the target app as `workspace:*`, and installs
the workspace link. Add `--publish` for a publishable npm package.

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
| `src/<name>.types.ts`                | The registration options                            |
| `tests/`                             | Bun tests                                           |
| `tests-vp/`                          | Vite+ conformance tests                             |
| `aponia.library.json`                | The machine-readable library contract               |
| `README.md`, `AGENTS.md`, `llms.txt` | Human and agent documentation                       |
| `tsconfig*.json`, `vite.config.ts`   | Package build and test configuration                |

A plugin adds one file, `src/adapters/<name>.adapters.ts`. It owns the
`providePlatformModule` declaration: the platforms the package supports and the
native mount each one needs. That folder is the only place a plugin may import a
runtime, and `aponia library check` allows it there.

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

The options travel through an exported token (`WIDGETS_OPTIONS`), and the
service injects it optionally, so a plain import of the module still boots. The
factory runs synchronously in this release; an async factory is not awaited, so
declare the value it builds as already-resolved.

## Plugin packages

A generated plugin uses the same registration surface as a generated library:
`forRoot(options)` and `forRootAsync({ imports, inject, useFactory })` return a
`DynamicModule`, and the application imports the result. The platform
declaration is separate because it is a property of the package rather than of
one registration:

```ts
// src/adapters/widgets.adapters.ts
export const widgetsPlatformProvider = providePlatformModule({
  key: "widgets",
  platforms: ALL_PLATFORMS,
  adapters: widgetsAdapters,
});
```

The boot refuses a platform the declaration omits with
`UNSUPPORTED_PLATFORM_FEATURE` before it mounts anything, and runs only the
adapter for the platform it serves. The registration key is the module identity,
so one registration per application is the supported shape: two that share a key
fail with `DUPLICATE_MODULE`, and two keyed registrations that both export the
service make its read `AMBIGUOUS_PROVIDER`. Keep the platforms in the adapters
file and `aponia.library.json` in step.

[Authoring a plugin package](./plugin-packages.md) covers the native-mount seam
in depth.

A library's source is runtime-neutral: it imports `@aponiajs/common` and never
a platform package or an HTTP runtime. A package that must mount one is an
`adapter` library, states the platform in `platforms`, and keeps the import
under `src/adapters/`; `aponia library check` refuses a platform import in any
other kind.

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
  "platforms": ["elysia", "hono", "h3"],
  "framework": { "aponia": "1.0.0-beta.61", "bun": ">=1.4.4" },
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

`platforms` states which of the framework's platforms the library runs on. A
library whose code is runtime-neutral omits it or lists all four. A library that
needs a runtime keeps that runtime in `peerDependencies` or `devDependencies`
and mounts it through `adapters` in its module registration — never in
`dependencies`, which `aponia library check` refuses because a run-time platform
dependency is how a library stops being portable. The mount contract is
[Authoring a plugin package](./plugin-packages.md); the cross-platform contract
is [Platform Parity](../platforms/platform-parity.md).

## Checking a library

`aponia library check [path]` validates the package manifest, the library
manifest, the public barrel, both test lanes, and the documentation files.
`--publish` additionally requires a non-private package with
`publishConfig.access` set to `public`, npm keywords, a license, a semver
version, and a peer dependency on `@aponiajs/common`. A run-time dependency on a
platform package or runtime (`@aponiajs/platform-elysia`, `elysia`, `hono`,
`h3`) is an issue, and a `platforms` entry the framework does not ship
is an issue. `--json` prints the frozen result.

`aponia library publish [path]` runs the publish check, build, and `npm pack
--dry-run`. It stops with the exact publish command unless `--yes` is passed;
then it runs `npm publish --access public` with the optional `--tag`.

## Catalog

`aponia library search <query>` searches the bundled catalog by name, kind,
description, or tag. `--remote` adds npm packages tagged `aponia-library`, marked
`unverified`; `--json` prints the entries. The bundled catalog remains curated
data in this repository, not a hosted registry. Every `official` entry names a
published workspace package, and `scripts/library-catalog.spec.ts` holds that
invariant. The same catalog is exposed through the `aponia_search_libraries` MCP
tool.

## Publishing

The package builds through Vite+ (`bun run build`) and publishes only `dist`,
`llms.txt`, and `aponia.library.json` plus the manifest's normal npm files.
`@aponiajs/common` is the runtime framework dependency; a library must not
depend on `@aponiajs/cli` at runtime.

## Documentation

- [CLI reference](./cli.md)
- [Authoring a plugin package](./plugin-packages.md)
- [Architecture and style](../build/architecture-and-style.md)
