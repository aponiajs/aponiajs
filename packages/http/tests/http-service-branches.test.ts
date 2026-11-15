import { afterEach, describe, expect, test } from "bun:test";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { AponiaError, Module } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { HttpModule, HttpService } from "../src/index.ts";

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

async function createService(
  fetch: typeof globalThis.fetch,
  options: { readonly retries?: number } = {},
): Promise<HttpService> {
  @Module({
    imports: [
      HttpModule.register({
        baseUrl: "https://api.example.com",
        fetch,
        resolveAddresses: publicResolver,
        retryDelayMs: 0,
        ...(options.retries === undefined ? {} : { retries: options.retries }),
      }),
    ],
  })
  class AppModule {}

  application = await AponiaFactory.create(AppModule, { logger: false });
  return application.get(HttpService);
}

async function captureError(run: () => Promise<unknown>): Promise<AponiaError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof AponiaError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected an AponiaError.");
}

describe("HttpService option and response edges", () => {
  test("refuses conflicting bodies, invalid URLs, and forbidden headers", async () => {
    const service = await createService(fakeFetch(() => Response.json({})));

    expect(
      await captureError(() => service.request("/x", { json: { a: 1 }, body: "raw" })),
    ).toMatchObject({ code: "INVALID_HTTP_OPTIONS" });
    expect(await captureError(() => service.get("http://[::1"))).toMatchObject({
      code: "INVALID_HTTP_OPTIONS",
    });
    expect(
      await captureError(() => service.get("/x", { headers: { Host: "other.example" } })),
    ).toMatchObject({ code: "INVALID_HTTP_OPTIONS" });
  });

  test("sets request headers and rejects an invalid numeric option", async () => {
    let seen: Request | undefined;
    const service = await createService(
      fakeFetch((request) => {
        seen = request;
        return Response.json({ ok: true });
      }),
    );

    await service.get("/x", { headers: { "x-request": "one" } });
    expect(seen?.headers.get("x-request")).toBe("one");

    for (const options of [
      { timeoutMs: 0 },
      { retries: -1 },
      { maxResponseBytes: 0 },
      { maxRedirects: -1 },
    ]) {
      expect(await captureError(() => service.get("/x", options))).toMatchObject({
        code: "INVALID_HTTP_OPTIONS",
      });
    }
  });

  test("refuses a redirect that carries a body and one past the limit", async () => {
    const service = await createService(
      fakeFetch(() => new Response(null, { status: 307, headers: { location: "/next" } })),
    );

    expect(await captureError(() => service.post("/x", { json: { a: 1 } }))).toEqual(
      expect.objectContaining({ code: "HTTP_CLIENT_FAILED" }),
    );
    expect(await captureError(() => service.get("/x", { maxRedirects: 0 }))).toEqual(
      expect.objectContaining({ code: "HTTP_CLIENT_FAILED" }),
    );
  });

  test("returns a redirect status that carries no location", async () => {
    const service = await createService(
      fakeFetch(
        () =>
          new Response("moved", {
            status: 302,
            headers: { "content-type": "text/plain" },
          }),
      ),
    );

    const response = await service.get("/x", { throwOnError: false });
    expect(response.status).toBe(302);
    expect(response.data).toBe("moved");
    expect(response.redirected).toBe(false);
  });

  test("reports a caller abort distinctly from a timeout", async () => {
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const service = await createService(
      fakeFetch(
        (_request, init) =>
          new Promise<Response>((_resolve, reject) => {
            started();
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      ),
    );
    const controller = new AbortController();
    const pending = service.get("/x", { signal: controller.signal });
    await startedPromise;
    controller.abort();

    const error = await captureError(() => pending);
    expect(error.code).toBe("HTTP_CLIENT_FAILED");
    expect(error.message).toContain("aborted");
  });

  test("uses a validator's parsed value and reads empty and malformed bodies", async () => {
    const validator: StandardSchemaV1<unknown, unknown> = {
      "~standard": {
        version: 1,
        vendor: "aponia-test",
        validate: (value) => ({ value: { parsed: value } }),
      },
    };
    const bodies = [
      Response.json({ name: "Ada" }),
      new Response(null, { status: 204 }),
      new Response("{oops", { headers: { "content-type": "application/json" } }),
      new Response("plain", { headers: { "content-type": "text/plain" } }),
    ];
    const service = await createService(fakeFetch(() => bodies.shift() ?? Response.json({})));

    const validated = await service.get<{ parsed: { name: string } }>("/user", { validator });
    expect(validated.data).toEqual({ parsed: { name: "Ada" } });

    expect((await service.get("/empty")).data).toBeUndefined();
    expect((await service.get("/malformed")).data).toBe("{oops");
    expect((await service.get("/text")).data).toBe("plain");
  });

  test("honours numeric and date Retry-After values", async () => {
    const retryAfter = [new Date(Date.now() - 1_000).toUTCString(), "not-a-date"];
    let calls = 0;
    const service = await createService(
      fakeFetch(() => {
        calls += 1;
        if (calls % 2 === 1) {
          return new Response("wait", {
            status: 429,
            headers: { "retry-after": retryAfter.shift() ?? "0" },
          });
        }
        return Response.json({ ok: true });
      }),
      { retries: 1 },
    );

    expect((await service.get("/limited")).data).toEqual({ ok: true });
    expect((await service.get("/limited")).data).toEqual({ ok: true });
    expect(calls).toBe(4);
  });
});

function fakeFetch(
  handler: (request: Request, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    return await handler(request, init);
  }) as typeof fetch;
}

async function publicResolver(): Promise<readonly string[]> {
  return ["93.184.216.34"];
}
