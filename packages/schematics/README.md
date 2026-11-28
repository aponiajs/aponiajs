# @aponiajs/schematics

The Nest-shaped schematic collection an Aponia project names in
`aponia-cli.json`:

```json
{
  "collection": "@aponiajs/schematics"
}
```

`collection.json` publishes the verified Nest schematic names and aliases, one
`schema.json` per schematic, and a plain-function factory per schematic. The
CLI resolves the collection, validates the options against the schema, loads the
factory, and writes the files it plans.

## Schematics

| Schematic       | Alias    | Output                      |
| --------------- | -------- | --------------------------- |
| `application`   | —        | application starter         |
| `class`         | `cl`     | plain class                 |
| `controller`    | `co`     | controller                  |
| `decorator`     | `d`      | decorator                   |
| `filter`        | `f`      | exception filter            |
| `gateway`       | `ga`     | WebSocket gateway           |
| `guard`         | `gu`     | guard                       |
| `interceptor`   | `itc`    | interceptor                 |
| `interface`     | `itf`    | interface                   |
| `middleware`    | `mi`     | middleware                  |
| `module`        | `mo`     | module                      |
| `pipe`          | `pi`     | pipe                        |
| `provider`      | `pr`     | provider                    |
| `service`       | `s`      | service                     |
| `resolver`      | `r`      | GraphQL resolver            |
| `configuration` | `config` | `aponia-cli.json`           |
| `library`       | `lib`    | workspace library           |
| `sub-app`       | `app`    | workspace application       |
| `resource`      | `res`    | resource                    |
| `upgrade`       | `update` | upgrade the Aponia packages |

There is no `enum`, `test`, or `dto` schematic.

## Factory contract

```ts
import type { SchematicFactory } from "@aponiajs/schematics";

export const main: SchematicFactory = (options) => ({
  files: [{ path: "src/users/users.service.ts", content: "..." }],
});
```

`collection.json` names the module and its export with
`"./dist/lib/<name>/<name>.factory.js#main"`. The Aponia contract is a plain
function rather than an `@angular-devkit/schematics` `Rule`, so publishing a
collection needs no Angular DevKit dependency.

## Build

```bash
bun run build
```

TypeScript emits `dist/` and the build copies every `schema.json` and template
beside it, which is what makes the collection's relative paths resolve in the
published package.

## Provenance

See [PROVENANCE.md](./PROVENANCE.md) for the pinned upstream release and commit.
