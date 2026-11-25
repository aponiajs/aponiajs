import { describe, expect, test } from "bun:test";
import {
  AponiaError,
  ConnectedSocket,
  Injectable,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type CanActivate,
} from "@aponiajs/common";
import {
  compileGatewayPlan,
  createGatewayDispatcher,
  injectGatewayServer,
  type GatewaySocket,
} from "./index.ts";

const events: string[] = [];

@WebSocketGateway({ path: "/chat", origins: ["https://app.example"], maxPayloadLength: 1024 })
@Injectable()
class ChatGateway {
  @WebSocketServer() server: unknown;

  @SubscribeMessage("ping")
  ping(@MessageBody() data: { readonly n: number }): { readonly pong: number } {
    return { pong: data.n };
  }

  @SubscribeMessage("named")
  named(@ConnectedSocket() socket: GatewaySocket): string {
    events.push("socket-received");
    void socket;
    return "named";
  }

  @SubscribeMessage("pick")
  pick(@MessageBody("n") n: number): number {
    return n;
  }

  @SubscribeMessage("silent")
  silent(): undefined {
    return undefined;
  }

  @SubscribeMessage("redirect")
  redirect(): { readonly event: string; readonly data: unknown } {
    return { event: "other", data: 1 };
  }

  @SubscribeMessage("direct")
  direct(@ConnectedSocket() socket: GatewaySocket): undefined {
    socket.emit("directed", { n: 1 });
    return undefined;
  }

  @SubscribeMessage("broadcast")
  broadcast(): undefined {
    (this.server as { emit(event: string, data: unknown): void }).emit("news", { n: 2 });
    return undefined;
  }

  @SubscribeMessage("fail")
  fail(): never {
    throw new Error("secret detail");
  }

  afterInit(server: unknown): void {
    events.push(`init:${server === "server"}`);
  }

  handleConnection(): void {
    events.push("open");
  }

  handleDisconnect(): void {
    events.push("close");
  }
}

function socket(): GatewaySocket & { sent: string[]; closes: number[] } {
  const state = {
    sent: [] as string[],
    closes: [] as number[],
    emit(event: string, data: unknown) {
      state.sent.push(JSON.stringify({ event, data }));
    },
    send(data: string) {
      state.sent.push(data);
    },
    close(code?: number) {
      if (code !== undefined) {
        state.closes.push(code);
      }
    },
    subscribe() {},
    publish() {},
  };
  return state;
}

function dispatcher(guards: readonly CanActivate[] = []) {
  const instance = new ChatGateway();
  const plan = compileGatewayPlan(ChatGateway)!;
  const hooks = createGatewayDispatcher(instance, plan, guards);
  injectGatewayServer(instance, ["server"], hooks.server);
  return { instance, plan, hooks };
}

