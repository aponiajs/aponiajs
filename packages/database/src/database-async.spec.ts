import { afterEach, expect, test } from "bun:test";
import { Module } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { DatabaseModule, DatabaseService } from "./index.ts";

test("forRootAsync resolves the database at boot", async () => {
  const database = {};

  @Module({ imports: [DatabaseModule.forRootAsync({ useFactory: () => ({ database }) })] })
  class AppModule {}

  application = await AponiaFactory.create(AppModule, { logger: false });

  expect(application.get(DatabaseService).client).toBe(database);
});

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});
