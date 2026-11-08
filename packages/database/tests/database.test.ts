import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { AponiaError, Module } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { asc, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  DatabaseModule,
  DatabaseService,
  MemoryMigrationStore,
  MigrationRunner,
  createRepository,
  loadMigrations,
  type DatabaseClient,
  type DatabaseTransaction,
} from "../src/index.ts";

const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  age: integer("age"),
});

const temporaryDirectories: string[] = [];
let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("createRepository", () => {
  test("reads and writes one table", async () => {
    const database = sqliteDatabase();
    const repository = createRepository(database, users);

    const ada = await repository.insert({ id: "1", name: "ada", age: 36 });
    expect(ada).toEqual({ id: "1", name: "ada", age: 36 });
    expect(Object.isFrozen(ada)).toBe(true);
    expect(repository.table).toBe(users);

    const many = await repository.insertMany([
      { id: "2", name: "grace", age: 45 },
      { id: "3", name: "linus", age: null },
    ]);
    expect(many).toHaveLength(2);
    expect(await repository.insertMany([])).toEqual([]);

    expect(await repository.findById("2")).toMatchObject({ name: "grace" });
    expect(await repository.findById("missing")).toBeUndefined();

    expect(await repository.findMany()).toHaveLength(3);
    expect(await repository.findMany({ where: eq(users.name, "ada") })).toHaveLength(1);
    expect(await repository.findMany({ limit: 1 })).toHaveLength(1);
    expect(
      (await repository.findMany({ orderBy: [asc(users.name)] })).map((row) => row.name),
    ).toEqual(["ada", "grace", "linus"]);
    expect(
      (await repository.findMany({ orderBy: [desc(users.age)] })).map((row) => row.name),
    ).toEqual(["grace", "ada", "linus"]);
    expect(
      (await repository.findMany({ orderBy: [asc(users.name)], offset: 1, limit: 1 })).map(
        (row) => row.name,
      ),
    ).toEqual(["grace"]);
    expect(
      (await repository.findMany({ where: eq(users.name, "grace"), orderBy: [asc(users.name)] }))
        .length,
    ).toBe(1);
    expect((await rejection(repository.findMany({ limit: 0 }))).code).toBe(
      "INVALID_DATABASE_OPTIONS",
    );
    expect((await rejection(repository.findMany({ offset: -1 }))).code).toBe(
      "INVALID_DATABASE_OPTIONS",
    );
    expect(await repository.count()).toBe(3);
    expect(await repository.count({ where: eq(users.name, "ada") })).toBe(1);
    expect(await repository.exists()).toBe(true);
    expect(await repository.exists(eq(users.name, "missing"))).toBe(false);

    expect(await repository.update("1", { age: 37 })).toMatchObject({ age: 37 });
    expect(await repository.update("missing", { age: 1 })).toBeUndefined();

    expect(await repository.deleteById("3")).toBe(true);
    expect(await repository.deleteById("3")).toBe(false);
    expect(await repository.updateMany({ where: eq(users.name, "ada"), value: { age: 40 } })).toBe(
      1,
    );
    expect(await repository.findById("1")).toMatchObject({ age: 40 });
    expect(await repository.updateMany({ value: { age: 1 } })).toBe(2);
    expect(await repository.deleteMany(eq(users.name, "grace"))).toBe(1);
    expect(await repository.deleteMany()).toBe(1);
  });

  test("refuses a database that cannot select or return a row", async () => {
    expect(capture(() => createRepository({} as DatabaseClient, users)).code).toBe(
      "INVALID_DATABASE_OPTIONS",
    );

    const emptyWrites = {
      select: () => ({ from: () => ({ where: () => ({ limit: () => [] }) }) }),
      insert: () => ({ values: () => ({ returning: async () => [] }) }),
      update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
      delete: () => ({ where: () => ({ returning: async () => [] }) }),
    } as unknown as DatabaseClient;
    const repository = createRepository(emptyWrites, users);

    const error = await rejection(repository.insert({ id: "1", name: "ada" }));
    expect(error.code).toBe("DATABASE_WRITE_FAILED");
    expect(error.details).toEqual({ table: "users" });
  });
});

