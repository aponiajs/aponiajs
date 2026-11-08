# @aponiajs/database — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The Drizzle transaction seam, one typed repository over a table, and ordered SQL
migrations. It is a leaf: nothing in the framework depends on it.

| Domain        | Owns                                                            |
| ------------- | --------------------------------------------------------------- |
| `module/`     | `DatabaseModule.register` and its option contract               |
| `database/`   | `DatabaseService`, the narrow client contract, and transactions |
| `repository/` | `createRepository` and the row/insert inference helpers         |
| `migration/`  | `MigrationRunner`, the store contract, and `.sql` loading       |

`src/index.ts` is the only public barrel. Keep `*.types.ts` beside the runtime
that reads it.

## Invariants

- **The package builds no pool and picks no dialect.** The application
  constructs its Drizzle database; never add a driver, connection helper, or
  dialect import to this package.
- **`drizzle-orm` stays a runtime dependency and a type-only edge.** Import
  types with `import type` and values (`eq`, `sql`, `getTableName`) from the
  package's own dependencies; never re-export a Drizzle type as Aponia's own.
- **The client is accepted as `object` and narrowed at the boundary.** A
  dialect's database type cannot be structurally satisfied by the narrow
  interface, so the cast is deliberate and documented; runtime checks name the
  missing operation instead of letting it fail as `undefined is not a function`.
- **`transaction` awaits; `transactionSync` does not.** A synchronous driver
  commits when the callback returns, so an async callback belongs to the first
  method only. Do not merge them.
- **Rows leave frozen.** Copy before freezing so the driver's row is untouched.
- **Migrations run in file-name order and stop at the first failure.** Never
  record a migration whose statement threw.
- **The default migration store is process-local.** Do not describe it as
  durable.
- **Configuration failures are `AponiaError` with `INVALID_DATABASE_OPTIONS`.**
  A missing written row is `DATABASE_WRITE_FAILED`; a bad migration is
  `INVALID_MIGRATION`.

## Tests

`tests/*.test.ts` under Bun, `tests-vp/*.conformance.ts` under Vite+. The Bun
lane exercises repositories and synchronous transactions against Bun's
in-memory SQLite through `drizzle-orm/bun-sqlite`, and migration file loading
against a temporary directory that the test removes.
