# Database

`@aponiajs/database` is a thin boundary over Drizzle. The application builds its
own database with its own dialect; the package owns three things: the
transaction seam, a typed repository over one table, and ordered SQL migrations.

```ts
const database = drizzle(new Database("app.sqlite"));

@Module({ imports: [DatabaseModule.register({ database })] })
export class AppModule {}
```

`DatabaseService.client` is exactly the instance the application registered, so
joins, relations, and dialect-specific queries stay in the application's own
Drizzle code.

## Transactions

```ts
await service.transaction(async (tx) => {
  await tx.execute(sql`insert into audit_log (id) values (${id})`);
});
```

`transaction` awaits the callback, so it needs a driver whose transaction is
asynchronous. Bun SQLite's driver is synchronous; there, use `transactionSync`
with a synchronous callback so the commit happens after the work, not before a
promise settles.

## Repositories

```ts
import { asc, eq } from "drizzle-orm";

const users = sqliteTable("users", { id: text("id").primaryKey(), name: text("name").notNull() });
const repository = createRepository(database, users);

await repository.insert({ id: "1", name: "ada" });
await repository.findMany({
  where: eq(users.name, "ada"),
  orderBy: [asc(users.id)],
  limit: 10,
  offset: 0,
});
```

The repository covers one table with an `id` column: `findById`, `findMany`,
`count`, `exists`, `insert`, `insertMany`, `update`, `updateMany`, `deleteById`,
and `deleteMany`. Rows come back frozen; an
`insert` the driver does not return answers `DATABASE_WRITE_FAILED`. `findMany`
accepts a condition, an order, a limit, and an offset; an invalid limit or
offset answers `INVALID_DATABASE_OPTIONS`.
`updateMany` and `deleteMany` apply to every matching row, or to all rows when
no condition is passed, and answer the affected count.

## Migrations

```ts
DatabaseModule.register({
  database,
  migrations: { files: await loadMigrations("./migrations") },
});
```

`loadMigrations` reads `.sql` files in name order. `MigrationRunner` applies
each name the store has not recorded and skips the rest; the first failing
statement stops the run and is not recorded. Declared migrations run during
`onModuleInit`, before any handler.

`MemoryMigrationStore` is the default and is process-local. A real deployment
passes a store backed by its own migration table so a second process does not
re-run the same files.

See the [package README](../packages/database/README.md) for the full contract.
