import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createApplication } from "./application.ts";

const endpoint = "http://localhost:3200";

let savedToken: string | undefined;

beforeAll(() => {
  savedToken = process.env.MCP_TOKEN;
  delete process.env.MCP_TOKEN;
});

afterAll(() => {
  if (savedToken === undefined) {
    delete process.env.MCP_TOKEN;
  } else {
    process.env.MCP_TOKEN = savedToken;
  }
});

function initializeBody(): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "example-client", version: "1.0.0" },
    },
  };
}

function post(
  body: unknown,
  options: { readonly path?: string; readonly token?: string; readonly origin?: string } = {},
): Request {
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  });

  if (options.token !== undefined) {
    headers.set("authorization", `Bearer ${options.token}`);
  }
  if (options.origin !== undefined) {
    headers.set("origin", options.origin);
  }

  return new Request(`${endpoint}${options.path ?? "/mcp"}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers,
  });
}

describe("mcp example", () => {
  test("refuses a request without the bearer token", async () => {
    const application = await createApplication();

    const response = await application.handle(post(initializeBody()));

    expect(response.status).toBe(401);
    await application.close();
  });

  test("serves the handshake and a tool call with the bearer token", async () => {
    const application = await createApplication();
    const token = "aponia-example-token";

    const initialized = await application.handle(post(initializeBody(), { token }));
    expect(initialized.status).toBe(200);
    const initializedPayload = (await initialized.json()) as {
      result: { serverInfo: { name: string } };
    };
    expect(initializedPayload.result.serverInfo.name).toBe("aponia-mcp-example");

    const listed = await application.handle(
      post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { token }),
    );
    const listedPayload = (await listed.json()) as {
      result: { tools: readonly { name: string }[] };
    };
    expect(listedPayload.result.tools.map((tool) => tool.name)).toEqual([
      "describe_application",
      "add",
    ]);

    const called = await application.handle(
      post(
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "add", arguments: { a: 20, b: 22 } },
        },
        { token },
      ),
    );
    const calledPayload = (await called.json()) as {
      result: { content: readonly { text: string }[] };
    };
    expect(calledPayload.result.content[0]?.text).toBe("42");

    await application.close();
  });

  test("mounts on the configured path", async () => {
    const application = await createApplication({ MCP_PATH: "/rpc" });
    const token = "aponia-example-token";

    const served = await application.handle(post(initializeBody(), { path: "/rpc", token }));
    expect(served.status).toBe(200);

    const missing = await application.handle(post(initializeBody(), { path: "/mcp", token }));
    expect(missing.status).toBe(404);

    await application.close();
  });

  test("refuses an origin the configuration does not allow", async () => {
    const application = await createApplication({
      MCP_ALLOWED_ORIGINS: "https://app.example",
    });
    const token = "aponia-example-token";

    const refused = await application.handle(
      post(initializeBody(), { token, origin: "https://evil.example" }),
    );
    expect(refused.status).toBe(403);

    const allowed = await application.handle(
      post(initializeBody(), { token, origin: "https://app.example" }),
    );
    expect(allowed.status).toBe(200);

    await application.close();
  });
});
