import { describe, expect, test } from "bun:test";
import { applyHttpPolicies, corsPreflight, resolveApplicationHttpPolicies } from "../index.ts";

function resolved(options: Parameters<typeof resolveApplicationHttpPolicies>[0]) {
  const policies = resolveApplicationHttpPolicies(options);
  if (policies === undefined) {
    throw new Error("expected resolved policies");
  }
  return policies;
}

describe("http policies", () => {
  test("resolves nothing when the application states none", () => {
    expect(resolveApplicationHttpPolicies({})).toBeUndefined();
    expect(
      resolveApplicationHttpPolicies({
        cors: false,
        securityHeaders: false,
        etag: false,
        compression: false,
      }),
    ).toBeUndefined();
  });

  test("refuses an invalid declaration", () => {
    for (const invalid of [
      { cors: { maxAge: -1 } },
      { compression: { threshold: -1 } },
      { cors: { methods: [1] } },
    ]) {
      expect(() => resolveApplicationHttpPolicies(invalid as never)).toThrow(
        expect.objectContaining({ code: "INVALID_CONFIGURATION_VALUE" }),
      );
    }
  });

  test("answers an allowed preflight and withholds an unlisted origin", () => {
    const policies = resolved({ cors: { origin: "https://app.test", maxAge: 60 } });
    const allowed = corsPreflight(
      new Request("http://localhost/users", {
        method: "OPTIONS",
        headers: {
          origin: "https://app.test",
          "access-control-request-method": "GET",
          "access-control-request-headers": "authorization",
        },
      }),
      policies,
    );
    expect(allowed?.status).toBe(204);
    expect(allowed?.headers.get("access-control-allow-origin")).toBe("https://app.test");
    expect(allowed?.headers.get("access-control-allow-methods")).toContain("GET");
    expect(allowed?.headers.get("access-control-allow-headers")).toBe("authorization");
    expect(allowed?.headers.get("access-control-max-age")).toBe("60");

    const denied = corsPreflight(
      new Request("http://localhost/users", {
        method: "OPTIONS",
        headers: {
          origin: "https://evil.test",
          "access-control-request-method": "GET",
        },
      }),
      policies,
    );
    expect(denied?.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("declines a request that is not a preflight", () => {
    const policies = resolved({ cors: true });
    expect(corsPreflight(new Request("http://localhost/users"), policies)).toBeUndefined();
  });

  test("applies security headers without replacing an application header", async () => {
    const policies = resolved({ securityHeaders: true });
    const response = await applyHttpPolicies(
      new Request("http://localhost/"),
      new Response("ok", { headers: { "x-frame-options": "DENY" } }),
      policies,
    );

    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  test("reads a predicate origin and marks the response as credentialed", async () => {
    const policies = resolved({
      cors: { origin: (origin) => origin, credentials: true },
    });
    const response = await applyHttpPolicies(
      new Request("http://localhost/", { headers: { origin: "https://app.test" } }),
      new Response("ok"),
      policies,
    );

    expect(response.headers.get("access-control-allow-origin")).toBe("https://app.test");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("vary")).toContain("origin");
  });

  test("emits a weak tag and answers a matching if-none-match with 304", async () => {
    const policies = resolved({ etag: true });
    const first = await applyHttpPolicies(
      new Request("http://localhost/"),
      new Response("payload"),
      policies,
    );
    const tag = first.headers.get("etag");
    expect(tag).toMatch(/^W\/"[0-9a-f]{40}"$/);

    const second = await applyHttpPolicies(
      new Request("http://localhost/", { headers: { "if-none-match": tag ?? "" } }),
      new Response("payload"),
      policies,
    );
    expect(second.status).toBe(304);
  });

  test("compresses a large accepted body and leaves a small one alone", async () => {
    const policies = resolved({ compression: { threshold: 10 } });
    const big = await applyHttpPolicies(
      new Request("http://localhost/", { headers: { "accept-encoding": "gzip" } }),
      new Response("x".repeat(1_024), { headers: { "content-type": "text/plain" } }),
      policies,
    );
    expect(big.headers.get("content-encoding")).toBe("gzip");
    expect(big.headers.get("vary")).toContain("accept-encoding");
    const decoded = await new Response(
      big.body?.pipeThrough(new DecompressionStream("gzip")),
    ).text();
    expect(decoded).toBe("x".repeat(1_024));

    const small = await applyHttpPolicies(
      new Request("http://localhost/", { headers: { "accept-encoding": "gzip" } }),
      new Response("ok", {
        headers: { "content-type": "text/plain", "content-length": "2" },
      }),
      policies,
    );
    expect(small.headers.get("content-encoding")).toBeNull();
  });

  test("leaves an incompressible or already-encoded body alone", async () => {
    const policies = resolved({ compression: true });
    for (const [contentType, encoding] of [
      ["image/png", undefined],
      ["text/plain", "br"],
    ] as const) {
      const response = await applyHttpPolicies(
        new Request("http://localhost/", { headers: { "accept-encoding": "gzip" } }),
        new Response("x".repeat(2_048), {
          headers: {
            "content-type": contentType,
            ...(encoding === undefined ? {} : { "content-encoding": encoding }),
          },
        }),
        policies,
      );
      expect(response.headers.get("content-encoding")).toBe(encoding ?? null);
    }
  });
});

describe("http policy branches", () => {
  test("resolves a custom security header set and drops a disabled one", async () => {
    const policies = resolved({
      securityHeaders: {
        contentSecurityPolicy: "default-src 'none'",
        xFrameOptions: false,
        xContentTypeOptions: false,
        referrerPolicy: "same-origin",
      },
    });
    const response = await applyHttpPolicies(
      new Request("http://localhost/"),
      new Response("ok"),
      policies,
    );

    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(response.headers.get("referrer-policy")).toBe("same-origin");
    expect(response.headers.get("x-frame-options")).toBeNull();
    expect(response.headers.get("x-content-type-options")).toBeNull();
  });

  test("matches an array origin and exposes the declared headers", async () => {
    const policies = resolved({
      cors: { origin: ["https://one.test", "https://two.test"], exposedHeaders: ["x-total"] },
    });
    const allowed = await applyHttpPolicies(
      new Request("http://localhost/", { headers: { origin: "https://two.test" } }),
      new Response("ok"),
      policies,
    );
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://two.test");
    expect(allowed.headers.get("access-control-expose-headers")).toBe("x-total");

    const other = await applyHttpPolicies(
      new Request("http://localhost/", { headers: { origin: "https://three.test" } }),
      new Response("ok"),
      policies,
    );
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("refuses a wildcard origin with credentials", () => {
    expect(() =>
      resolveApplicationHttpPolicies({ cors: { origin: "*", credentials: true } }),
    ).toThrow(expect.objectContaining({ code: "INVALID_CONFIGURATION_VALUE" }));
  });

  test("leaves an event stream without an entity tag", async () => {
    const policies = resolved({ etag: true });
    const response = await applyHttpPolicies(
      new Request("http://localhost/events"),
      new Response("data: tick\n\n", { headers: { "content-type": "text/event-stream" } }),
      policies,
    );

    expect(response.headers.get("etag")).toBeNull();
  });

  test("refuses a malformed origin and header list", () => {
    expect(() => resolveApplicationHttpPolicies({ cors: { origin: [1] as never } })).toThrow(
      expect.objectContaining({ code: "INVALID_CONFIGURATION_VALUE" }),
    );
    expect(() =>
      resolveApplicationHttpPolicies({ cors: { allowedHeaders: [1] as never } }),
    ).toThrow(expect.objectContaining({ code: "INVALID_CONFIGURATION_VALUE" }));
  });

  test("emits a strong tag when the weak option is off and skips a different tag", async () => {
    const policies = resolved({ etag: { weak: false } });
    const first = await applyHttpPolicies(
      new Request("http://localhost/"),
      new Response("payload"),
      policies,
    );
    expect(first.headers.get("etag")).toMatch(/^"[0-9a-f]{40}"$/);

    const other = await applyHttpPolicies(
      new Request("http://localhost/", { headers: { "if-none-match": '"other"' } }),
      new Response("payload"),
      policies,
    );
    expect(other.status).toBe(200);
  });

  test("leaves a response that already carries an entity tag alone", async () => {
    const policies = resolved({ etag: true });
    const response = await applyHttpPolicies(
      new Request("http://localhost/"),
      new Response("payload", { headers: { etag: '"given"' } }),
      policies,
    );
    expect(response.headers.get("etag")).toBe('"given"');
  });

  test("keeps an existing vary value when compression adds one", async () => {
    const policies = resolved({ compression: true });
    const response = await applyHttpPolicies(
      new Request("http://localhost/", { headers: { "accept-encoding": "gzip" } }),
      new Response("x".repeat(2_048), {
        headers: { "content-type": "text/plain", vary: "accept-encoding" },
      }),
      policies,
    );
    expect(response.headers.get("vary")).toBe("accept-encoding");
  });

  test("leaves a body with no content type uncompressed", async () => {
    const policies = resolved({ compression: true });
    const response = await applyHttpPolicies(
      new Request("http://localhost/", { headers: { "accept-encoding": "gzip" } }),
      new Response("x".repeat(2_048)),
      policies,
    );
    expect(response.headers.get("content-encoding")).toBeNull();
  });

  test("falls back to cloning immutable response headers and skips 1xx statuses", async () => {
    const policies = resolved({ securityHeaders: true });
    const redirect = await applyHttpPolicies(
      new Request("http://localhost/"),
      Response.redirect("https://example.com/next", 302),
      policies,
    );
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("x-content-type-options")).toBe("nosniff");

    const upgrade = { status: 101, headers: new Headers() } as Response;
    expect(await applyHttpPolicies(new Request("http://localhost/"), upgrade, policies)).toBe(
      upgrade,
    );
  });
});