describe("DatabaseService", () => {
  test("wraps an asynchronous transaction and exposes its handle", async () => {
    const statements: string[] = [];
    const service = new DatabaseService({
      database: {
        select: () => ({}),
        transaction: async <T>(run: (transaction: unknown) => T | Promise<T>) =>
          await run({
            run: async (query: unknown) => {
              statements.push(String(query));
            },
          }),
      },
    });

    const result = await service.transaction(async (transaction) => {
      await transaction.execute("insert 1");
      expect(transaction.client).toBeDefined();
      return "done";
    });

    expect(result).toBe("done");
    expect(statements).toEqual(["insert 1"]);
  });

  test("runs a raw statement through execute or run", async () => {
    const executed: unknown[] = [];
    const executedService = new DatabaseService({
      database: { execute: (query: unknown) => executed.push(query), select: () => ({}) },
    });
    await executedService.execute("one");

    const runService = new DatabaseService({
      database: { run: (query: unknown) => executed.push(query) },
    });
    await runService.execute("two");

    expect(executed).toEqual(["one", "two"]);
    const noRunner = new DatabaseService({ database: { select: () => ({}) } });
    expect((await rejection(noRunner.execute("three"))).code).toBe("INVALID_DATABASE_OPTIONS");
  });

  test("commits and rolls back a synchronous transaction", () => {
    const native = new Database(":memory:");
    const database = drizzle(native);
    database.run(sql`create table users (id text primary key, name text not null)`);
    const service = new DatabaseService({ database });

    service.transactionSync((transaction) => {
      transaction.execute(sql`insert into users (id, name) values ('1', 'ada')`);
    });
    expect(service.transactionSync(() => countRows(database))).toBe(1);

    expect(() =>
      service.transactionSync((transaction) => {
        transaction.execute(sql`insert into users (id, name) values ('2', 'grace')`);
        throw new Error("rollback");
      }),
    ).toThrow("rollback");
    expect(service.transactionSync(() => countRows(database))).toBe(1);
  });

  test("refuses a transaction boundary it cannot find", async () => {
    const service = new DatabaseService({ database: { select: () => ({}) } });
    const error = await rejection(service.transaction(async () => 1));

    expect(error.code).toBe("INVALID_DATABASE_OPTIONS");
    expect(() => service.transactionSync(() => 1)).toThrow("transaction boundary");
    expect(
      capture(() => new DatabaseService({ database: null as unknown as DatabaseClient })).code,
    ).toBe("INVALID_DATABASE_OPTIONS");
  });

  test("refuses a transaction handle with no statement runner", async () => {
    const service = new DatabaseService({
      database: {
        transaction: async <T>(run: (transaction: unknown) => T | Promise<T>) => await run({}),
      },
    });

    const error = await rejection(
      service.transaction(async (transaction: DatabaseTransaction) => {
        await transaction.execute("select 1");
      }),
    );

    expect(error.code).toBe("INVALID_DATABASE_OPTIONS");
  });
});

describe("MigrationRunner", () => {
  test("applies pending migrations in name order and skips recorded ones", async () => {
    const store = new MemoryMigrationStore();
    store.record("001-initial.sql");
    const runner = new MigrationRunner(store);
    const statements: unknown[] = [];

    const result = await runner.run({ execute: (query: unknown) => statements.push(query) }, [
      { name: "002-add-name.sql", sql: "alter table users add column name" },
      { name: "001-initial.sql", sql: "create table users" },
    ]);

    expect(result).toEqual({
      applied: ["002-add-name.sql"],
      skipped: ["001-initial.sql"],
    });
    expect(statements).toHaveLength(1);
    expect(store.applied()).toEqual(["001-initial.sql", "002-add-name.sql"]);
  });

  test("refuses unnamed, duplicate, or SQL-less migrations", async () => {
    const runner = new MigrationRunner(new MemoryMigrationStore());
    const executor = { execute: () => {} };

    expect((await rejection(runner.run(executor, [{ name: " ", sql: "select 1" }]))).code).toBe(
      "INVALID_MIGRATION",
    );
    expect(
      (await rejection(runner.run(executor, [{ name: "a.sql", sql: 1 as unknown as string }])))
        .code,
    ).toBe("INVALID_MIGRATION");
    const duplicate = await rejection(
      runner.run(executor, [
        { name: "a.sql", sql: "select 1" },
        { name: "a.sql", sql: "select 2" },
      ]),
    );
    expect(duplicate.code).toBe("INVALID_MIGRATION");
    expect(duplicate.details).toEqual({ issues: ["names must be unique"], migration: "a.sql" });
  });

  test("does not record a migration whose statement failed", async () => {
    const store = new MemoryMigrationStore();
    const runner = new MigrationRunner(store);

    expect(() =>
      runner.run(
        {
          execute: () => {
            throw new Error("syntax error");
          },
        },
        [{ name: "001-broken.sql", sql: "nope" }],
      ),
    ).toThrow("syntax error");
    expect(store.applied()).toEqual([]);
  });

  test("applies migrations through a registered database during module init", async () => {
    const native = new Database(":memory:");
    const database = drizzle(native);

    @Module({
      imports: [
        DatabaseModule.register({
          database,
          migrations: { files: [{ name: "001-users.sql", sql: "create table users (id text)" }] },
        }),
      ],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const service = application.get(DatabaseService);

    expect(service.client).toBeDefined();
    expect(await service.migrate()).toEqual({ applied: [], skipped: ["001-users.sql"] });
    expect(() => native.query("select * from users").all()).not.toThrow();
  });

  test("answers an empty migration run when none were declared", async () => {
    const service = new DatabaseService({ database: { select: () => ({}) } });

    expect(await service.migrate()).toEqual({ applied: [], skipped: [] });
  });
});

describe("loadMigrations", () => {
  test("reads the .sql files of a directory in name order", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aponia-migrations-"));
    temporaryDirectories.push(directory);
    await writeFile(join(directory, "002-second.sql"), "select 2;");
    await writeFile(join(directory, "001-first.sql"), "select 1;");
    await writeFile(join(directory, "notes.txt"), "ignored");

    const migrations = await loadMigrations(directory);

    expect(migrations).toEqual([
      { name: "001-first.sql", sql: "select 1;" },
      { name: "002-second.sql", sql: "select 2;" },
    ]);
    expect(Object.isFrozen(migrations)).toBe(true);
  });
});

function sqliteDatabase() {
  const native = new Database(":memory:");
  const database = drizzle(native);
  database.run(sql`create table users (id text primary key, name text not null, age integer)`);
  return database;
}

function countRows(database: ReturnType<typeof drizzle>): number {
  const rows = database.all<{ count: number }>(sql`select count(*) as count from users`);
  return rows[0]?.count ?? 0;
}

function capture(run: () => unknown): AponiaError {
  try {
    run();
  } catch (error) {
    if (error instanceof AponiaError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected an AponiaError.");
}

async function rejection(promise: Promise<unknown>): Promise<AponiaError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AponiaError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected the promise to reject with an AponiaError.");
}
