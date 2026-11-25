# @aponiajs/schematics — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The Nest-shaped schematic collection an Aponia project names in
`aponia-cli.json`. It is data plus plain-function factories: `collection.json`,
one `schema.json` per schematic, and the template files each factory renders.
`src/index.ts` is the only public barrel.

| Domain                                       | Owns                                                                   |
| -------------------------------------------- | ---------------------------------------------------------------------- |
| `collection.json`                            | The verified schematic names, aliases, factory paths, and schema paths |
| `src/lib/<schematic>/schema.json`            | The options schema the CLI validates                                   |
| `src/lib/<schematic>/<schematic>.factory.ts` | The factory the collection entry names                                 |
| `src/lib/<schematic>/files/**`               | The pinned upstream template set the factory renders                   |
| `src/lib/schematic-factory.ts`               | Template discovery, name substitution, and file planning               |
| `scripts/build.ts`                           | TypeScript emission plus the schema and template assets                |

## Invariants

- **The collection paths resolve in the published package.** `collection.json`
  states `./dist/lib/<schematic>/<schematic>.factory.js#main` and
  `./dist/lib/<schematic>/schema.json`. Sources live under `src/lib`; the build
  emits the modules and copies every non-TypeScript asset beside them. Adding a
  schematic means adding all four pieces: the collection entry, the schema, the
  factory, and the template set.
- **The collection is Nest-shaped, the CLI is Aponia-native.** The templates are
  copied from the pinned `@nestjs/schematics` release recorded in
  `PROVENANCE.md`. `@aponiajs/cli` renders Aponia sources from its own templates;
  this collection is the compatibility surface a `--collection` flag resolves and
  a third-party package can publish. Do not silently rewrite the copied templates
  from memory.
- **No `@angular-devkit/schematics` dependency.** The Aponia factory contract is
  `(options) => { files }`. The CLI resolves the collection, validates options
  against `schema.json`, loads the factory, and writes the planned files.
- **Aliases are exactly the verified set.** `collection.json` publishes
  `class|cl`, `controller|co`, `decorator|d`, `filter|f`, `gateway|ga`,
  `guard|gu`, `interceptor|itc`, `interface|itf`, `middleware|mi`, `module|mo`,
  `pipe|pi`, `provider|pr`, `service|s`, `resolver|r`, `configuration|config`,
  `library|lib`, `sub-app|app`, `resource|res`, and `upgrade|update`. There is no
  `enum`, `test`, or `dto` schematic.
- **Templates stay out of the type and lint lanes.** Every template file carries
  a `.tmpl` suffix and `src/lib/**/files/**` is excluded, so `<%= ... %>`
  placeholders never reach `tsc`, Oxlint, or Oxfmt.
- **`upgrade` plans no files.** The CLI owns the manifest rewrite and install
  because both need the workspace's version resolution; the factory exists so the
  `update` alias resolves like every other schematic.

## Tests

`src/**/*.spec.ts` under Bun. The collection test reads `collection.json` and
asserts every factory and schema path names the built output and that its source
exists; once `bun run build` has produced `dist/`, it also asserts every
published path exists. One factory rendering proves the template substitution
and the spec filter.
