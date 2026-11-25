import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  DatabaseModule,
  DatabaseService,
  MODULE_OPTIONS_TOKEN,
  MemoryMigrationStore,
  MigrationRunner,
  createRepository,
  type DatabaseModuleOptions,
  type RepositoryQuery,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  age: integer("age"),
});

test("exposes the documented database contract", () => {
  const options: DatabaseModuleOptions = { database: {}, migrations: { files: [] } };
  const query: RepositoryQuery = { limit: 1 };

  expect(options.migrations?.files).toEqual([]);
  expect(query.limit).toBe(1);
});

test("reads, writes, and deletes through the repository surface", async () => {
  const row = { id: "1", name: "ada", age: 36 };
  const fake = {
    select: () => ({ from: () => ({ where: () => [row], limit: () => [row] }) }),
    insert: () => ({ values: () => ({ returning: () => [row] }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => [row] }) }) }),
    delete: () => ({ where: () => ({ returning: () => [row] }) }),
  };
  const repository = createRepository(fake, users);

  expect(await repository.findById("1")).toEqual(row);
  expect(await repository.findMany()).toHaveLength(1);
  expect(await repository.insert({ id: "1", name: "ada" })).toEqual(row);
  expect(await repository.update("1", { name: "Ada" })).toEqual(row);
  expect(await repository.updateMany({ value: { name: "Ada" } })).toBe(1);
  expect(await repository.deleteById("1")).toBe(true);
  expect(await repository.deleteMany()).toBe(1);
});

test("runs a synchronous transaction and one migration", async () => {
  const statements: unknown[] = [];
  const service = new DatabaseService({
    database: {
      transaction: (run: (transaction: never) => unknown) =>
        run({ execute: (query: unknown) => statements.push(query) } as never),
    },
  });

  expect(
    service.transactionSync((transaction) => {
      transaction.execute("one");
      return "done";
    }),
  ).toBe("done");

  const runner = new MigrationRunner(new MemoryMigrationStore());
  expect(
    await runner.run({ execute: (query) => statements.push(query) }, [
      { name: "001-initial.sql", sql: "select 1" },
    ]),
  ).toEqual({ applied: ["001-initial.sql"], skipped: [] });
  expect(statements).toHaveLength(2);
});

test("the registration is a builder definition with an options token and extras", () => {
  const definition = DatabaseModule.forRoot({ database: {}, isGlobal: true });
  const asyncDefinition = DatabaseModule.forRootAsync({
    useFactory: async () => ({ database: {} }),
  });

  expect(definition.module).toBe(DatabaseModule);
  expect(definition.global).toBe(true);
  expect(definition.exports).toContain(MODULE_OPTIONS_TOKEN);
  expect(asyncDefinition.exports).toContain(MODULE_OPTIONS_TOKEN);
  expect(() => DatabaseModule.forRoot({} as never)).toThrow();
});
