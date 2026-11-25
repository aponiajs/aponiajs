import { expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { buildCompressionPolicy } from "../policy/compression.policy.ts";

const policy = buildCompressionPolicy({ thresholdBytes: 4, encodings: ["gzip"] });

function request(path = "/text", init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, init);
}

function response(body: string, init?: { readonly headers?: Record<string, string> }): Response {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "text/plain; charset=utf-8");
  return new Response(body, { headers });
}

async function apply(base: Response, init?: RequestInit, path?: string): Promise<Response> {
  return await policy.onResponse!(request(path, init), base);
}

test("compresses a compressible body above the threshold", async () => {
  const compressed = await apply(response("plain text"), {
    headers: { "accept-encoding": "gzip" },
  });
  expect(compressed.headers.get("content-encoding")).toBe("gzip");
  expect(compressed.headers.get("content-length")).not.toBeNull();
  const body = new Uint8Array(await compressed.arrayBuffer());
  expect(new TextDecoder().decode(gunzipSync(body))).toBe("plain text");
});

test("leaves a body below the threshold alone", async () => {
  const small = await apply(response("abc"), { headers: { "accept-encoding": "gzip" } });
  expect(small.headers.get("content-encoding")).toBeNull();
});

test("leaves a declared length below the threshold alone", async () => {
  const small = await apply(
    new Response("abcd", {
      headers: { "content-type": "text/plain", "content-length": "3" },
    }),
    { headers: { "accept-encoding": "gzip" } },
  );
  expect(small.headers.get("content-encoding")).toBeNull();
});

test("skips HEAD requests", async () => {
  const head = await apply(response("plain text"), {
    method: "HEAD",
    headers: { "accept-encoding": "gzip" },
  });
  expect(head.headers.get("content-encoding")).toBeNull();
});

test("skips bodyless and bodyless-status responses", async () => {
  for (const status of [204, 206, 304]) {
    const bodyless = await apply(new Response(null, { status }), {
      headers: { "accept-encoding": "gzip" },
    });
    expect(bodyless.headers.get("content-encoding")).toBeNull();
  }
});

test("skips an already encoded response", async () => {
  const encoded = await apply(
    new Response("encoded", { headers: { "content-encoding": "identity" } }),
    { headers: { "accept-encoding": "gzip" } },
  );
  expect(encoded.headers.get("content-encoding")).toBe("identity");
});

test("skips a non-compressible content type", async () => {
  const image = await apply(new Response("image", { headers: { "content-type": "image/png" } }), {
    headers: { "accept-encoding": "gzip" },
  });
  expect(image.headers.get("content-encoding")).toBeNull();
});

test("skips an event stream", async () => {
  const stream = await apply(
    new Response("data: one\n\n", { headers: { "content-type": "text/event-stream" } }),
    { headers: { "accept-encoding": "gzip" } },
  );
  expect(stream.headers.get("content-encoding")).toBeNull();
});

test("skips when the client does not accept the encoding", async () => {
  const deflate = await apply(response("plain text"), {
    headers: { "accept-encoding": "deflate" },
  });
  expect(deflate.headers.get("content-encoding")).toBeNull();
  const none = await apply(response("plain text"));
  expect(none.headers.get("content-encoding")).toBeNull();
});

test("appends accept-encoding to an existing Vary value", async () => {
  const vari = await apply(response("plain text", { headers: { vary: "origin" } }), {
    headers: { "accept-encoding": "gzip" },
  });
  expect(vari.headers.get("vary")).toBe("origin, accept-encoding");
});
