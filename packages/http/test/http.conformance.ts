import { Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import {
  HTTP_CLIENT_MODULE_OPTIONS,
  HttpClient,
  HttpModule,
  HttpService,
  getHttpClientToken,
  type HttpModuleOptions,
  type HttpRequestOptions,
  type HttpResponse,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("exposes the documented options and response contract", () => {
  const options: HttpModuleOptions = {
    baseUrl: "https://api.example.com",
    timeoutMs: 1_000,
    retries: 1,
    maxResponseBytes: 1_024,
    allowPrivateNetworks: false,
  };
  const response: HttpResponse<{ ok: boolean }> = {
    status: 200,
    headers: new Headers(),
    data: { ok: true },
    url: "https://api.example.com",
    redirected: false,
  };

  expect(options.timeoutMs).toBe(1_000);
  expect(response.data.ok).toBe(true);
});

test("sends the idempotency key a request states", async () => {
  let seen: Request | undefined;
  const fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    seen = input instanceof Request ? input : new Request(String(input), init);
    return Response.json({ ok: true });
  }) as unknown as typeof globalThis.fetch;

  @Module({
    imports: [
      HttpModule.register({
        baseUrl: "https://api.example.com",
        fetch,
        resolveAddresses: async () => ["93.184.216.34"],
      }),
    ],
  })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const options: HttpRequestOptions = { json: { id: 1 }, idempotencyKey: "order-1" };
    await application.get(HttpService).post("/orders", options);
    expect(seen?.headers.get("idempotency-key")).toBe("order-1");
  } finally {
    await application.close();
  }
});

test("boots and sends through the injected service", async () => {
  const fetch = (async () => Response.json({ ok: true })) as unknown as typeof globalThis.fetch;

  @Module({
    imports: [
      HttpModule.register({
        baseUrl: "https://api.example.com",
        fetch,
        resolveAddresses: async () => ["93.184.216.34"],
      }),
    ],
  })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const service = application.get(HttpService);
    const response = await service.get<{ ok: boolean }>("/health");

    expect(response.data).toEqual({ ok: true });
  } finally {
    await application.close();
  }
});

test("the root registration is a builder definition that registers no client", () => {
  const definition = HttpModule.forRoot({ timeoutMs: 1_000 });
  const asyncDefinition = HttpModule.forRootAsync({
    useFactory: async () => ({ timeoutMs: 1_000 }),
  });

  expect(HttpClient).toBe(HttpService);
  expect(definition.module).toBe(HttpModule);
  expect(definition.global).toBe(true);
  expect(definition.exports).toContain(HTTP_CLIENT_MODULE_OPTIONS);
  expect(asyncDefinition.exports).toContain(HTTP_CLIENT_MODULE_OPTIONS);
  expect(() => HttpModule.forRoot({ timeoutMs: 0 })).toThrow();
});

test("a client registration exports its token and the Nest decorator names it", () => {
  const definition = HttpModule.register({ timeoutMs: 1_000 });
  const named = HttpModule.register({ name: "github", timeoutMs: 1_000 });

  expect(definition.exports).toContain(HttpClient);
  expect(named.exports).toContain("HttpClient:github");
  expect(getHttpClientToken("github")).toBe("HttpClient:github");
  expect(getHttpClientToken()).toBe(HttpClient);
});
