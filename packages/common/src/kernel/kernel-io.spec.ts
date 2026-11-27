import { describe, expect, test } from "bun:test";
import {
  HttpError,
  buildResponse,
  readBody,
  readCookies,
  readHeaders,
  readQuery,
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
});
