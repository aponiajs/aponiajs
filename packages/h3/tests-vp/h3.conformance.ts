import { defineModule } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { H3, toWebHandler } from "h3";
import { toH3Handler } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");
declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

const AppModule = defineModule({ id: "H3AdapterModule" });

test("mounts an Aponia application on H3", async () => {
  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const fetch = toWebHandler(new H3().use(toH3Handler(application)));
    const response = await fetch(new Request("http://localhost/missing"));
    expect(response.status).toBe(404);
  } finally {
    await application.close();
  }
});
