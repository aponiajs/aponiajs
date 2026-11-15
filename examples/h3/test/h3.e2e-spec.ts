import { expect, test } from "bun:test";
import { createApplication, send } from "./application.ts";

test("serves a decorated route on the H3 platform", async () => {
  const application = await createApplication();
  const response = await send(application, "/greetings/ada");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ message: "hello ada" });
  expect(application.platform).toBe("h3");

  await application.close();
});
