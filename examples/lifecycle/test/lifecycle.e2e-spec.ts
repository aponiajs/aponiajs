import { beforeEach, expect, test } from "bun:test";
import { announcements } from "../src/app.service.ts";
import { createApplication, get } from "./application.ts";

beforeEach(() => {
  announcements.length = 0;
});

test("a provider announces its own start, before the first request", async () => {
  const application = await createApplication();

  const response = await get(application, "/lifecycle/record");

  expect(await response.json()).toEqual({ started: true });
  expect(announcements).toEqual(["onModuleInit"]);

  await application.close();
});

test("its stop arrives when the application closes", async () => {
  const application = await createApplication();

  await application.close();

  expect(announcements).toEqual(["onModuleInit", "onApplicationShutdown"]);
});
