import { expect, test } from "bun:test";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { toNitroHandler } from "@aponiajs/nitro";
import { AppModule } from "../src/app.module.ts";

test("adapts application to Nitro server handler", async () => {
  const application = await AponiaFactory.create(AppModule, { logger: false });
  const handler = toNitroHandler(application);

  const response = await handler.fetch(new Request("http://localhost/nitro-api"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "running on nitro" });

  await application.close();
});
