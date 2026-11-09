# Authoring a Library

`aponia new my-api --workspace` creates `apps/api` plus `libs/`; the default
single-app layout is unchanged. `aponia g library <name>` writes a workspace
library under `libs/`, adds it to the target app as `workspace:*`, and installs
the workspace link. Add `--publish` for a publishable npm package.

```bash
aponia g library widgets --publish --scope acme
aponia library check libs/widgets --publish
aponia library publish libs/widgets
```

`aponia library new widgets --scope acme` creates the same publishable package
standalone, outside any Aponia workspace. It depends only on published
AponiaJS packages and can be pushed to npm independently.

## What the generator creates

| File                                 | Responsibility                                      |
| ------------------------------------ | --------------------------------------------------- |
| `package.json`                       | Exports, files, scripts, and framework dependencies |
| `src/index.ts`                       | The only public barrel                              |
| `src/<name>.module.ts`               | The module an application imports                   |
| `src/<name>.service.ts`              | The injectable service                              |
| `tests/`                             | Bun tests                                           |
| `tests-vp/`                          | Vite+ conformance tests                             |
| `aponia.library.json`                | The machine-readable library contract               |
| `README.md`, `AGENTS.md`, `llms.txt` | Human and agent documentation                       |
| `tsconfig*.json`, `vite.config.ts`   | Package build and test configuration                |

A publishable package declares `exports`, `files`, `publishConfig.access`,
`sideEffects: false`, the `aponiajs` and `aponia-library` npm keywords, and
`@aponiajs/common` as a peer dependency. It has no `postinstall` script. A
private workspace package keeps `private: true` and exports its source so the
application can import it without a build step.

## The library contract

`aponia.library.json` is data an agent or a consumer can read without executing
the package:

```json
{
  "contractVersion": 1,
  "name": "widgets",
  "kind": "module",
  "framework": { "aponia": "1.0.0-beta.25", "bun": ">=1.4.4" },
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

## Checking a library

`aponia library check [path]` validates the package manifest, the library
manifest, the public barrel, both test lanes, and the documentation files.
`--publish` additionally requires a non-private package with
`publishConfig.access` set to `public`, npm keywords, a license, a semver
version, and a peer dependency on `@aponiajs/common`. `--json` prints the frozen
result.

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
- [Architecture and style](./architecture-and-style.md)
