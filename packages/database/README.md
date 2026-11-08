# @aponiajs/database

A Drizzle-first database boundary for AponiaJS: one transaction seam, typed
repositories over a table, and ordered SQL migrations.

```bash
bun add @aponiajs/database@beta drizzle-orm
```

## Use it

```ts
import { Injectable, Module } from "@aponiajs/common";
import { DatabaseModule } from "@aponiajs/database";
import { DatabaseService, createRepository } from "@aponiajs/database";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

const database = drizzle(new Database("app.sqlite"));

const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

@Injectable()
class UsersRepository {
  readonly #repository;

  constructor(databaseService: DatabaseService) {
    this.#repository = createRepository(databaseService.client, users);
  }

  insert(input: { readonly id: string; readonly name: string }) {
    return this.#repository.insert(input);
  }

  findById(id: string) {
    return this.#repository.findById(id);
  }
}

@Module({
  imports: [
    DatabaseModule.register({
      database,
      migrations: { files: await loadMigrations("./migrations") },
    }),
  ],
  providers: [UsersRepository],
  exports: [UsersRepository],
})
export class AppModule {}
```

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule);
await application.listen(Number(Bun.env.PORT ?? 3000));
```

The package builds no pool and picks no dialect. The application constructs its
Drizzle database, and the module owns the transaction seam and migrations.

```ts
@Injectable()
class UsersRepository {
  // constructor from the registration above

  async listActive(): Promise<void> {
    await this.#repository.insert({ id: "1", name: "ada" });
    await this.#repository.findById("1");
    await this.#repository.update("1", { name: "Ada" });
    await this.#repository.deleteById("1");
    await this.#repository.findMany({
      where: eq(users.name, "Ada"),
      orderBy: [asc(users.id)],
      limit: 10,
      offset: 0,
    });
    await this.#repository.count({ where: eq(users.name, "Ada") });
    await this.#repository.exists(eq(users.name, "Ada"));
    await this.#repository.updateMany({ where: eq(users.name, "Ada"), value: { name: "Ada L." } });
    await this.#repository.deleteMany(eq(users.name, "Ada L."));
  }
}
```

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
statement stops the run and is not recorded. The default store is
`MemoryMigrationStore`, which is process-local, so a real application passes a
store backed by its own migration table. When `migrations` is declared on the
registration, the service applies them during `onModuleInit`, before handlers
run.

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

## Documentation

- [Agent surface](../../docs/agent/README.md)
- [Database guide](../../docs/database.md)
- [Published packages](../../docs/packages.md)
- [npm](https://www.npmjs.com/package/@aponiajs/database)
