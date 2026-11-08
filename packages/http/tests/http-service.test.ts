import { afterEach, describe, expect, test } from "bun:test";
import { AponiaError, Module } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { z } from "zod";
import { HttpModule, HttpService } from "../src/index.ts";

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

describe("HttpService", () => {
  test("resolves a relative URL, appends query values, and parses JSON", async () => {
    let seen: Request | undefined;
    const fetch = fakeFetch((request) => {
      seen = request;
      return Response.json({ ok: true });
    });

    @Module({
      imports: [
        HttpModule.register({
          baseUrl: "https://api.example.com",
          headers: { "x-app": "test" },
          fetch,
          resolveAddresses: publicResolver,
        }),
      ],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const service = application.get(HttpService);
    const response = await service.get<{ ok: boolean }>("/users", {
      query: { page: 2, active: true, missing: undefined },
    });

    expect(seen?.url).toBe("https://api.example.com/users?page=2&active=true");
    expect(seen?.method).toBe("GET");
    expect(seen?.headers.get("x-app")).toBe("test");
    expect(response.status).toBe(200);
    expect(response.data).toEqual({ ok: true });
    expect(response.redirected).toBe(false);
  });

  test("sends a JSON body with its content type", async () => {
    let seen: Request | undefined;
    const fetch = fakeFetch((request) => {
      seen = request;
      return Response.json({ id: "1" });
    });

    @Module({
      imports: [
        HttpModule.register({
          baseUrl: "https://api.example.com",
          fetch,
          resolveAddresses: publicResolver,
        }),
      ],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const service = application.get(HttpService);
    await service.post("/users", { json: { name: "Ada" } });

    expect(seen?.method).toBe("POST");
    expect(seen?.headers.get("content-type")).toBe("application/json");
    expect(await seen?.text()).toBe('{"name":"Ada"}');
  });

  test("blocks loopback, private, metadata, protocol, and credential targets", async () => {
    const fetch = fakeFetch(() => Response.json({}));

    @Module({
      imports: [HttpModule.register({ fetch, resolveAddresses: privateResolver, retryDelayMs: 0 })],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const service = application.get(HttpService);

    for (const url of [
      "http://localhost/",
      "http://127.0.0.1/",
      "http://169.254.169.254/",
      "http://10.0.0.1/",
      "http://metadata.google.internal/",
      "file:///etc/passwd",
      "http://user:pass@example.com/",
    ]) {
      expect(await captureAponiaError(() => service.get(url))).toEqual(
        expect.objectContaining({ code: "HTTP_CLIENT_BLOCKED" }),
      );
    }
  });

  test("blocks a hostname that resolves to a private address", async () => {
    const fetch = fakeFetch(() => Response.json({}));

    @Module({
      imports: [
        HttpModule.register({
          baseUrl: "https://internal.example.com",
          fetch,
          resolveAddresses: privateResolver,
        }),
      ],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const service = application.get(HttpService);

    expect(await captureAponiaError(() => service.get("/"))).toEqual(
      expect.objectContaining({ code: "HTTP_CLIENT_BLOCKED" }),
    );
  });

  test("allows private networks only when the registration says so", async () => {
    const fetch = fakeFetch(() => Response.json({ ok: true }));

    @Module({
      imports: [
        HttpModule.register({
          baseUrl: "http://127.0.0.1:3000",
          fetch,
          resolveAddresses: privateResolver,
          allowPrivateNetworks: true,
        }),
      ],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const service = application.get(HttpService);

    expect((await service.get<{ ok: boolean }>("/health")).data).toEqual({ ok: true });
  });

  test("refuses a response larger than the configured bound", async () => {
    const fetch = fakeFetch(() => new Response("0123456789"));

    @Module({
      imports: [
        HttpModule.register({
          baseUrl: "https://api.example.com",
          fetch,
          resolveAddresses: publicResolver,
          maxResponseBytes: 5,
        }),
      ],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const service = application.get(HttpService);

    expect(await captureAponiaError(() => service.get("/large"))).toEqual(
      expect.objectContaining({ code: "HTTP_CLIENT_RESPONSE_TOO_LARGE" }),
    );
  });

  test("throws on an error status by default and can return it instead", async () => {
    const fetch = fakeFetch(() => new Response("missing", { status: 404 }));

    @Module({
      imports: [
        HttpModule.register({
          baseUrl: "https://api.example.com",
          fetch,
          resolveAddresses: publicResolver,
        }),
      ],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const service = application.get(HttpService);

    expect(await captureAponiaError(() => service.get("/missing"))).toEqual(
      expect.objectContaining({ code: "HTTP_CLIENT_FAILED" }),
    );
    expect((await service.get("/missing", { throwOnError: false })).status).toBe(404);
  });

  test("retries an idempotent method and never retries POST", async () => {
    let getCalls = 0;
    let postCalls = 0;
    const fetch = fakeFetch((request) => {
      if (request.method === "POST") {
        postCalls += 1;
        throw new Error("post failed");
      }
      getCalls += 1;
      if (getCalls === 1) {
        throw new Error("temporary");
      }
      return Response.json({ ok: true });
    });

    @Module({
      imports: [
        HttpModule.register({
          baseUrl: "https://api.example.com",
          fetch,
          resolveAddresses: publicResolver,
          retries: 2,
          retryDelayMs: 0,
        }),
      ],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const service = application.get(HttpService);

    expect((await service.get<{ ok: boolean }>("/retry")).data).toEqual({ ok: true });
    expect(getCalls).toBe(2);
    expect(await captureAponiaError(() => service.post("/retry"))).toEqual(
      expect.objectContaining({ code: "HTTP_CLIENT_FAILED" }),
    );
    expect(postCalls).toBe(1);
  });

  test("retries a POST only when it states an idempotency key", async () => {
    let calls = 0;
    const keys: (string | null)[] = [];
    const fetch = fakeFetch((request) => {
      calls += 1;
      keys.push(request.headers.get("idempotency-key"));
      if (calls === 1) {
        return Response.json({ retry: true }, { status: 503 });
      }
      return Response.json({ ok: true });
    });

    @Module({
      imports: [
        HttpModule.register({
          baseUrl: "https://api.example.com",
          fetch,
          resolveAddresses: publicResolver,
          retries: 2,
          retryDelayMs: 0,
        }),
      ],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const service = application.get(HttpService);
    const response = await service.post<{ ok: boolean }>("/orders", {
      json: { id: 1 },
      idempotencyKey: "order-1",
    });

    expect(response.data).toEqual({ ok: true });
    expect(keys).toEqual(["order-1", "order-1"]);
    expect(calls).toBe(2);
  });

  test("honours Retry-After and refuses an empty idempotency key", async () => {
    let calls = 0;
    const fetch = fakeFetch(() => {
      calls += 1;
      return calls === 1
        ? new Response(JSON.stringify({ wait: true }), {
            status: 429,
            headers: { "content-type": "application/json", "retry-after": "0" },
          })
        : Response.json({ ok: true });
    });

    @Module({
      imports: [
        HttpModule.register({
          baseUrl: "https://api.example.com",
          fetch,
          resolveAddresses: publicResolver,
          retries: 1,
          retryDelayMs: 5_000,
        }),
      ],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const service = application.get(HttpService);
    const started = performance.now();
    expect((await service.get<{ ok: boolean }>("/limited")).data).toEqual({ ok: true });
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(calls).toBe(2);

    expect(await captureAponiaError(() => service.get("/x", { idempotencyKey: " " }))).toEqual(
      expect.objectContaining({ code: "INVALID_HTTP_OPTIONS" }),
    );
  });

  test("follows a redirect, re-validates it, and reports the final URL", async () => {
    const fetch = fakeFetch((request) => {
      if (new URL(request.url).pathname === "/first") {
        return new Response(null, {
          status: 302,
          headers: { location: "/second" },
        });
      }
      return Response.json({ ok: true });
    });

    @Module({
      imports: [
        HttpModule.register({
          baseUrl: "https://api.example.com",
          fetch,
          resolveAddresses: publicResolver,
        }),
      ],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const service = application.get(HttpService);
    const response = await service.get<{ ok: boolean }>("/first");

    expect(response.redirected).toBe(true);
    expect(response.url).toBe("https://api.example.com/second");
    expect(response.data).toEqual({ ok: true });
  });

  test("refuses a redirect to a blocked address and an explicit error policy", async () => {
    const fetch = fakeFetch((request) => {
      if (new URL(request.url).pathname === "/redirect") {
        return new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest" },
        });
      }
      return new Response(null, { status: 302, headers: { location: "/next" } });
    });

    @Module({
      imports: [
        HttpModule.register({
          baseUrl: "https://api.example.com",
          fetch,
          resolveAddresses: publicResolver,
        }),
      ],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const service = application.get(HttpService);

    expect(await captureAponiaError(() => service.get("/redirect"))).toEqual(
      expect.objectContaining({ code: "HTTP_CLIENT_BLOCKED" }),
    );
    expect(await captureAponiaError(() => service.get("/first", { redirect: "error" }))).toEqual(
      expect.objectContaining({ code: "HTTP_CLIENT_FAILED" }),
    );
  });

  test("validates a response with a Standard Schema", async () => {
    const fetch = fakeFetch(() => Response.json({ name: 42 }));
    const schema = z.object({ name: z.string() });

    @Module({
      imports: [
        HttpModule.register({
          baseUrl: "https://api.example.com",
          fetch,
          resolveAddresses: publicResolver,
        }),
      ],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const service = application.get(HttpService);

    expect(await captureAponiaError(() => service.get("/user", { validator: schema }))).toEqual(
      expect.objectContaining({ code: "HTTP_CLIENT_INVALID_RESPONSE" }),
    );
  });

  test("times out a request", async () => {
    const fetch = fakeFetch(
      (_request, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );

    @Module({
      imports: [
        HttpModule.register({
          baseUrl: "https://api.example.com",
          fetch,
          resolveAddresses: publicResolver,
          timeoutMs: 5,
        }),
      ],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const service = application.get(HttpService);

    expect(await captureAponiaError(() => service.get("/slow"))).toEqual(
      expect.objectContaining({ code: "HTTP_CLIENT_TIMEOUT" }),
    );
  });

  test("reports every invalid registration option in one refusal", () => {
    const error = captureSyncAponiaError(() =>
      HttpModule.register({
        baseUrl: "ftp://example.com",
        timeoutMs: 0,
        retries: 9,
        retryDelayMs: -1,
        maxResponseBytes: 0,
        maxRedirects: 11,
      }),
    );

    expect(error.code).toBe("INVALID_HTTP_OPTIONS");
    expect(error.details).toEqual({
      issues: [
        "baseUrl must use http or https",
        "timeoutMs must be a positive integer",
        "retries must be an integer between 0 and 5",
        "retryDelayMs must be a non-negative integer",
        "maxResponseBytes must be a positive integer",
        "maxRedirects must be an integer between 0 and 10",
      ],
    });
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

async function privateResolver(): Promise<readonly string[]> {
  return ["10.0.0.1"];
}

async function captureAponiaError(run: () => Promise<unknown>): Promise<AponiaError> {
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

function captureSyncAponiaError(run: () => unknown): AponiaError {
  try {
    run();
  } catch (error) {
    if (error instanceof AponiaError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected an AponiaError.");
}
