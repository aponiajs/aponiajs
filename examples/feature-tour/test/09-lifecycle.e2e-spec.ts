import { expect, test } from "bun:test";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";
import { AppModule } from "../src/app.module.ts";

test("answers requests without binding a port", async () => {
  const application = await AponiaFactory.create(AppModule, { logger: false });

  expect((await application.handle(new Request("http://localhost/settings"))).status).toBe(200);
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
    configureNative: (native) => native.onError(({ code }) => ({ handled: String(code) })),
  });

  const response = await application.handle(new Request("http://localhost/nowhere"));

  expect(await response.json()).toEqual({ handled: "NOT_FOUND" });
  await application.close();
});
