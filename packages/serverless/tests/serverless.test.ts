import { describe, expect, test } from "bun:test";
import { Body, Controller, Get, Module, Post, Query } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { createLambdaHandler, toFetchHandler, type ServerlessApplication } from "../src/index.ts";

function echoApplication(): ServerlessApplication {
  return {
    handle: async (request) =>
      new Response(
        JSON.stringify({
          url: request.url,
          method: request.method,
          body: await request.text(),
          cookie: request.headers.get("cookie"),
          multi: request.headers.get("x-multi"),
        }),
        { headers: { "content-type": "application/json" } },
      ),
  };
}

describe("serverless adapters", () => {
  test("binds a Web Fetch handler", async () => {
    const handler = toFetchHandler({
      handle: () => new Response("ok", { status: 201 }),
    });
    const response = await handler(new Request("https://example.test/"));
    expect(response.status).toBe(201);
    expect(await response.text()).toBe("ok");

    const failing = toFetchHandler({
      handle: () => {
        throw new Error("boom");
      },
    });
    const rejection = await failing(new Request("https://example.test/")).catch(
      (error: unknown) => error,
    );
    expect(rejection).toMatchObject({ message: "boom" });
  });

  test("reads a payload 2.0 event into a request", async () => {
    const handler = createLambdaHandler(echoApplication());
    const result = await handler({
      version: "2.0",
      rawPath: "/users",
      rawQueryString: "page=2&tag=a&tag=b",
      cookies: ["a=1", "b=2"],
      headers: { host: "api.test", "x-multi": "one" },
      requestContext: { http: { method: "get" } },
    });

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({
      url: "https://api.test/users?page=2&tag=a&tag=b",
      method: "GET",
      body: "",
      cookie: "a=1; b=2",
      multi: "one",
    });
    expect(result.isBase64Encoded).toBe(false);
  });

  test("decodes a base64 request body and ignores a GET body", async () => {
    const handler = createLambdaHandler(echoApplication());
    const posted = await handler({
      version: "2.0",
      rawPath: "/users",
      headers: { host: "api.test" },
      requestContext: { http: { method: "POST" } },
      body: Buffer.from('{"name":"ada"}').toString("base64"),
      isBase64Encoded: true,
    });
    expect(JSON.parse(posted.body).body).toBe('{"name":"ada"}');

    const read = await handler({
      version: "2.0",
      rawPath: "/users",
      headers: { host: "api.test" },
      requestContext: { http: { method: "GET" } },
      body: "ignored",
    });
    expect(JSON.parse(read.body).body).toBe("");
  });

  test("sends a textual body as text and a binary body as base64", async () => {
    const handler = createLambdaHandler({
      handle: (request) =>
        request.url.endsWith("/binary")
          ? new Response(new Uint8Array([0xff, 0x00, 0x01]), {
              headers: { "content-type": "application/octet-stream" },
            })
          : request.url.endsWith("/broken")
            ? new Response(new Uint8Array([0xff, 0xfe]), {
                headers: { "content-type": "text/plain" },
              })
            : new Response("plain", { headers: { "content-type": "text/plain; charset=utf-8" } }),
    });

    const text = await handler({
      version: "2.0",
      rawPath: "/text",
      requestContext: { http: { method: "GET" } },
    });
    expect(text).toMatchObject({ body: "plain", isBase64Encoded: false });

    const binary = await handler({
      version: "2.0",
      rawPath: "/binary",
      requestContext: { http: { method: "GET" } },
    });
    expect(binary.isBase64Encoded).toBe(true);
    expect([...Buffer.from(binary.body, "base64")]).toEqual([0xff, 0x00, 0x01]);

    const broken = await handler({
      version: "2.0",
      rawPath: "/broken",
      requestContext: { http: { method: "GET" } },
    });
    expect(broken.isBase64Encoded).toBe(true);
  });

  test("moves set-cookie into the payload 2.0 cookies array", async () => {
    const handler = createLambdaHandler({
      handle: () => {
        const response = new Response(null, { status: 204 });
        response.headers.append("set-cookie", "a=1; Path=/");
        response.headers.append("set-cookie", "b=2; Path=/");
        return response;
      },
    });
    const result = await handler({
      version: "2.0",
      rawPath: "/",
      requestContext: { http: { method: "GET" } },
    });

    expect(result.body).toBe("");
    expect(result.isBase64Encoded).toBe(false);
    expect("cookies" in result ? result.cookies : undefined).toEqual([
      "a=1; Path=/",
      "b=2; Path=/",
    ]);
    expect(Object.keys(result.headers)).not.toContain("set-cookie");
  });

  test("reads a payload 1.0 event with multi-value headers and query", async () => {
    const handler = createLambdaHandler(echoApplication());
    const result = await handler({
      httpMethod: "POST",
      path: "/users",
      multiValueHeaders: { Host: ["api.test"], "x-multi": ["one", "two"] },
      multiValueQueryStringParameters: { tag: ["a", "b"] },
      body: "payload",
    });

    expect(JSON.parse(result.body)).toMatchObject({
      url: "https://api.test/users?tag=a&tag=b",
      method: "POST",
      body: "payload",
      multi: "one, two",
    });
    expect(result.statusCode).toBe(200);
  });

  test("falls back to single-value query and header fields in payload 1.0", async () => {
    const handler = createLambdaHandler(echoApplication());
    const result = await handler({
      httpMethod: "GET",
      path: "/users",
      headers: { Host: "api.test" },
      queryStringParameters: { q: "ada" },
    });
    expect(JSON.parse(result.body).url).toBe("https://api.test/users?q=ada");
  });

  test("moves set-cookie into payload 1.0 multiValueHeaders", async () => {
    const handler = createLambdaHandler({
      handle: () => {
        const response = new Response("ok");
        response.headers.append("set-cookie", "a=1");
        return response;
      },
    });
    const result = await handler({ httpMethod: "GET", path: "/" });
    expect((result as { multiValueHeaders?: Record<string, string[]> }).multiValueHeaders).toEqual({
      "set-cookie": ["a=1"],
    });
  });

  test("answers through a real Aponia application", async () => {
    @Controller("hello")
    class HelloController {
      @Get()
      read(@Query("name") name: string): string {
        return `hello ${name}`;
      }

      @Post()
      create(@Body() body: { readonly name: string }): string {
        return `created ${body.name}`;
      }
    }

    @Module({ controllers: [HelloController] })
    class HelloModule {}

    const application = await AponiaFactory.create(HelloModule, { logger: false });
    try {
      const handler = createLambdaHandler(application);
      const read = await handler({
        version: "2.0",
        rawPath: "/hello",
        rawQueryString: "name=ada",
        headers: { host: "api.test" },
        requestContext: { http: { method: "GET" } },
      });
      expect(read).toMatchObject({ statusCode: 200, body: "hello ada" });

      const create = await handler({
        version: "2.0",
        rawPath: "/hello",
        headers: { host: "api.test", "content-type": "application/json" },
        requestContext: { http: { method: "POST" } },
        body: JSON.stringify({ name: "grace" }),
      });
      expect(create).toMatchObject({ statusCode: 200, body: "created grace" });
    } finally {
      await application.close();
    }
  });
});
