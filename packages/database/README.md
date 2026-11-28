# @aponiajs/database

A Drizzle-first database boundary for AponiaJS: one transaction seam, typed
repositories over a table, and ordered SQL migrations.

```bash
bun add @aponiajs/database@alpha drizzle-orm
```

## Use it

### Register the module

```ts
import { Module } from "@aponiajs/common";
import { DatabaseModule } from "@aponiajs/database";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";

const database = drizzle(new Database("app.sqlite"));

@Module({
  imports: [DatabaseModule.forRoot({ database })],
})
export class AppModule {}
```

The registration also accepts `migrations: { files: await loadMigrations("./migrations") }`;
the module applies them during `onModuleInit`, before handlers run. The package
builds no pool and picks no dialect. The application constructs its Drizzle
database, and the module owns the transaction seam and migrations.

### Use it in a controller

```ts
import { Controller, Get, Param } from "@aponiajs/common";
import { DatabaseService } from "@aponiajs/database";
import { sql } from "drizzle-orm";

@Controller("accounts")
export class AccountsController {
  constructor(private readonly database: DatabaseService) {}

  @Get(":id")
  find(@Param("id") id: string) {
    return this.database.execute(sql`select * from accounts where id = ${id}`);
  }
}
```

### Use it in a service

```ts
import { Injectable } from "@aponiajs/common";
import { DatabaseService, createRepository } from "@aponiajs/database";
import { eq } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

@Injectable()
export class AccountsRepository {
  readonly #accounts;

  constructor(database: DatabaseService) {
    this.#accounts = createRepository(database.client, accounts);
  }

  insert(input: { readonly id: string; readonly name: string }) {
    return this.#accounts.insert(input);
  }

  findById(id: string) {
    return this.#accounts.findById(id);
  }

  listNamed(name: string) {
    return this.#accounts.findMany({ where: eq(accounts.name, name), limit: 10 });
  }
}
```

The repository also exposes `update`, `deleteById`, `count`, `exists`,
`updateMany`, and `deleteMany`; `## Limits` states their conditions.

### Async registration

```ts
import { Module } from "@aponiajs/common";
import { DatabaseModule } from "@aponiajs/database";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";

@Module({
  imports: [
    DatabaseModule.forRootAsync({
      useFactory: () => ({ database: drizzle(new Database("app.sqlite")) }),
    }),
  ],
})
export class AppModule {}
```

`useClass` constructs the factory class and reads its `create()` method;
`useExisting` aliases an already-registered provider through the same method.

```ts
import { Injectable } from "@aponiajs/common";
import { DatabaseModule, type DatabaseModuleOptions } from "@aponiajs/database";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";

@Injectable()
class DatabaseOptionsFactory {
  create(): DatabaseModuleOptions {
    return { database: drizzle(new Database("app.sqlite")) };
  }
}

DatabaseModule.forRootAsync({ useClass: DatabaseOptionsFactory });
DatabaseModule.forRootAsync({ useExisting: DatabaseOptionsFactory });
```

`useExisting` expects `DatabaseOptionsFactory` to be a provider of the module
that imports the registration.

## Transactions

```ts
@Injectable()
class AuditWriter {
  constructor(private readonly database: DatabaseService) {}

  async record(id: string): Promise<void> {
    await this.database.transaction(async (tx) => {
      await tx.execute(sql`insert into audit_log (id) values (${id})`);
    });
  }
}
```

`transaction` awaits the callback, so the driver must be able to run an
asynchronous transaction (PostgreSQL, MySQL, libSQL). Bun SQLite's driver is
synchronous: use `transactionSync`, and use a synchronous callback.

## Migrations

`loadMigrations(directory)` reads `.sql` files in name order. `MigrationRunner`
applies each file the store has not recorded and skips the rest; a failing
statement stops the run and is not recorded. Each file records a SHA-256
checksum, so an applied file whose SQL changed fails with `INVALID_MIGRATION`.
When the driver exposes a transaction, the statement and its record run inside
it. A concurrent-boot deployment passes an application-supplied advisory `lock`;
the package owns no dialect SQL. The default store is `MemoryMigrationStore`,
which is process-local, so a real application passes a store backed by its own
migration table. When `migrations` is declared on the registration, the service
applies them during `onModuleInit`, before handlers run.

## Limits

The repository covers one table with an `id` column and the operations above.
`count` answers a row count and `exists` a presence check, each with an optional
condition. `updateMany` and `deleteMany` apply to every matching row, or to all
rows when no condition is passed, and answer the affected count.
`findMany` accepts a condition, an order, a limit, and an offset; a limit must be
a positive integer and an offset a non-negative one.
Joins, relations, and dialect-specific features stay in the application's own
Drizzle queries through `service.client`. The package does not transpile or plan
DDL; drizzle-kit or hand-written SQL owns that.

## Registration contract

`DatabaseModule.forRoot` is a `ConfigurableModuleBuilder` definition: it provides
and exports `MODULE_OPTIONS_TOKEN` (`DATABASE_MODULE_OPTIONS`), accepts
`isGlobal` as a definition-shaping extra and the three asynchronous shapes
through `forRootAsync`, and keeps `register`/`registerAsync` as deprecated
aliases. Both forms validate the database, every migration file, the store, and
the lock before the boot proceeds, reporting every issue at once.

## Bootstrap

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule);
await application.listen(Number(Bun.env.PORT ?? 3000));
```

## Documentation

- [Agent surface](../../docs/agent/README.md)
- [Database guide](../../docs/services/database.md)
- [Published packages](../../docs/reference/packages.md)
- [npm](https://www.npmjs.com/package/@aponiajs/database)
