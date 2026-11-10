import { afterAll, describe, expect, test } from "bun:test";
import { Controller, Get, Module, Render } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { ViewModule } from "@aponiajs/view";
import { Inertia } from "../src/index.ts";
import { toFetchHandler, createLambdaHandler } from "@aponiajs/serverless";
import { createHonoApp } from "@aponiajs/hono";
import { H3, toWebHandler } from "h3";
import { toH3Handler } from "@aponiajs/h3";
import { toNitroHandler } from "@aponiajs/nitro";

@Controller()
class MatrixController {
  @Get("view")
  @Render("matrix")
  view() {
    return { title: "Matrix" };
  }

  @Get("inertia")
  @Inertia("Matrix/Page")
  inertia() {
    return { title: "Matrix" };
  }
}

@Module({
  imports: [
    ViewModule.register({
      defaultEngine: "blade",
      rootDir: new URL("./fixtures/views", import.meta.url).pathname,
    }),
  ],
  controllers: [MatrixController],
})
class MatrixModule {}

const application = await AponiaFactory.create(MatrixModule, { logger: false });

afterAll(async () => {
  await application.close();
});

type Adapter = {
  readonly name: string;
  readonly handle: (request: Request) => Promise<Response>;
};

function adapters(): Adapter[] {
  const hono = createHonoApp(application);
  const h3 = toWebHandler(new H3().use(toH3Handler(application)));
  const nitro = toNitroHandler(application);
  return [
    { name: "native Elysia", handle: async (request) => application.handle(request) },
    { name: "serverless fetch", handle: toFetchHandler(application) },
    { name: "hono", handle: async (request) => hono.request(request) },
    { name: "h3", handle: (request) => h3(request) },
    { name: "nitro", handle: (request) => nitro.fetch(request) },
  ];
}

describe("MVC view stack across delivery adapters", () => {
  for (const adapter of adapters()) {
    test(`${adapter.name} renders a Blade view`, async () => {
      const response = await adapter.handle(new Request("http://localhost/view"));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect((await response.text()).trim()).toBe("<h1>Matrix</h1>");
    });

    test(`${adapter.name} answers the Inertia protocol`, async () => {
      const full = await adapter.handle(new Request("http://localhost/inertia"));
      expect(await full.text()).toContain('id="app"');

      const spa = await adapter.handle(
        new Request("http://localhost/inertia", { headers: { "x-inertia": "true" } }),
      );
      expect(spa.headers.get("x-inertia")).toBe("true");
      expect(((await spa.json()) as { component: string }).component).toBe("Matrix/Page");
    });
  }

  test("AWS Lambda payload v2 renders the same view", async () => {
    const lambda = createLambdaHandler(application);
    const result = await lambda({
      version: "2.0",
      rawPath: "/view",
      rawQueryString: "",
      headers: { host: "localhost" },
      requestContext: { http: { method: "GET" } },
      isBase64Encoded: false,
    });
    expect(result.statusCode).toBe(200);
    expect(result.body.trim()).toBe("<h1>Matrix</h1>");
  });
});
