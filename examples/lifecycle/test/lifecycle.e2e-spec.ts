import { beforeEach, expect, test } from "bun:test";
import { announcements } from "../src/app.service.ts";
import { createApplication, get } from "./application.ts";

beforeEach(() => {
  announcements.length = 0;
});

test("a provider announces its own start, before the first request", async () => {
  const application = await createApplication();

  // Asserted before the request rather than after it, because the name says
  // "before the first request": a hook that only ran once something asked
  // would satisfy the response and fail this line.
  expect(announcements).toEqual(["onModuleInit"]);

  const response = await get(application, "/lifecycle/record");

  expect(await response.json()).toEqual({ started: true });

  await application.close();
});

test("its stop arrives when the application closes", async () => {
  const application = await createApplication();

  await application.close();

  expect(announcements).toEqual(["onModuleInit", "onApplicationShutdown"]);
});
