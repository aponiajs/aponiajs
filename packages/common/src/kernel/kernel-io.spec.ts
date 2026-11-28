import { describe, expect, test } from "bun:test";
import {
  HttpError,
  buildResponse,
  createRequestPipeline,
  readBody,
  readCookies,
  readHeaders,
  readQuery,
  resolveApplicationHttpPolicies,
  slicePathname,
} from "../index.ts";
import type { ResponseSettingsState } from "../index.ts";

const settings = (status?: number | string, headers: ResponseSettingsState["headers"] = {}) => ({
  status,
  headers,
});

describe("readQuery", () => {
  test("keeps one value as a string and repeats as an array", () => {
    const query = readQuery(new URL("http://localhost/?a=1&a=2&a=3&b=x"));
    expect(query).toEqual({ a: ["1", "2", "3"], b: "x" });
  });

  test("reads a repeated name as an array in arrival order", () => {
    const query = readQuery(new URL("http://localhost/?a=1&a=2&b=x"));

    expect(query).toEqual({ a: ["1", "2"], b: "x" });
  });

  test("keeps prototype-named keys as own entries", () => {
    const query = readQuery(new URL("http://localhost/?constructor=x&__proto__=y"));

    expect(Object.getPrototypeOf(query)).toBeNull();
    expect(Object.hasOwn(query, "constructor")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(query, "constructor")?.value).toBe("x");
    expect(Object.hasOwn(query, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(query, "__proto__")?.value).toBe("y");
  });
});

describe("readHeaders", () => {
  test("states every field under its lower-case name", () => {
    const headers = readHeaders(
      new Request("http://localhost/", { headers: { "X-Trace": "abc" } }),
    );

    expect(headers["x-trace"]).toBe("abc");
  });
});

describe("readCookies", () => {
  test("reads named cookies and decodes their values", () => {
    const cookies = readCookies(
      new Request("http://localhost/", { headers: { cookie: "a=1; b=two%20words" } }),
    );

    expect(cookies["a"]).toEqual({ value: "1" });
    expect(cookies["b"]).toEqual({ value: "two words" });
  });

  test("answers nothing for no header, an empty header, and a pair with no name", () => {
    expect(readCookies(new Request("http://localhost/"))).toEqual({});
    expect(readCookies(new Request("http://localhost/", { headers: { cookie: "  " } }))).toEqual(
      {},
    );
    expect(
      readCookies(new Request("http://localhost/", { headers: { cookie: "novalue; ok=1" } })),
    ).toEqual({ ok: { value: "1" } });
    expect(
      readCookies(new Request("http://localhost/", { headers: { cookie: "=value; ok=1" } })),
    ).toEqual({ ok: { value: "1" } });
  });

  test("keeps a malformed escape as it arrived", () => {
    const cookies = readCookies(
      new Request("http://localhost/", { headers: { cookie: "bad=%E0%A4%A" } }),
    );

    expect(cookies["bad"]?.value).toBe("%E0%A4%A");
  });
});

describe("readBody", () => {
  test("reads a JSON object", async () => {
    const body = await readBody(
      new Request("http://localhost/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ a: 1 }),
      }),
    );

    expect(body).toEqual({ a: 1 });
  });

  test("answers undefined for an empty JSON body", async () => {
    expect(
      await readBody(
        new Request("http://localhost/", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "  ",
        }),
      ),
    ).toBeUndefined();
  });

  test("refuses malformed JSON with a 400 problem code", async () => {
    try {
      await readBody(
        new Request("http://localhost/", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{",
        }),
      );
      throw new Error("Expected the body to be refused.");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).code).toBe("INVALID_REQUEST_BODY");
    }
  });

  test("reads a form body into a record", async () => {
    const body = await readBody(
      new Request("http://localhost/", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "a=1&b=2",
      }),
    );

    expect(body).toEqual({ a: "1", b: "2" });
  });

  test("reads a text body and leaves an unknown content type unread", async () => {
    expect(
      await readBody(
        new Request("http://localhost/", {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: "hello",
        }),
      ),
    ).toBe("hello");

    expect(
      await readBody(
        new Request("http://localhost/", {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: "bytes",
        }),
      ),
    ).toBeUndefined();
  });

  test("has no body on a GET and refuses a declared oversized one", async () => {
    expect(await readBody(new Request("http://localhost/"))).toBeUndefined();

    try {
      await readBody(
        new Request("http://localhost/", {
          method: "POST",
          headers: { "content-type": "application/json", "content-length": "100" },
          body: JSON.stringify({ a: 1 }),
        }),
        10,
      );
      throw new Error("Expected the body to be refused.");
    } catch (error) {
      expect((error as HttpError).code).toBe("PAYLOAD_TOO_LARGE");
    }
  });

  test("refuses a text body over the bound when no length was declared", async () => {
    try {
      await readBody(
        new Request("http://localhost/", {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: "0123456789",
        }),
        5,
      );
      throw new Error("Expected the body to be refused.");
    } catch (error) {
      expect((error as HttpError).code).toBe("PAYLOAD_TOO_LARGE");
    }
  });

  test("refuses a multipart body over the bound", async () => {
    const form = new FormData();
    form.set("file", new Blob(["0123456789"], { type: "text/plain" }), "file.txt");
    try {
      await readBody(
        new Request("http://localhost/", {
          method: "POST",
          body: form,
        }),
        10,
      );
      throw new Error("Expected the body to be refused.");
    } catch (error) {
      expect((error as HttpError).code).toBe("PAYLOAD_TOO_LARGE");
    }
  });

  test("reads one multipart field and a repeated one as an array", async () => {
    const form = new FormData();
    form.set("name", "ada");
    form.append("tag", "one");
    form.append("tag", "two");

    expect(
      await readBody(
        new Request("http://localhost/", {
          method: "POST",
          body: form,
        }),
      ),
    ).toEqual({ name: "ada", tag: ["one", "two"] });
  });
});

