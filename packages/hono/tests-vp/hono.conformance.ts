import { defineModule } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { createHonoApp } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");
declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

const AppModule = defineModule({ id: "HonoAdapterModule" });

test("mounts an Aponia application on Hono", async () => {
  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const response = await createHonoApp(application).request("http://localhost/missing");
    expect(response.status).toBe(404);
  } finally {
    await application.close();
  }
});
