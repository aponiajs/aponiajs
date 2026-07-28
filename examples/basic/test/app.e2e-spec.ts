import { expect, test } from "bun:test";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "../src/app.module.ts";

test("routes requests through module, controller, and service", async () => {
  const application = await AponiaFactory.create(AppModule, { logger: false });
  const response = await application.handle(new Request("http://localhost/greetings"));

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("Hello, AponiaJS!");
  await application.close();
});