describe("buildResponse", () => {
  test("sends a handler's own Response unchanged", () => {
    const own = new Response("own", { status: 204 });
    expect(buildResponse(own, settings(), "GET")).toBe(own);
  });

  test("answers an empty body with the declared status", () => {
    const response = buildResponse(null, settings(204), "GET");
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });

  test("resolves a status name", () => {
    expect(buildResponse("x", settings("Not Found"), "GET").status).toBe(404);
    expect(buildResponse("x", settings("Not A Status"), "GET").status).toBe(200);
  });

  test("sends a string as text when no type was set", async () => {
    const response = buildResponse("hello", settings(), "GET");
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe("hello");
  });

  test("sends bytes and a stream as they are", async () => {
    const bytes = buildResponse(new Uint8Array([1, 2]), settings(), "GET");
    expect(await bytes.arrayBuffer()).toHaveLength(2);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("streamed"));
        controller.close();
      },
    });
    expect(await buildResponse(stream, settings(), "GET").text()).toBe("streamed");
  });

  test("sends any other value as JSON and omits the body on HEAD", async () => {
    const response = buildResponse({ a: 1 }, settings(), "GET");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ a: 1 });

    expect(buildResponse({ a: 1 }, settings(), "HEAD").body).toBeNull();
  });

  test("writes repeated header values and skips an undefined one", () => {
    const response = buildResponse(
      "x",
      settings(200, { "x-multi": ["a", "b"], "x-skip": undefined, "x-one": 1 }),
      "GET",
    );

    expect(response.headers.get("x-multi")).toBe("a, b");
    expect(response.headers.get("x-skip")).toBeNull();
    expect(response.headers.get("x-one")).toBe("1");
  });

  test("readBody handles multi-chunk text streams and rejects oversized streams", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(encoder.encode("hello "));
        ctrl.enqueue(encoder.encode("world"));
        ctrl.close();
      },
    });
    const chunkedReq = new Request("http://localhost/chunked", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: stream,
    });
    expect(await readBody(chunkedReq, 1024)).toBe("hello world");

    const tooLargeStream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(encoder.encode("123456"));
        ctrl.enqueue(encoder.encode("7890"));
        ctrl.close();
      },
    });
    const largeReq = new Request("http://localhost/large", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: tooLargeStream,
    });
    let rejected = false;
    try {
      await readBody(largeReq, 5);
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  test("createRequestPipeline applies sync cors and securityHeaders policies", async () => {
    const policies = resolveApplicationHttpPolicies({
      cors: { origin: "https://app.example", credentials: true },
      securityHeaders: true,
    });
    const pipeline = createRequestPipeline({ policies })!;
    const req = new Request("http://localhost/api", {
      headers: { origin: "https://app.example" },
    });
    const res = await pipeline(req, () => new Response("ok"));
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.example");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");

    // Immutable response headers trigger clone fallback in withHeaders.
    const redirectRes = await pipeline(req, () => {
      const immutableRes = new Response("ok");
      Object.defineProperty(immutableRes.headers, "set", {
        value: () => {
          throw new TypeError("immutable");
        },
      });
      return immutableRes;
    });
    expect(redirectRes.status).toBe(200);
    expect(redirectRes.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("slicePathname and readBody handle no-slash URL, null/empty stream, and 2nd-chunk overflow", async () => {
    expect(slicePathname("http://localhost")).toBe("/");
    expect(
      await readBody(new Request("http://localhost/null", { method: "POST" }), 100),
    ).toBeUndefined();
    const emptyStream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.close();
      },
    });
    expect(
      await readBody(
        new Request("http://localhost/empty-stream", {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: emptyStream,
        }),
        100,
      ),
    ).toBe("");

    const encoder = new TextEncoder();
    const twoChunkOverflow = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(encoder.encode("aa"));
        ctrl.enqueue(encoder.encode("bbbbbb"));
        ctrl.close();
      },
    });
    let twoRejected = false;
    try {
      await readBody(
        new Request("http://localhost/2chunks", {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: twoChunkOverflow,
        }),
        5,
      );
    } catch {
      twoRejected = true;
    }
    expect(twoRejected).toBe(true);
  });

  test("readBody uses content-length fast path and rejects 3-chunk or multi-byte overflow", async () => {
    const fastReq = new Request("http://localhost/fast-text", {
      method: "POST",
      headers: { "content-type": "text/plain", "content-length": "5" },
      body: "hello",
    });
    expect(await readBody(fastReq, 10)).toBe("hello");

    // Multi-byte UTF-8 where declared content-length <= max but actual bytes > max
    const utf8OverflowReq = new Request("http://localhost/utf8", {
      method: "POST",
      headers: { "content-type": "text/plain", "content-length": "4" },
      body: "ééé",
    });
    let utf8Rejected = false;
    try {
      await readBody(utf8OverflowReq, 4);
    } catch {
      utf8Rejected = true;
    }
    expect(utf8Rejected).toBe(true);

    // 3-chunk stream overflowing on 3rd chunk
    const encoder = new TextEncoder();
    const threeChunkStream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(encoder.encode("aa"));
        ctrl.enqueue(encoder.encode("bb"));
        ctrl.enqueue(encoder.encode("cccccc"));
        ctrl.close();
      },
    });
    let thirdRejected = false;
    try {
      await readBody(
        new Request("http://localhost/3chunks", {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: threeChunkStream,
        }),
        5,
      );
    } catch {
      thirdRejected = true;
    }
    expect(thirdRejected).toBe(true);
  });
});
