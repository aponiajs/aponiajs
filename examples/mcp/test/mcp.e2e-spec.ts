import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createApplication } from "./application.ts";

const endpoint = "http://localhost:3200";
const token = "aponia-example-token";

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
  options: { readonly token?: string; readonly origin?: string } = {},
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

  return new Request(`${endpoint}/mcp`, {
    method: "POST",
    body: JSON.stringify(body),
    headers,
  });
}

async function payloadOf(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const data = text
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice(6))
      .join("\n");
    return JSON.parse(data) as Record<string, unknown>;
  }
  return JSON.parse(text) as Record<string, unknown>;
}

describe("mcp example", () => {
  test("serves the handshake and lists the decorated tools", async () => {
    const application = await createApplication();

    const initialized = await application.handle(post(initializeBody(), { token }));
    expect(initialized.status).toBe(200);

    const listed = await application.handle(
      post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { token }),
    );
    const listedPayload = (await payloadOf(listed)) as {
      result: { tools: readonly { name: string }[] };
    };
    expect(listedPayload.result.tools.map((tool) => tool.name)).toEqual([
      "add",
      "describeApplication",
    ]);

    await application.close();
  });

  test("runs a tool with its validated arguments", async () => {
    const application = await createApplication();

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
    const calledPayload = (await payloadOf(called)) as {
      result: { content: readonly { text: string }[] };
    };
    expect(calledPayload.result.content[0]?.text).toBe("42");

    await application.close();
  });

  test("answers an injected provider through a tool", async () => {
    const application = await createApplication();

    const called = await application.handle(
      post(
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "describeApplication", arguments: {} },
        },
        { token },
      ),
    );
    const calledPayload = (await payloadOf(called)) as {
      result: { content: readonly { text: string }[] };
    };
    expect(calledPayload.result.content[0]?.text).toContain("AponiaJS application");

    await application.close();
  });

  test("returns a tool error when the guard refuses the call", async () => {
    const application = await createApplication();

    const called = await application.handle(
      post({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "add", arguments: { a: 1, b: 2 } },
      }),
    );
    const calledPayload = (await payloadOf(called)) as {
      result: { isError?: boolean };
    };
    expect(calledPayload.result.isError).toBe(true);

    await application.close();
  });

  test("refuses a browser origin outside the default allowlist", async () => {
    const application = await createApplication();

    const refused = await application.handle(
      post(initializeBody(), { token, origin: "https://evil.example" }),
    );
    expect(refused.status).toBe(403);

    await application.close();
  });
});
