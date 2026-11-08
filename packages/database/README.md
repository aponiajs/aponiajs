# @aponiajs/database

A Drizzle-first database boundary for AponiaJS: one transaction seam, typed
repositories over a table, and ordered SQL migrations.

```bash
bun add @aponiajs/database@beta drizzle-orm
```

## Use it

```ts
import { Module } from "@aponiajs/common";
import { DatabaseModule } from "@aponiajs/database";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";

const database = drizzle(new Database("app.sqlite"));

@Module({
  imports: [
    DatabaseModule.register({
      database,
      migrations: { files: await loadMigrations("./migrations") },
    }),
  ],
})
export class AppModule {}
```

The package builds no pool and picks no dialect. The application constructs its
Drizzle database, and the module owns the transaction seam and migrations.

```ts
const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

const repository = createRepository(database, users);
await repository.insert({ id: "1", name: "ada" });
await repository.findById("1");
await repository.update("1", { name: "Ada" });
await repository.deleteById("1");
await repository.findMany({
  where: eq(users.name, "Ada"),
  orderBy: [asc(users.id)],
  limit: 10,
  offset: 0,
});
await repository.count({ where: eq(users.name, "Ada") });
await repository.exists(eq(users.name, "Ada"));
await repository.updateMany({ where: eq(users.name, "Ada"), value: { name: "Ada L." } });
await repository.deleteMany(eq(users.name, "Ada L."));
```

## Transactions

```ts
const service = application.get(DatabaseService);
await service.transaction(async (tx) => {
  await tx.execute(sql`insert into audit_log (id) values (${id})`);
});
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
