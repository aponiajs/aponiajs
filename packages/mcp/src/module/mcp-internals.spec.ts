import { describe, expect, test } from "bun:test";
import { AponiaError, Injectable, Module, mcpPrimitivesMetadataKey } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import {
  McpModule,
  McpExecutionContext,
  Tool,
  listenMcpStdio,
  type McpContext,
  serveMcpStdio,
} from "../index.ts";
import { resolveMcpOptions, topLevelOf } from "./mcp-options.ts";
import {
  attachMcpRuntime,
  createMcpRuntimeFromContainer,
  readMcpRuntime,
  type McpRuntime,
} from "../transport/mcp-runtime.ts";
import { buildMcpPlan } from "../discovery/mcp-discovery.ts";

@Injectable()
class AsyncTools {
  @Tool()
  ping(): string {
    return "pong";
  }
}

describe("@aponiajs/mcp internals", () => {
  test("reads the MCP execution context it was handed", () => {
    const handler = (): string => "ok";
    const call: McpContext = {
      kind: "tool",
      name: "ping",
      transport: "http",
    };
    const context = new McpExecutionContext(AsyncTools, handler, { value: 1 }, call);

    expect(McpExecutionContext.create(context)).toBe(context);
    expect(context.getType()).toBe("mcp");
    expect(context.getInput()).toEqual({ value: 1 });
    expect(context.getKind()).toBe("tool");
    expect(context.getName()).toBe("ping");
    expect(context.getMcpContext()).toBe(call);
    expect(context.getRequest()).toBeUndefined();
    expect(context.getClass()).toBe(AsyncTools);
    expect(context.getHandler()).toBe(handler);
    expect(context.getRoute()).toEqual({ method: "POST", path: "/mcp" });
    expect(context.getContext()).toBeDefined();
    expect(context.switchToHttp().getRequest()).toBeDefined();
    expect(context.switchToRpc().getData()).toEqual({ value: 1 });
    expect(context.switchToRpc().getContext()).toBe(call);
    expect(() => context.switchToWs()).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_ARGUMENT_HOST" }),
    );
  });

  test("fills the module defaults and normalizes the path", () => {
    const options = resolveMcpOptions(
      { name: "app", version: "1.0.0" },
      { path: "rpc", include: [], guards: [], interceptors: [], filters: [], pipes: [] },
    );

    expect(options.path).toBe("/rpc");
    expect(options.legacy).toBe("stateless");
    expect(options.responseMode).toBe("auto");
    expect(options.allowedOrigins).toEqual(["localhost", "127.0.0.1", "[::1]"]);
    expect(options.maxRequestBodySize).toBe(4 * 1024 * 1024);
    expect(options.stdioLegacy).toBe("serve");
    expect(options.key).toBe("mcp");
  });

  test("accepts path false and a disabled origin check", () => {
    const options = resolveMcpOptions(
      { name: "app", version: "1.0.0", http: { allowedOrigins: false } },
      { path: false },
    );

    expect(options.path).toBe(false);
    expect(options.allowedOrigins).toBe(false);
  });

  test("refuses an invalid identity, path, or body bound", () => {
    expect(() => resolveMcpOptions({ name: "", version: "1" })).toThrow(AponiaError);
    expect(() => resolveMcpOptions({ name: "app", version: "" })).toThrow(AponiaError);
    expect(() => resolveMcpOptions({ name: "app", version: "1" }, { path: "" })).toThrow(
      AponiaError,
    );
    expect(() =>
      resolveMcpOptions({ name: "app", version: "1", http: { maxRequestBodySize: 0 } }),
    ).toThrow(AponiaError);
  });

  test("reads the top-level fields apart from the factory metadata", () => {
    const key = Symbol("key");
    expect(
      topLevelOf({
        path: "/rpc",
        include: [],
        key: "custom",
      }),
    ).toEqual({
      path: "/rpc",
      include: [],
      key: "custom",
    });
    expect(key).toBeDefined();
  });

  test("registers metadata a forRootAsync factory builds", async () => {
    const mcp = McpModule.forRootAsync({
      useFactory: () => ({ name: "async-app", version: "2.0.0" }),
    });

    @Module({ imports: [mcp], providers: [AsyncTools] })
    class AsyncModule {}

    const application = await AponiaFactory.create(AsyncModule, { logger: false });
    const response = await application.handle(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "test", version: "1" },
          },
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(readMcpRuntime(application.getNativeApplication())).toBeDefined();
    // The wrapper does not carry the runtime itself: it is read back through the
    // boot's container, which resolves the token from the module that owns it.
    expect(readMcpRuntime(application)).toBeDefined();
    await application.close();
  });

  test("attaches a runtime where the stdio entry reads it", () => {
    const application = {};
    const runtime: McpRuntime = {
      plan: Object.freeze({
        tools: Object.freeze([]),
        resources: Object.freeze([]),
        resourceTemplates: Object.freeze([]),
        prompts: Object.freeze([]),
      }),
      options: resolveMcpOptions({ name: "app", version: "1.0.0" }),
      container: {} as never,
      http: async () => new Response(null, { status: 204 }),
      close: async () => {},
    };

    attachMcpRuntime(application, runtime);

    expect(readMcpRuntime(application)).toBe(runtime);
    const descriptor = Object.getOwnPropertyDescriptor(
      application,
      Symbol.for("aponia.mcp.runtime"),
    );
    expect(descriptor).toMatchObject({
      enumerable: false,
      writable: false,
      configurable: false,
    });
  });

  test("listenMcpStdio answers once the client closes stdin and closes the transport", async () => {
    @Injectable()
    class StdioTools {
      @Tool()
      ping(): string {
        return "pong";
      }
    }

    @Module({
      imports: [McpModule.forRoot({ name: "app", version: "1.0.0", path: false })],
      providers: [StdioTools],
    })
    class StdioModule {}

    const application = await AponiaFactory.create(StdioModule, { logger: false });
    const [, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      const listening = listenMcpStdio(application, { transport: serverTransport });
      process.stdin.emit("end");
      await listening;
    } finally {
      await application.close();
    }
  });

  test("refuses a stdio entry for an application no McpModule booted", () => {
    expect(() => serveMcpStdio({})).toThrow(AponiaError);
  });

  test("refuses a runtime built before the boot container existed", () => {
    const options = resolveMcpOptions({ name: "app", version: "1.0.0" });
    expect(() => createMcpRuntimeFromContainer({}, options)).toThrow(AponiaError);
  });

  test("selects a provider by its module class token in include", () => {
    class AsyncFeatureModule {}

    const plan = buildMcpPlan(
      fakeContainer(AsyncTools, new AsyncTools(), AsyncFeatureModule),
      resolveMcpOptions({ name: "app", version: "1.0.0" }, { include: [AsyncFeatureModule] }),
    );

    expect(plan.tools.map((tool) => tool.name)).toEqual(["ping"]);
  });

  test("refuses a decorated member that is not a method", () => {
    class BrokenTools {}
    const prototype = BrokenTools.prototype;
    Reflect.defineMetadata(
      mcpPrimitivesMetadataKey,
      new Map([["missing", { kind: "tool" }]]),
      prototype,
    );
    const instance = Object.create(prototype) as Record<string, unknown>;
    instance.missing = "not a method";

    expect(() =>
      buildMcpPlan(
        fakeContainer(BrokenTools, instance),
        resolveMcpOptions({ name: "app", version: "1.0.0" }),
      ),
    ).toThrow(AponiaError);
  });

  test("refuses an invalid primitive name found during discovery", () => {
    class BadNameTools {}
    const prototype = BadNameTools.prototype;
    Reflect.defineMetadata(
      mcpPrimitivesMetadataKey,
      new Map([["call", { kind: "tool", name: "bad name" }]]),
      prototype,
    );
    const instance = Object.create(prototype) as Record<string, unknown>;
    instance.call = () => "ok";

    expect(() =>
      buildMcpPlan(
        fakeContainer(BadNameTools, instance),
        resolveMcpOptions({ name: "app", version: "1.0.0" }),
      ),
    ).toThrow(AponiaError);
  });
});

function fakeContainer(
  token: new () => object,
  instance: object,
  moduleClass?: new () => object,
): Parameters<typeof buildMcpPlan>[0] {
  const module = {
    id: "m",
    ...(moduleClass === undefined ? {} : { moduleClass }),
    imports: [],
    controllers: [],
    exports: [],
    providers: [{ kind: "class", provide: token, useClass: token, inject: [] }],
  };
  return {
    graph: { modules: [module] },
    resolveModuleProvider: () => instance,
    get: () => instance,
  } as unknown as Parameters<typeof buildMcpPlan>[0];
}
