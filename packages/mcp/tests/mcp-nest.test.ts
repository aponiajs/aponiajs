import { describe, expect, test } from "bun:test";
import {
  AponiaError,
  Catch,
  Injectable,
  Module,
  UseFilters,
  UseInterceptors,
  UsePipes,
  type CanActivate,
  type ExecutionContext,
  type ExceptionFilter,
  type Interceptor,
  type PipeTransform,
} from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  McpModule,
  Prompt,
  Resource,
  ResourceTemplate,
  Tool,
  type McpContext,
  type McpModuleOptions,
} from "../src/index.ts";
import { serveMcpStdio } from "../src/transport/mcp-stdio.ts";

const endpoint = "http://localhost:3000/mcp";

function jsonRpc(body: unknown, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("accept", "application/json, text/event-stream");
  const { headers: ignored, ...rest } = init;
  void ignored;
  return new Request(endpoint, {
    method: "POST",
    body: JSON.stringify(body),
    ...rest,
    headers,
  });
}

function initializeBody(): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" },
    },
  };
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

async function createApp(
  options: McpModuleOptions,
  providers: readonly unknown[] = [],
): Promise<Awaited<ReturnType<typeof AponiaFactory.create>>> {
  const mcp = McpModule.forRoot(options);

  @Module({ imports: [mcp], providers: [...providers] as never })
  class TestModule {}

  return await AponiaFactory.create(TestModule, { logger: false });
}

@Injectable()
class BasicTools {
  @Tool({ inputSchema: z.object({ a: z.number(), b: z.number() }) })
  add({ a, b }: { a: number; b: number }, _context: McpContext): string {
    return String(a + b);
  }

  @Tool()
  echo(_input: unknown, context: McpContext): string {
    return context.kind;
  }

  @Resource({ uri: "note://1", mimeType: "text/plain" })
  note(_input: unknown, _context: McpContext): string {
    return "hello";
  }

  @ResourceTemplate({
    uriTemplate: "items://{id}",
    description: "One item",
    mimeType: "text/plain",
  })
  item({ id }: { id: string }, _context: McpContext): string {
    return `item-${id}`;
  }

  @Prompt({ argsSchema: z.object({ topic: z.string() }) })
  brief({ topic }: { topic: string }, _context: McpContext): unknown {
    return {
      messages: [{ role: "user", content: { type: "text", text: `About ${topic}` } }],
    };
  }
}

