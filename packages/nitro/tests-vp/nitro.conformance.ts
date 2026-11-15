import { defineModule } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { toNitroHandler } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");
declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

const AppModule = defineModule({ id: "NitroAdapterModule" });

test("mounts an Aponia application on the Nitro handler", async () => {
  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const fetch = toNitroHandler(application).fetch;
    const response = await fetch(new Request("http://localhost/missing"));
    expect(response.status).toBe(404);
  } finally {
    await application.close();
  }
});
