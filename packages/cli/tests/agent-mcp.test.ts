import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { parseArguments } from "../src/index.ts";
import { createAgentMcpServer } from "../src/agent/mcp-server.ts";
import { serveMcpStdio } from "../src/agent/mcp-stdio.ts";
import {
  agentMcpLatestProtocolVersion,
  agentMcpProtocolVersion,
  agentMcpProtocolVersions,
} from "../src/agent/mcp-protocol.ts";

describe("aponia mcp", () => {
  test("parses the command and its project options", () => {
    expect(parseArguments(["mcp", "--cwd", "/tmp/app", "--project", "api"])).toEqual({
      command: "mcp",
      cwd: "/tmp/app",
      project: "api",
      allowWrite: false,
      allowExec: false,
    });
  });

  test("lists the read-only tools and serves the manifest", async () => {
    const server = createAgentMcpServer();
    const listed = await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    const tools =
      (listed as { result?: { tools?: readonly { name: string }[] } }).result?.tools ?? [];

    expect(tools.map((tool) => tool.name)).toEqual([
      "aponia_manifest",
      "aponia_search_libraries",
      "aponia_recipe",
      "aponia_inspect_project",
      "aponia_library_check",
      "aponia_explain_error",
    ]);

    const called = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "aponia_manifest", arguments: {} },
    });
    const text =
      (called as { result?: { content?: readonly { text: string }[] } }).result?.content?.[0]
        ?.text ?? "";
    expect(JSON.parse(text)).toMatchObject({ contractVersion: 1 });
  });

  test("serves recipes and explains known errors", async () => {
    const server = createAgentMcpServer();
    const recipe = await callTool(server, "aponia_recipe", { topic: "add-rest-resource" });
    expect(recipe).toContain("aponia g res");

    const known = await callTool(server, "aponia_explain_error", { code: "MISSING_PROVIDER" });
    expect(known).toContain("MISSING_PROVIDER");
    const unknown = await callTool(server, "aponia_explain_error", { code: "NOPE" });
    expect(unknown).toContain("Unknown framework error code");
  });

  test("inspects a project without executing it and confines library paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "aponia-mcp-project-"));
    await mkdir(join(root, "src"), { recursive: true });
    await Bun.write(
      join(root, "aponia.json"),
      `${JSON.stringify({ sourceRoot: "src" }, undefined, 2)}\n`,
    );
    await Bun.write(
      join(root, "src/app.controller.ts"),
      `import { Controller, Get } from "@aponiajs/common";\n\n@Controller("hello")\nexport class AppController {\n  @Get()\n  read(): string {\n    return "hello";\n  }\n}\n`,
    );
    await Bun.write(
      join(root, "src/app.module.ts"),
      `import { Module } from "@aponiajs/common";\nimport { AppController } from "./app.controller.ts";\n\n@Module({ controllers: [AppController] })\nexport class AppModule {}\n`,
    );

    const server = createAgentMcpServer({ cwd: root });
    const inspected = await callTool(server, "aponia_inspect_project", {});
    const payload = JSON.parse(inspected) as {
      readonly controllers: readonly { readonly className: string }[];
      readonly modules: readonly { readonly className: string }[];
    };
    expect(payload.controllers.map((controller) => controller.className)).toEqual([
      "AppController",
    ]);
    expect(payload.modules.map((module) => module.className)).toEqual(["AppModule"]);

    const escaped = await callTool(server, "aponia_library_check", { path: "../outside" });
    expect(escaped).toContain("escapes the workspace root");
  });

  test("negotiates the protocol version and answers server/discover", async () => {
    const server = createAgentMcpServer();

    const supported = await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    });
    expect((supported as any).result.protocolVersion).toBe("2025-06-18");

    const unsupported = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: { protocolVersion: "1999-01-01" },
    });
    expect((unsupported as any).result.protocolVersion).toBe(agentMcpProtocolVersion);

    const discover = await server.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "server/discover",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": agentMcpLatestProtocolVersion,
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    });
    expect((discover as any).result.protocolVersions).toEqual([...agentMcpProtocolVersions]);
    expect((discover as any).result.serverInfo.name).toBe("aponia");

    const withoutCapabilities = await server.handleMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "server/discover",
      params: { _meta: {} },
    });
    expect((withoutCapabilities as any).error.message).toBe(
      "server/discover requires client capabilities",
    );

    const unsupportedDiscover = await server.handleMessage({
      jsonrpc: "2.0",
      id: 5,
      method: "server/discover",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "1999-01-01",
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    });
    expect((unsupportedDiscover as any).error.message).toBe(
      "Unsupported protocol version 1999-01-01",
    );
  });

  test("writes one JSON-RPC response per input line", async () => {
    const server = createAgentMcpServer();
    const encoder = new TextEncoder();
    const input = (async function* () {
      yield encoder.encode('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
      yield encoder.encode('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');
    })();
    const output: string[] = [];

    await serveMcpStdio(server, { input, write: (text) => output.push(text) });

    const responses = output
      .join("")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(responses).toHaveLength(2);
    expect(responses[0]).toMatchObject({ jsonrpc: "2.0", id: 1 });
    expect(responses[1]).toMatchObject({ jsonrpc: "2.0", id: 2 });
  });

  test("keeps write and exec tools behind explicit capabilities", async () => {
    const readOnly = createAgentMcpServer();
    expect(await toolNames(readOnly)).toEqual([
      "aponia_manifest",
      "aponia_search_libraries",
      "aponia_recipe",
      "aponia_inspect_project",
      "aponia_library_check",
      "aponia_explain_error",
    ]);

    const writable = createAgentMcpServer({ allowWrite: true });
    expect(await toolNames(writable)).toEqual([
      "aponia_manifest",
      "aponia_search_libraries",
      "aponia_recipe",
      "aponia_inspect_project",
      "aponia_library_check",
      "aponia_explain_error",
      "aponia_plan_generate",
      "aponia_apply_generate",
    ]);

    const executable = createAgentMcpServer({ allowExec: true });
    expect(await toolNames(executable)).toContain("aponia_verify");
  });

  test("plans and applies a schematic only with an explicit confirmation", async () => {
    const root = await mkdtemp(join(tmpdir(), "aponia-mcp-plan-"));
    await mkdir(join(root, "src"), { recursive: true });
    await Bun.write(
      join(root, "aponia.json"),
      `${JSON.stringify({ sourceRoot: "src", generateOptions: { spec: false } }, undefined, 2)}\n`,
    );
    await Bun.write(
      join(root, "src/app.module.ts"),
      'import { Module } from "@aponiajs/common";\n\n@Module({})\nexport class AppModule {}\n',
    );
    const server = createAgentMcpServer({ cwd: root, allowWrite: true });
    const planned = JSON.parse(
      await callTool(server, "aponia_plan_generate", { schematic: "service", name: "billing" }),
    ) as { readonly planId: string; readonly changes: readonly { readonly path: string }[] };
    expect(planned.changes.length).toBeGreaterThan(0);

    const refused = await callTool(server, "aponia_apply_generate", {
      planId: planned.planId,
      confirm: false,
    });
    expect(refused).toContain("confirm: true");

    const applied = JSON.parse(
      await callTool(server, "aponia_apply_generate", {
        planId: planned.planId,
        confirm: true,
      }),
    ) as { readonly applied: boolean };
    expect(applied.applied).toBe(true);
    expect(await Bun.file(join(root, planned.changes[0]!.path)).exists()).toBe(true);

    const reused = await callTool(server, "aponia_apply_generate", {
      planId: planned.planId,
      confirm: true,
    });
    expect(reused).toContain("unknown or already consumed");
  });

  test("rejects an unknown verification scope before running a command", async () => {
    const server = createAgentMcpServer({ cwd: process.cwd(), allowExec: true });
    expect(await callTool(server, "aponia_verify", { scope: "everything" })).toContain(
      'Unknown verification scope "everything"',
    );
  });

  test("answers a malformed frame, skips a blank line, and flushes a final line", async () => {
    const server = createAgentMcpServer();
    const encoder = new TextEncoder();
    const input = (async function* () {
      yield encoder.encode("\nnot-json\n");
      yield encoder.encode('{"jsonrpc":"2.0","id":3,"method":"ping"}');
    })();
    const output: string[] = [];

    await serveMcpStdio(server, { input, write: (text) => output.push(text) });

    const responses = output
      .join("")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(responses).toHaveLength(2);
    expect(responses[0]).toMatchObject({ error: { code: -32700 } });
    expect(responses[1]).toMatchObject({ id: 3, result: {} });
  });

  test("reports a server failure on stderr without writing a protocol frame", async () => {
    const server = {
      handleMessage: async () => {
        throw new Error("boom");
      },
    } as unknown as ReturnType<typeof createAgentMcpServer>;
    const encoder = new TextEncoder();
    const input = (async function* () {
      yield encoder.encode('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    })();
    const output: string[] = [];
    const errors: string[] = [];

    await serveMcpStdio(server, {
      input,
      write: (text) => output.push(text),
      error: (text) => errors.push(text),
    });

    expect(output).toEqual([]);
    expect(errors.join("")).toContain("boom");
  });
});

async function callTool(
  server: ReturnType<typeof createAgentMcpServer>,
  name: string,
  arguments_: Record<string, unknown>,
): Promise<string> {
  const response = await server.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: arguments_ },
  });
  return (
    (response as { result?: { content?: readonly { text: string }[] } }).result?.content?.[0]
      ?.text ?? ""
  );
}

async function toolNames(server: ReturnType<typeof createAgentMcpServer>): Promise<string[]> {
  const response = await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  return (
    (response as { result?: { tools?: readonly { name: string }[] } }).result?.tools ?? []
  ).map((tool) => tool.name);
}
