import { expect, test } from "bun:test";
import { Elysia } from "elysia";
import { buildCompressionPlugin } from "../src/policy/compression-policy.ts";

test("skips HEAD, bodyless, pre-encoded, non-compressible, and small responses", async () => {
  const app = new Elysia()
    .use(buildCompressionPlugin({ thresholdBytes: 4, encodings: ["gzip"] }))
    .get("/text", () => "plain text")
    .get("/small", () => "abc")
    .get("/head", () => "head body")
    .get("/empty", () => new Response(null, { status: 204 }))
    .get("/encoded", () => new Response("encoded", { headers: { "content-encoding": "identity" } }))
    .get("/image", () => new Response("image", { headers: { "content-type": "image/png" } }))
    .get(
      "/bytes",
      () =>
        new Response(new Uint8Array([1, 2, 3, 4, 5]), {
          headers: { "content-type": "text/plain" },
        }),
    )
    .get(
      "/buffer",
      () =>
        new Response(new Uint8Array([5, 4, 3, 2, 1]).buffer, {
          headers: { "content-type": "text/plain" },
        }),
    )
    .get("/object", () => ({ value: "object body" }))
    .get("/status204", ({ set }) => {
      set.status = 204;
      return "body";
    })
    .get("/encoded-plain", ({ set }) => {
      set.headers["content-encoding"] = "identity";
      return "plain body";
    })
    .get("/binary-plain", ({ set }) => {
      set.headers["content-type"] = "application/octet-stream";
      return new Uint8Array([1, 2, 3, 4]);
    })
    .get("/arraybuffer-plain", ({ set }) => {
      set.headers["content-type"] = "text/plain";
      return new Uint8Array([4, 3, 2, 1]).buffer;
    })
    .get("/array-header", ({ set }) => {
      set.headers["content-type"] = ["text/plain", "charset=utf-8"] as never;
      return "array header body";
    })
    .get(
      "/response-plain",
      () => new Response("plain body", { headers: { "content-type": "text/plain" } }),
    )
    .get(
      "/response-small",
      () => new Response("abc", { headers: { "content-type": "text/plain" } }),
    )
    .get("/uint8-plain", ({ set }) => {
      set.headers["content-type"] = "text/plain";
      return new Uint8Array([1, 2, 3, 4, 5]);
    })
    .get("/number-plain", ({ set }) => {
      set.headers["content-type"] = "text/plain";
      return 42;
    })
    .get("/null", () => null);

  const request = (path: string, init?: RequestInit) =>
    app.handle(new Request(`http://localhost${path}`, init));

  expect(
    (await request("/text", { headers: { "accept-encoding": "gzip" } })).headers.get(
      "content-encoding",
    ),
  ).toBe("gzip");
  expect(
    (await request("/small", { headers: { "accept-encoding": "gzip" } })).headers.get(
      "content-encoding",
    ),
  ).toBeNull();
  expect(
    (
      await request("/head", { method: "HEAD", headers: { "accept-encoding": "gzip" } })
    ).headers.get("content-encoding"),
  ).toBeNull();
  expect((await request("/empty", { headers: { "accept-encoding": "gzip" } })).status).toBe(204);
  expect(
    (await request("/encoded", { headers: { "accept-encoding": "gzip" } })).headers.get(
      "content-encoding",
    ),
  ).toBe("identity");
  expect(
    (await request("/image", { headers: { "accept-encoding": "gzip" } })).headers.get(
      "content-encoding",
    ),
  ).toBeNull();
  expect(
    (await request("/bytes", { headers: { "accept-encoding": "gzip" } })).headers.get(
      "content-encoding",
    ),
  ).toBe("gzip");
  expect(
    (await request("/buffer", { headers: { "accept-encoding": "gzip" } })).headers.get(
      "content-encoding",
    ),
  ).toBe("gzip");
  expect(
    (await request("/object", { headers: { "accept-encoding": "gzip" } })).headers.get(
      "content-encoding",
    ),
  ).toBe("gzip");
  expect((await request("/status204", { headers: { "accept-encoding": "gzip" } })).status).toBe(
    204,
  );
  expect(
    (await request("/encoded-plain", { headers: { "accept-encoding": "gzip" } })).headers.get(
      "content-encoding",
    ),
  ).toBe("identity");
  expect(
    (await request("/binary-plain", { headers: { "accept-encoding": "gzip" } })).headers.get(
      "content-encoding",
    ),
  ).toBeNull();
  expect(
    (await request("/arraybuffer-plain", { headers: { "accept-encoding": "gzip" } })).headers.get(
      "content-encoding",
    ),
  ).toBe("gzip");
  expect(
    (await request("/array-header", { headers: { "accept-encoding": "gzip" } })).headers.get(
      "content-encoding",
    ),
  ).toBe("gzip");
  expect((await request("/null", { headers: { "accept-encoding": "gzip" } })).status).toBe(200);
  expect(
    (await request("/text", { headers: { "accept-encoding": "deflate" } })).headers.get(
      "content-encoding",
    ),
  ).toBeNull();
  expect(
    (await request("/response-plain", { headers: { "accept-encoding": "deflate" } })).headers.get(
      "content-encoding",
    ),
  ).toBeNull();
  expect(
    (await request("/response-small", { headers: { "accept-encoding": "gzip" } })).headers.get(
      "content-encoding",
    ),
  ).toBeNull();
  expect(
    (await request("/uint8-plain", { headers: { "accept-encoding": "gzip" } })).headers.get(
      "content-encoding",
    ),
  ).toBe("gzip");
  expect(
    (await request("/number-plain", { headers: { "accept-encoding": "gzip" } })).headers.get(
      "content-encoding",
    ),
  ).toBeNull();
  expect(
    (await request("/text", { headers: { "accept-encoding": ", gzip" } })).headers.get(
      "content-encoding",
    ),
  ).toBe("gzip");
  expect((await request("/text")).headers.get("content-encoding")).toBeNull();
});
