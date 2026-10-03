import { expect, test } from "bun:test";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { Elysia, ElysiaError } from "elysia";
import { AppModule } from "../src/app.module.ts";

/**
 * Elysia 1 handed an error hook the framework's `code` string; Elysia 2 hands it
 * the exception instead, and the code is a member of the typed error. The slug is
 * read off `ElysiaError.code`, which every framework failure carries.
 */
function errorCode(error: unknown): string {
  return error instanceof ElysiaError ? String(error.code) : "unknown";
}

test("answers requests without binding a port", async () => {
  const application = await AponiaFactory.create(AppModule, { logger: false });

  expect((await application.handle(new Request("http://localhost/greetings"))).status).toBe(200);
  await application.close();
});

test("refuses to report a URL before listening", async () => {
  const application = await AponiaFactory.create(AppModule, { logger: false });

  expect(() => application.getUrl()).toThrow(
    expect.objectContaining({ code: "APPLICATION_NOT_LISTENING" }),
  );
  await application.close();
});

test("reports the address it actually bound", async () => {
  const application = await AponiaFactory.create(AppModule, { logger: false });
  await application.listen(0);

  expect(application.getUrl()).toStartWith("http://");
  await application.close();
});

test("hands back the native Elysia instance", async () => {
  const application = await AponiaFactory.create(AppModule, { logger: false });

  expect(application.getNativeApplication()).toBeInstanceOf(Elysia);
  await application.close();
});

test("rejects a configureNative hook that returns another instance", () => {
  expect(
    AponiaFactory.create(AppModule, {
      logger: false,
      configureNative: () => new Elysia({ name: "impostor" }) as never,
    }),
  ).rejects.toThrow(expect.objectContaining({ code: "INVALID_NATIVE_APPLICATION" }));
});

test("applies the error handler installed through configureNative", async () => {
  const application = await AponiaFactory.create(AppModule, {
    logger: false,
    configureNative: (native) => native.error(({ error }) => ({ handled: errorCode(error) })),
  });

  const response = await application.handle(new Request("http://localhost/nowhere"));

  expect(await response.json()).toEqual({ handled: "not-found" });
  await application.close();
});