describe("@aponiajs/mcp Nest-style endpoint", () => {
  test("lists and calls decorated tools", async () => {
    const application = await createApp({ name: "test", version: "1.0.0" }, [BasicTools]);

    await application.handle(jsonRpc(initializeBody()));

    const listed = await application.handle(
      jsonRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    );
    const listedPayload = (await payloadOf(listed)) as {
      result: { tools: readonly { name: string }[] };
    };
    expect(listedPayload.result.tools.map((tool) => tool.name)).toEqual(["add", "echo"]);

    const called = await application.handle(
      jsonRpc({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "add", arguments: { a: 2, b: 3 } },
      }),
    );
    const calledPayload = (await payloadOf(called)) as {
      result: { content: readonly { text: string }[] };
    };
    expect(calledPayload.result.content[0]?.text).toBe("5");

    await application.close();
  });

  test("serves a resource, a resource template, and a prompt", async () => {
    const application = await createApp({ name: "test", version: "1.0.0" }, [BasicTools]);

    await application.handle(jsonRpc(initializeBody()));

    const read = await application.handle(
      jsonRpc({
        jsonrpc: "2.0",
        id: 2,
        method: "resources/read",
        params: { uri: "note://1" },
      }),
    );
    const readPayload = (await payloadOf(read)) as {
      result: { contents: readonly { text: string }[] };
    };
    expect(readPayload.result.contents[0]?.text).toBe("hello");

    const templated = await application.handle(
      jsonRpc({
        jsonrpc: "2.0",
        id: 3,
        method: "resources/read",
        params: { uri: "items://42" },
      }),
    );
    const templatedPayload = (await payloadOf(templated)) as {
      result: { contents: readonly { text: string }[] };
    };
    expect(templatedPayload.result.contents[0]?.text).toBe("item-42");

    const prompted = await application.handle(
      jsonRpc({
        jsonrpc: "2.0",
        id: 4,
        method: "prompts/get",
        params: { name: "brief", arguments: { topic: "pipes" } },
      }),
    );
    const promptedPayload = (await payloadOf(prompted)) as {
      result: { messages: readonly { content: { text: string } }[] };
    };
    expect(promptedPayload.result.messages[0]?.content.text).toBe("About pipes");

    await application.close();
  });

  test("maps tool results, resource contents, and prompt strings", async () => {
    @Injectable()
    class ResultTools {
      @Tool({
        description: "A structured answer",
        outputSchema: z.object({ ok: z.boolean() }),
        annotations: { readOnlyHint: true },
        icons: [{ src: "https://example.com/icon.png" }],
        _meta: { tag: "structured" },
      })
      structured(): { ok: boolean } {
        return { ok: true };
      }

      @Tool()
      empty(): undefined {
        return undefined;
      }

      @Tool()
      raw(): unknown {
        return { content: [{ type: "text", text: "raw" }], isError: true };
      }

      @Resource({ uri: "note://structured", description: "A note", mimeType: "text/plain" })
      structuredNote(): unknown {
        return { contents: [{ uri: "note://structured", text: "structured" }] };
      }

      @Resource({ uri: "note://json" })
      jsonNote(): unknown {
        return { value: 1 };
      }

      @Prompt({
        description: "A plain prompt",
        icons: [{ src: "https://example.com/icon.png" }],
      })
      plain(): string {
        return "plain prompt";
      }
    }

    const application = await createApp({ name: "test", version: "1.0.0" }, [ResultTools]);
    await application.handle(jsonRpc(initializeBody()));

    const structured = await application.handle(
      jsonRpc({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "structured", arguments: {} },
      }),
    );
    const structuredPayload = (await payloadOf(structured)) as {
      result: { structuredContent?: { ok: boolean } };
    };
    expect(structuredPayload.result.structuredContent).toEqual({ ok: true });

    const empty = await application.handle(
      jsonRpc({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "empty", arguments: {} },
      }),
    );
    expect((await payloadOf(empty)).result).toBeDefined();

    const raw = await application.handle(
      jsonRpc({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "raw", arguments: {} },
      }),
    );
    const rawPayload = (await payloadOf(raw)) as {
      result: { isError?: boolean; content: readonly { text: string }[] };
    };
    expect(rawPayload.result.isError).toBe(true);
    expect(rawPayload.result.content[0]?.text).toBe("raw");

    const structuredNote = await application.handle(
      jsonRpc({
        jsonrpc: "2.0",
        id: 4,
        method: "resources/read",
        params: { uri: "note://structured" },
      }),
    );
    expect(
      ((await payloadOf(structuredNote)) as { result: { contents: { text: string }[] } }).result
        .contents[0]?.text,
    ).toBe("structured");

    const jsonNote = await application.handle(
      jsonRpc({
        jsonrpc: "2.0",
        id: 5,
        method: "resources/read",
        params: { uri: "note://json" },
      }),
    );
    expect(
      ((await payloadOf(jsonNote)) as { result: { contents: { text: string }[] } }).result
        .contents[0]?.text,
    ).toBe('{"value":1}');

    const plain = await application.handle(
      jsonRpc({ jsonrpc: "2.0", id: 6, method: "prompts/get", params: { name: "plain" } }),
    );
    expect(
      ((await payloadOf(plain)) as { result: { messages: { content: { text: string } }[] } }).result
        .messages[0]?.content.text,
    ).toBe("plain prompt");

    await application.close();
  });

  test("runs guards, interceptors, pipes, and filters in order", async () => {
    const order: string[] = [];

    @Injectable()
    class RecordingInterceptor implements Interceptor {
      interceptBefore(): void {
        order.push("before");
      }
      interceptAfter(): void {
        order.push("after");
      }
    }

    @Injectable()
    class AddFlagPipe implements PipeTransform {
      transform(value: unknown): unknown {
        return { ...(value as Record<string, unknown>), flagged: true };
      }
    }

    @Injectable()
    @Catch()
    class RecoveringFilter implements ExceptionFilter {
      catch(): string {
        order.push("filter");
        return "handled";
      }
    }

    @Injectable()
    @Catch()
    class DecliningFilter implements ExceptionFilter {
      catch(): undefined {
        return undefined;
      }
    }

    @Injectable()
    class ReplacingInterceptor implements Interceptor {
      interceptAfter(): string {
        return "replaced";
      }
    }

    @Injectable()
    class PlainProvider {}

    @Injectable()
    class PipelineTools {
      @UseInterceptors(RecordingInterceptor)
      @UsePipes(AddFlagPipe)
      @Tool()
      read(input: unknown, _context: McpContext): string {
        order.push("handler");
        return JSON.stringify(input);
      }

      @Tool()
      @UseFilters(RecoveringFilter)
      fail(_input: unknown, _context: McpContext): string {
        throw new Error("boom");
      }

      @Tool()
      @UseFilters(DecliningFilter)
      declined(_input: unknown, _context: McpContext): string {
        throw new Error("declined");
      }

      @Tool()
      @UseInterceptors(ReplacingInterceptor)
      replace(): string {
        return "original";
      }
    }

    const application = await createApp({ name: "test", version: "1.0.0" }, [
      RecordingInterceptor,
      AddFlagPipe,
      RecoveringFilter,
      DecliningFilter,
      ReplacingInterceptor,
      PlainProvider,
      PipelineTools,
    ]);

    await application.handle(jsonRpc(initializeBody()));

    const read = await application.handle(
      jsonRpc({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "read", arguments: { value: 1 } },
      }),
    );
    const readPayload = (await payloadOf(read)) as {
      result: { content: readonly { text: string }[] };
    };
    expect(JSON.parse(readPayload.result.content[0]?.text ?? "{}")).toEqual({
      value: 1,
      flagged: true,
    });
    expect(order).toEqual(["before", "handler", "after"]);

    const failed = await application.handle(
      jsonRpc({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "fail", arguments: {} },
      }),
    );
    const failedPayload = (await payloadOf(failed)) as {
      result: { isError?: boolean; content: readonly { text: string }[] };
    };
    expect(failedPayload.result.isError).toBeUndefined();
    expect(failedPayload.result.content[0]?.text).toBe("handled");
    expect(order).toContain("filter");

    const declined = await application.handle(
      jsonRpc({
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: { name: "declined", arguments: {} },
      }),
    );
    const declinedPayload = (await payloadOf(declined)) as {
      result: { isError?: boolean; content: readonly { text: string }[] };
    };
    expect(declinedPayload.result.isError).toBe(true);
    expect(declinedPayload.result.content[0]?.text).toBe("declined");

    const replaced = await application.handle(
      jsonRpc({
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: { name: "replace", arguments: {} },
      }),
    );
    const replacedPayload = (await payloadOf(replaced)) as {
      result: { content: readonly { text: string }[] };
    };
    expect(replacedPayload.result.content[0]?.text).toBe("replaced");

    await application.close();
  });

  test("answers a tool error when a guard refuses", async () => {
    @Injectable()
    class RefuseGuard implements CanActivate {
      canActivate(_context: ExecutionContext): boolean {
        return false;
      }
    }

    const application = await createApp({ name: "test", version: "1.0.0", guards: [RefuseGuard] }, [
      RefuseGuard,
      BasicTools,
    ]);

    await application.handle(jsonRpc(initializeBody()));
    const called = await application.handle(
      jsonRpc({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "add", arguments: { a: 1, b: 2 } },
      }),
    );
    const calledPayload = (await payloadOf(called)) as {
      result: { isError?: boolean; content: readonly { text: string }[] };
    };
    expect(calledPayload.result.isError).toBe(true);
    expect(calledPayload.result.content[0]?.text).toContain("refused");

    await application.close();
  });

  test("refuses duplicate tool names at mount", async () => {
    @Injectable()
    class FirstTools {
      @Tool({ name: "same" })
      first(): string {
        return "first";
      }
    }
    @Injectable()
    class SecondTools {
      @Tool({ name: "same" })
      second(): string {
        return "second";
      }
    }

    let failure: unknown;
    try {
      await createApp({ name: "test", version: "1.0.0" }, [FirstTools, SecondTools]);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AponiaError);
  });

  test("refuses an invalid tool name while the decorator runs", () => {
    expect(() => Tool({ name: "not valid" })).toThrow(TypeError);
  });

  test("limits discovery to the included modules", async () => {
    @Injectable()
    class FeatureTools {
      @Tool()
      feature(): string {
        return "feature";
      }
    }

    @Module({ providers: [FeatureTools], exports: [FeatureTools] })
    class FeatureModule {}

    @Injectable()
    class RootTools {
      @Tool()
      root(): string {
        return "root";
      }
    }

    const mcp = McpModule.forRoot({
      name: "test",
      version: "1.0.0",
      include: [{ module: FeatureModule, id: "feature" } as never],
    });

    @Module({ imports: [mcp, FeatureModule], providers: [RootTools] })
    class RootModule {}

    const application = await AponiaFactory.create(RootModule, { logger: false });
    await application.handle(jsonRpc(initializeBody()));
    const listed = await application.handle(
      jsonRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    );
    const listedPayload = (await payloadOf(listed)) as {
      result: { tools: readonly { name: string }[] };
    };
    expect(listedPayload.result.tools.map((tool) => tool.name)).toEqual(["feature"]);
    await application.close();
  });

  test("answers 403, 413, 415, and 405 before dispatch", async () => {
    const application = await createApp(
      {
        name: "test",
        version: "1.0.0",
        http: { allowedHosts: ["localhost"], maxRequestBodySize: 16 },
      },
      [BasicTools],
    );

    const hostRefused = await application.handle(
      new Request("http://example.com/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify(initializeBody()),
      }),
    );
    expect(hostRefused.status).toBe(403);

    const tooLarge = await application.handle(
      new Request(endpoint, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", padding: "x".repeat(64) }),
      }),
    );
    expect(tooLarge.status).toBe(413);

    const wrongType = await application.handle(
      new Request(endpoint, {
        method: "POST",
        headers: { accept: "application/json, text/event-stream", "content-type": "text/plain" },
        body: "hello",
      }),
    );
    expect(wrongType.status).toBe(415);

    const invalidOrigin = await application.handle(
      new Request(endpoint, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          origin: "not a url",
        },
        body: JSON.stringify(initializeBody()),
      }),
    );
    expect(invalidOrigin.status).toBe(403);

    const wrongMethod = await application.handle(
      new Request(endpoint, {
        method: "PUT",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: "{}",
      }),
    );
    expect(wrongMethod.status).toBe(405);

    await application.close();
  });

  test("serves the same primitives over Hono and H3", async () => {
    const [{ AponiaFactory: HonoFactory }, { AponiaFactory: H3Factory }] = await Promise.all([
      import("@aponiajs/platform-hono"),
      import("@aponiajs/platform-h3"),
    ]);

    const mcp = McpModule.forRoot({ name: "test", version: "1.0.0" });

    @Module({ imports: [mcp], providers: [BasicTools] })
    class PlatformModule {}

    for (const factory of [HonoFactory, H3Factory]) {
      const application = await factory.create(PlatformModule, { logger: false });
      await application.handle(jsonRpc(initializeBody()));
      const listed = await application.handle(
        jsonRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      );
      const listedPayload = (await payloadOf(listed)) as {
        result: { tools: readonly { name: string }[] };
      };
      expect(listedPayload.result.tools.map((tool) => tool.name)).toEqual(["add", "echo"]);
      await application.close();
    }
  });

  test("serves the same primitives over stdio", async () => {
    @Injectable()
    class StdioTools {
      @Tool()
      ping(): string {
        return "pong";
      }
    }

    const application = await createApp({ name: "test", version: "1.0.0", path: false }, [
      StdioTools,
    ]);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const handle = serveMcpStdio(application, { transport: serverTransport });
    const responses: Record<string, unknown>[] = [];
    clientTransport.onmessage = (message) => {
      responses.push(message as Record<string, unknown>);
    };

    await clientTransport.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    });
    await clientTransport.send({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    await clientTransport.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "ping", arguments: {} },
    });

    await Bun.sleep(20);
    const called = responses.find((message) => message.id === 2) as
      | { result?: { content?: readonly { text?: string }[] } }
      | undefined;
    expect(called?.result?.content?.[0]?.text).toBe("pong");

    await handle.close();
    await application.close();
  });
});
