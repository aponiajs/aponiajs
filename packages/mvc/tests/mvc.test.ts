import { describe, expect, test } from "bun:test";
import {
  createNextHandler,
  createNuxtHandler,
  createAngularHandler,
  toExpressHandler,
  toFastifyHandler,
} from "../src/index.ts";

describe("Framework SSR adapters", () => {
  test("createNextHandler bridges Next.js server with fallback on throw", async () => {
    const handler = createNextHandler({
      getRequestHandler: () => async (_req, res: any) => {
        res.body = "<div>Next SSR Content</div>";
      },
    });

    const res = await handler(new Request("http://localhost/next"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<div>Next SSR Content</div>");
    expect(res.headers.get("Content-Type")).toContain("text/html");

    // Test error handler catch
    const throwingHandler = createNextHandler({
      getRequestHandler: () => async () => {
        throw new Error("Next build error");
      },
    });
    const errorRes = await throwingHandler(new Request("http://localhost/next-err"));
    expect(errorRes.status).toBe(200);
    expect(await errorRes.text()).toBe("Rendered by Next.js");
  });

  test("createNuxtHandler bridges Nuxt 3 renderer", async () => {
    const handler = createNuxtHandler({
      render: async () =>
        new Response("<div>Nuxt Nitro Content</div>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
    });

    const res = await handler(new Request("http://localhost/nuxt"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<div>Nuxt Nitro Content</div>");
  });

  test("createAngularHandler bridges Angular CommonEngine with custom options", async () => {
    const handler = createAngularHandler(
      {
        render: async (opts) => `<app-root>Angular on ${opts.url}</app-root>`,
      },
      { document: "<html><app-root></app-root></html>" },
    );

    const res = await handler(new Request("http://localhost/angular"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Angular on http://localhost/angular");
  });
});

describe("Legacy HTTP platform adapters", () => {
  test("toExpressHandler delegates GET and POST to Aponia application and handles errors", async () => {
    const fakeApp = {
      handle: async (req: Request) =>
        new Response(`Handled ${new URL(req.url).pathname} ${req.method}`, {
          status: 200,
          headers: { "X-Custom": "val" },
        }),
    };

    const middleware = toExpressHandler(fakeApp as any);

    let statusCode = 0;
    let headers: Record<string, string> = {};
    let sentBody = "";

    const reqPost = {
      url: "/users",
      method: "POST",
      headers: { host: "localhost" },
      rawBody: JSON.stringify({ name: "Bob" }),
    };
    const res = {
      status: (code: number) => {
        statusCode = code;
      },
      set: (h: Record<string, string>) => {
        headers = h;
      },
      send: (body: string) => {
        sentBody = body;
      },
    };

    await middleware(reqPost, res);
    expect(statusCode).toBe(200);
    expect(headers["x-custom"]).toBe("val");
    expect(sentBody).toBe("Handled /users POST");

    // Test error branch
    let caughtError: unknown;
    const errorApp = {
      handle: async () => {
        throw new Error("Handle failed");
      },
    };
    const errorMiddleware = toExpressHandler(errorApp as any);
    await errorMiddleware(reqPost, res, (err) => {
      caughtError = err;
    });
    expect(caughtError).toBeDefined();
  });

  test("toFastifyHandler delegates to Aponia application", async () => {
    const fakeApp = {
      handle: async (req: Request) =>
        new Response(`Fastify ${new URL(req.url).pathname}`, {
          status: 200,
          headers: { "X-Fastify": "1" },
        }),
    };

    const handler = toFastifyHandler(fakeApp as any);

    let statusCode = 0;
    let headers: Record<string, string> = {};
    let sentBody = "";

    const req = {
      url: "/orders",
      method: "POST",
      headers: { host: "localhost" },
      body: { item: "book" },
    };
    const reply = {
      status: (code: number) => {
        statusCode = code;
      },
      headers: (h: Record<string, string>) => {
        headers = h;
      },
      send: (body: string) => {
        sentBody = body;
      },
    };

    await handler(req, reply);
    expect(statusCode).toBe(200);
    expect(headers["x-fastify"]).toBe("1");
    expect(sentBody).toBe("Fastify /orders");
  });
});
