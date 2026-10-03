import { afterEach, expect, test } from "bun:test";
import { AponiaError } from "@aponiajs/common";
import type { AponiaApplication } from "@aponiajs/platform-elysia";
import { AppConfig } from "../src/config.ts";
import { createApplication, get } from "./application.ts";

const defaultServiceName = "aponia-example-configuration";

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

test("injects the value the schema produced, not the record it read", async () => {
  application = await createApplication({ PORT: "3121" });

  const response = await get(application, "/");

  expect(response.status).toBe(200);
  // `port`, not `PORT`: the transform is what the application reads, and the
  // key the schema validated is the environment's own spelling.
  expect(await response.json()).toEqual({ serviceName: defaultServiceName, port: 3121 });
});

test("applies the schema's default when the key is absent", async () => {
  application = await createApplication({ PORT: undefined });

  expect(await (await get(application, "/")).json()).toEqual({
    serviceName: defaultServiceName,
    port: 3100,
  });
});

test("refuses a malformed value at boot and names the key it refused", async () => {
  let thrown: unknown;

  try {
    application = await createApplication({ PORT: "abc" });
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(AponiaError);
  expect((thrown as AponiaError).code).toBe("INVALID_CONFIGURATION_VALUE");
  expect(JSON.stringify((thrown as AponiaError).details)).toContain("PORT");
});

test("reads back the one value the application was built with", async () => {
  application = await createApplication({ PORT: "3123" });

  expect(application.get(AppConfig).port).toBe(3123);
  // The container caches one instance per provider, so identity is the read's
  // contract rather than an implementation detail: two reads answer one object.
  expect(application.get(AppConfig)).toBe(application.get(AppConfig));
});