describe("the neutral gateway", () => {
  test("compiles the gateway's path, handlers, and declared bounds", () => {
    const plan = compileGatewayPlan(ChatGateway)!;

    expect(plan.path).toBe("/chat");
    expect(plan.maxPayloadLength).toBe(1024);
    expect(plan.origins).toEqual(["https://app.example"]);
    expect(plan.handlers.map((handler) => handler.event)).toEqual([
      "ping",
      "named",
      "pick",
      "silent",
      "redirect",
      "direct",
      "broadcast",
      "fail",
    ]);
  });

  test("answers a class that declares no gateway with undefined", () => {
    class Plain {}
    expect(compileGatewayPlan(Plain)).toBeUndefined();
  });

  test("emits a handler's result under the subscribed event", async () => {
    const { hooks } = dispatcher();
    const client = socket();
    await hooks.message(client, JSON.stringify({ event: "ping", data: { n: 7 } }));

    expect(client.sent.map((frame) => JSON.parse(frame))).toEqual([
      { event: "ping", data: { pong: 7 } },
    ]);
  });

  test("binds the connected socket and sends nothing for undefined", async () => {
    const { hooks } = dispatcher();
    const client = socket();

    await hooks.message(client, JSON.stringify({ event: "named" }));
    await hooks.message(client, JSON.stringify({ event: "silent" }));

    expect(client.sent.map((frame) => JSON.parse(frame))).toEqual([
      { event: "named", data: "named" },
    ]);
  });

  test("lets a handler select the event it answers", async () => {
    const { hooks } = dispatcher();
    const client = socket();
    await hooks.message(client, JSON.stringify({ event: "redirect" }));

    expect(JSON.parse(client.sent[0]!)).toEqual({ event: "other", data: 1 });
  });

  test("refuses an envelope it cannot read", async () => {
    const { hooks } = dispatcher();
    const client = socket();

    await hooks.message(client, "not json");
    await hooks.message(client, JSON.stringify({ data: 1 }));

    expect(JSON.parse(client.sent[0]!)).toMatchObject({
      event: "exception",
      data: { code: "INVALID_WEBSOCKET_MESSAGE" },
    });
    expect(client.sent).toHaveLength(2);
  });

  test("refuses an event no handler answers", async () => {
    const { hooks } = dispatcher();
    const client = socket();
    await hooks.message(client, JSON.stringify({ event: "missing" }));

    expect(JSON.parse(client.sent[0]!)).toMatchObject({
      event: "exception",
      data: { code: "UNKNOWN_WEBSOCKET_EVENT" },
    });
  });

  test("answers a handler failure without its message or stack", async () => {
    const { hooks } = dispatcher();
    const client = socket();
    await hooks.message(client, JSON.stringify({ event: "fail" }));

    const frame = JSON.parse(client.sent[0]!) as {
      event: string;
      data: { code: string; message: string };
    };
    expect(frame.event).toBe("exception");
    expect(frame.data.code).toBe("WEBSOCKET_HANDLER_ERROR");
    expect(JSON.stringify(frame)).not.toContain("secret detail");
  });

  test("runs the lifecycle hooks and injects the server", async () => {
    events.length = 0;
    const { hooks } = dispatcher();
    await hooks.afterInit();
    await hooks.open(socket());
    await hooks.close(socket());

    expect(events).toEqual(["init:false", "open", "close"]);
  });

  test("closes the socket a handshake guard refuses", async () => {
    const { hooks } = dispatcher([{ canActivate: () => false }]);
    const client = socket();
    await hooks.open(client);

    expect(client.closes).toEqual([1008]);
  });

  test("admits a socket every guard allows", async () => {
    const { hooks } = dispatcher([{ canActivate: () => true }]);
    const client = socket();
    await hooks.open(client);

    expect(client.closes).toEqual([]);
  });

  test("gives a handshake guard a ws context and no http view", async () => {
    let seen = "";
    const { hooks } = dispatcher([
      {
        canActivate: (context) => {
          seen = context.getType();
          expect(() => context.switchToHttp()).toThrow(AponiaError);
          return true;
        },
      },
    ]);
    await hooks.open(socket());

    expect(seen).toBe("ws");
  });

  test("reads a named property of the message body", async () => {
    const { hooks } = dispatcher();
    const client = socket();
    await hooks.message(client, JSON.stringify({ event: "pick", data: { n: 3 } }));

    expect(JSON.parse(client.sent[0]!)).toEqual({ event: "pick", data: 3 });
  });

  test("answers a handler the instance no longer carries", async () => {
    const { instance, plan, hooks } = dispatcher();
    (instance as unknown as Record<string, unknown>).ping = "not a function";
    const client = socket();
    await hooks.message(client, JSON.stringify({ event: "ping" }));

    expect(JSON.parse(client.sent[0]!)).toMatchObject({
      event: "exception",
      data: { code: "WEBSOCKET_HANDLER_ERROR" },
    });
    void plan;
  });

  test("lets a handler emit a named event to its own client", async () => {
    const { hooks } = dispatcher();
    const client = socket();
    await hooks.open(client);
    await hooks.message(client, JSON.stringify({ event: "direct" }));

    expect(JSON.parse(client.sent[0]!)).toEqual({ event: "directed", data: { n: 1 } });
  });

  test("lets a handler broadcast to every connected client", async () => {
    const { hooks } = dispatcher();
    const first = socket();
    const second = socket();
    await hooks.open(first);
    await hooks.open(second);

    await hooks.message(first, JSON.stringify({ event: "broadcast" }));

    expect(JSON.parse(first.sent[0]!)).toEqual({ event: "news", data: { n: 2 } });
    expect(JSON.parse(second.sent[0]!)).toEqual({ event: "news", data: { n: 2 } });

    await hooks.close(second);
    await hooks.close(first);
  });
});
