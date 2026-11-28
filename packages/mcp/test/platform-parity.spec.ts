import { expect, test } from "bun:test";
import { Injectable, Module } from "@aponiajs/common";
import { AponiaFactory as ElysiaFactory } from "@aponiajs/platform-elysia";

import { AponiaFactory as H3AponiaFactory } from "@aponiajs/platform-h3";
import { AponiaFactory as HonoAponiaFactory } from "@aponiajs/platform-hono";
import { toFetchHandler } from "@aponiajs/serverless";
import { McpModule, Tool } from "../src/index.ts";
import { McpRuntimeShutdown, type McpRuntime } from "../src/transport/mcp-runtime.ts";

@Injectable()
class GreetingTools {
  @Tool({ description: "Answers a greeting." })
  greet(): string {
    return "hello";
  }
}

@Module({
  imports: [McpModule.forRoot({ name: "greetings", version: "1.0.0" })],
  providers: [GreetingTools],
})
class ElysiaModule {}

@Module({
  imports: [McpModule.forRoot({ name: "greetings", version: "1.0.0" })],
  providers: [GreetingTools],
})
class HonoModule {}

@Module({
  imports: [McpModule.forRoot({ name: "greetings", version: "1.0.0" })],
  providers: [GreetingTools],
})
class H3Module {}

function request(body: unknown): Request {
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
}

interface Answer {
  readonly initialize: number;
  readonly tools: readonly string[];
  readonly call: string;
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

async function observe(fetch: (request: Request) => Response | Promise<Response>): Promise<Answer> {
  const initialize = await fetch(
    request({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      },
    }),
  );
  const listed = await payloadOf(
    await fetch(request({ jsonrpc: "2.0", id: 2, method: "tools/list" })),
  );
  const called = await payloadOf(
    await fetch(
      request({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "greet", arguments: {} },
      }),
    ),
  );
  const tools = ((listed.result as { tools?: { name: string }[] } | undefined)?.tools ?? []).map(
    (tool) => tool.name,
  );
  const content = (called.result as { content?: { text?: string }[] } | undefined)?.content;
  return {
    initialize: initialize.status,
    tools,
    call: content?.[0]?.text ?? "",
  };
}

test("the same MCP registration answers identically on every platform", async () => {
  const elysia = await ElysiaFactory.create(ElysiaModule, { logger: false });
  const hono = await HonoAponiaFactory.create(HonoModule, { logger: false });
  const h3 = await H3AponiaFactory.create(H3Module, { logger: false });

  try {
    const answers = {
      elysia: await observe((current) => elysia.handle(current)),
      hono: await observe((current) => hono.handle(current)),
      h3: await observe((current) => h3.handle(current)),
      serverless: await observe(toFetchHandler(hono)),
    };
    for (const observed of Object.values(answers)) {
      expect(observed.initialize).toBe(200);
      expect(observed.tools).toEqual(["greet"]);
      expect(observed.call).toBe("hello");
    }
  } finally {
    await elysia.close();
    await hono.close();
    await h3.close();
  }
});

test("a stopping application closes the MCP transport once", async () => {
  let closes = 0;
  const runtime = {
    close: async () => {
      closes += 1;
    },
  } as unknown as McpRuntime;

  const shutdown = new McpRuntimeShutdown(runtime);
  await shutdown.onApplicationShutdown();
  await shutdown.onApplicationShutdown();

  expect(closes).toBe(1);
});
