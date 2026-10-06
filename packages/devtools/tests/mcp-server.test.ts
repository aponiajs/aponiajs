import { describe, expect, test } from "bun:test";
import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { DevtoolsModule } from "../src/module/devtools-module.ts";

@Controller("mcp-test")
class McpTestController {
  @Get("/hello")
  hello(): string {
    return "world";
  }
}

@Module({
  controllers: [McpTestController],
  imports: [DevtoolsModule.register({ enabled: true })],
})
class McpTestModule {}

async function askMcp(app: any, body: unknown): Promise<any> {
  const req = new Request("http://localhost:3000/__devtools/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await app.handle(req);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Failed to parse JSON. Status: ${res.status}, body: "${text}"`);
  }
}

describe("embedded-mcp-server", () => {
  test("responds to discovery GET request", async () => {
    const app = await AponiaFactory.create(McpTestModule, { logger: false });
    try {
      const res = await app.handle(new Request("http://localhost:3000/__devtools/mcp"));
      expect(res.status).toBe(200);
      const data = (await res.json()) as { status: string; protocol: string };
      expect(data.status).toBe("ready");
      expect(data.protocol).toBe("mcp");
    } finally {
      await app.close();
    }
  });

  test("responds to initialize and lists all 6 professional tools via official MCP server", async () => {
    const app = await AponiaFactory.create(McpTestModule, { logger: false });

    try {
      // 1. Initialize
      const initRes = await askMcp(app, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          clientInfo: { name: "test-client", version: "1.0.0" },
          capabilities: {},
        },
      });

      expect(initRes.result).toBeDefined();
      expect(initRes.result.serverInfo.name).toBe("aponia-devtools");
      expect(initRes.result.capabilities.tools).toBeDefined();

      // 2. tools/list
      const listRes = await askMcp(app, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      });

      expect(listRes.result).toBeDefined();
      const tools = listRes.result.tools;
      expect(tools.length).toBeGreaterThanOrEqual(6);

      const toolNames = tools.map((t: any) => t.name);
      expect(toolNames).toContain("get_source_code");
      expect(toolNames).toContain("inspect_application_graph");
      expect(toolNames).toContain("inspect_route_pipeline");
      expect(toolNames).toContain("inspect_store_state");
      expect(toolNames).toContain("query_recent_requests");
      expect(toolNames).toContain("read_application_logs");
    } finally {
      await app.close();
    }
  });

  test("executes inspect_application_graph tool call", async () => {
    const app = await AponiaFactory.create(McpTestModule, { logger: false });

    try {
      const callRes = await askMcp(app, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "inspect_application_graph",
          arguments: {},
        },
      });

      expect(callRes.result).toBeDefined();
      expect(callRes.result.content[0].type).toBe("text");

      const graph = JSON.parse(callRes.result.content[0].text);
      expect(graph.nodes).toBeDefined();
      expect(graph.edges).toBeDefined();
      expect(graph.nodes.some((n: any) => n.id === "controller:McpTestController")).toBe(true);
    } finally {
      await app.close();
    }
  });

  test("executes inspect_route_pipeline tool call", async () => {
    const app = await AponiaFactory.create(McpTestModule, { logger: false });

    try {
      const callRes = await askMcp(app, {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "inspect_route_pipeline",
          arguments: {
            method: "GET",
            path: "/mcp-test/hello",
          },
        },
      });

      expect(callRes.result).toBeDefined();
      const pipeline = JSON.parse(callRes.result.content[0].text);
      expect(pipeline.routes).toBeDefined();
    } finally {
      await app.close();
    }
  });

  test("executes inspect_store_state and query_recent_requests tool calls", async () => {
    const app = await AponiaFactory.create(McpTestModule, {
      configureNative: (native) => native.state("myStateKey", 123),
      logger: false,
    });

    try {
      // Trigger request
      await app.handle(new Request("http://localhost:3000/mcp-test/hello"));

      // 1. inspect_store_state
      const storeRes = await askMcp(app, {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "inspect_store_state",
          arguments: { key: "myStateKey" },
        },
      });

      expect(storeRes.result).toBeDefined();
      const storeData = JSON.parse(storeRes.result.content[0].text);
      expect(storeData).toBeDefined();

      // 2. query_recent_requests
      const reqRes = await askMcp(app, {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "query_recent_requests",
          arguments: { limit: 5 },
        },
      });

      expect(reqRes.result).toBeDefined();
      const reqData = JSON.parse(reqRes.result.content[0].text);
      expect(reqData.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });
});
