import { expect, test } from "bun:test";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { createLambdaHandler, toFetchHandler } from "@aponiajs/serverless";
import { AppModule } from "../src/app.module.ts";

test("serves requests via standard Fetch handler", async () => {
  const application = await AponiaFactory.create(AppModule, { logger: false });
  const fetchHandler = toFetchHandler(application);

  const response = await fetchHandler(new Request("http://localhost/hello"));
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("Hello from Serverless Aponia!");

  await application.close();
});

test("serves requests via AWS Lambda payload v2", async () => {
  const application = await AponiaFactory.create(AppModule, { logger: false });
  const lambda = createLambdaHandler(application);

  const result = await lambda({
    version: "2.0",
    rawPath: "/hello",
    rawQueryString: "",
    headers: { host: "localhost" },
    requestContext: {
      http: {
        method: "GET",
      },
    },
    isBase64Encoded: false,
  });

  expect(result.statusCode).toBe(200);
  expect(result.body).toBe("Hello from Serverless Aponia!");

  await application.close();
});
