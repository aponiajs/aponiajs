import { defineModule } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { createLambdaHandler, toFetchHandler } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

const AppModule = defineModule({ id: "ServerlessModule" });

test("answers a fetch request and a Lambda payload 2.0 event", async () => {
  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const fetch = toFetchHandler(application);
    expect((await fetch(new Request("https://example.test/missing"))).status).toBe(404);

    const handler = createLambdaHandler(application);
    const result = await handler({
      version: "2.0",
      rawPath: "/missing",
      requestContext: { http: { method: "GET" } },
      headers: { host: "example.test" },
    });
    expect(result.statusCode).toBe(404);
  } finally {
    await application.close();
  }
});
