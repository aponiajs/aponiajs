import { afterEach, expect, test } from "bun:test";
import { Module } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { SessionModule, SessionService } from "../index.ts";

const secret = "0123456789abcdef0123456789abcdef";

test("forRootAsync resolves the registration options", async () => {
  @Module({ imports: [SessionModule.forRootAsync({ useFactory: () => ({ secret }) })] })
  class AppModule {}

  application = await AponiaFactory.create(AppModule, { logger: false });

  expect(application.get(SessionService)).toBeDefined();
});

test("forRootAsync refuses an invalid factory result at boot", async () => {
  @Module({ imports: [SessionModule.forRootAsync({ useFactory: () => ({ secret: "short" }) })] })
  class AppModule {}

  let failure: unknown;
  try {
    await AponiaFactory.create(AppModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(Error);
});

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});
