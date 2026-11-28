import { describe, expect, test } from "bun:test";
import { AponiaError } from "../exceptions/aponia-error.ts";
import { type CanActivate } from "../interfaces/enhancer.interface.ts";
import { createGatewayDispatcher, injectGatewayServer } from "./gateway-dispatch.ts";
import type { GatewayPlan, GatewaySocket } from "../interfaces/gateway.interface.ts";

function socket(id = "peer"): GatewaySocket & {
  readonly emitted: { readonly event: string; readonly data: unknown }[];
  readonly closed: { readonly code?: number; readonly reason?: string }[];
} {
  const emitted: { readonly event: string; readonly data: unknown }[] = [];
  const closed: { readonly code?: number; readonly reason?: string }[] = [];
  return {
    id,
    emit(event, data) {
      emitted.push({ event, data });
    },
    send(data) {
      emitted.push({ event: "raw", data });
    },
    close(code, reason) {
      closed.push({ code, reason });
    },
    subscribe() {},
    publish() {},
    emitted,
    closed,
  };
}

function plan(handlers: GatewayPlan["handlers"] = []): GatewayPlan {
  return Object.freeze({ path: "/ws", handlers: Object.freeze(handlers), guards: [] });
}

describe("gateway dispatcher", () => {
  test("runs afterInit with the server and both lifecycle hooks", async () => {
    const events: string[] = [];
    const dispatcher = createGatewayDispatcher(
      {
        afterInit: () => events.push("init"),
        handleConnection: () => events.push("open"),
        handleDisconnect: () => events.push("close"),
      },
      plan(),
      [],
    );
    await dispatcher.afterInit();
    const peer = socket();
    await dispatcher.open(peer);
    await dispatcher.close(peer);
    expect(events).toEqual(["init", "open", "close"]);
  });

  test("refuses a socket a guard denies", async () => {
    const deny: CanActivate = { canActivate: () => false };
    const dispatcher = createGatewayDispatcher({}, plan(), [deny]);
    const peer = socket();
    await dispatcher.open(peer);
    expect(peer.closed).toEqual([{ code: 1008, reason: "Forbidden" }]);
  });

  test("answers invalid envelopes and unknown events", async () => {
    const dispatcher = createGatewayDispatcher({}, plan(), []);
    const peer = socket();

    await dispatcher.message(peer, "{not json");
    await dispatcher.message(peer, JSON.stringify({ event: "" }));
    await dispatcher.message(peer, JSON.stringify({ event: "missing", data: 1 }));

    expect(peer.emitted.map((entry) => (entry.data as { code: string }).code)).toEqual([
      "INVALID_WEBSOCKET_MESSAGE",
      "UNKNOWN_WEBSOCKET_EVENT",
      "UNKNOWN_WEBSOCKET_EVENT",
    ]);
  });

  test("emits an ordinary result, a WsResponse, and preserves falsy values", async () => {
    const dispatcher = createGatewayDispatcher(
      {
        plain: () => "value",
        response: () => ({ event: "other", data: "chosen" }),
        nothing: () => undefined,
        zero: () => 0,
      },
      plan([
        { event: "plain", propertyKey: "plain", parameters: [] },
        { event: "response", propertyKey: "response", parameters: [] },
        { event: "nothing", propertyKey: "nothing", parameters: [] },
        { event: "zero", propertyKey: "zero", parameters: [] },
      ]),
      [],
    );
    const peer = socket();

    await dispatcher.message(peer, JSON.stringify({ event: "plain", data: 1 }));
    await dispatcher.message(peer, JSON.stringify({ event: "response", data: 1 }));
    await dispatcher.message(peer, JSON.stringify({ event: "nothing", data: 1 }));
    await dispatcher.message(peer, JSON.stringify({ event: "zero", data: 1 }));

    expect(peer.emitted).toEqual([
      { event: "plain", data: "value" },
      { event: "other", data: "chosen" },
      { event: "zero", data: 0 },
    ]);
  });

  test("binds message body properties and the connected socket", async () => {
    let seen: unknown;
    const dispatcher = createGatewayDispatcher(
      {
        handler: (...args: unknown[]) => {
          seen = args;
          return "ok";
        },
      },
      plan([
        {
          event: "read",
          propertyKey: "handler",
          parameters: [
            { index: 0, kind: "message-body", property: "name" },
            { index: 1, kind: "connected-socket", property: undefined },
          ],
        },
      ]),
      [],
    );
    const peer = socket();
    await dispatcher.message(peer, JSON.stringify({ event: "read", data: { name: "ada" } }));
    expect(seen).toEqual(["ada", peer]);
  });

  test("reports a missing handler and a handler failure without leaking it", async () => {
    const dispatcher = createGatewayDispatcher(
      {
        boom: () => {
          throw new AponiaError("INVALID_WEBSOCKET_MESSAGE", "bad");
        },
        plainBoom: () => {
          throw new Error("secret");
        },
      },
      plan([
        { event: "missing", propertyKey: "absent", parameters: [] },
        { event: "boom", propertyKey: "boom", parameters: [] },
        { event: "plainBoom", propertyKey: "plainBoom", parameters: [] },
      ]),
      [],
    );
    const peer = socket();

    await dispatcher.message(peer, JSON.stringify({ event: "missing", data: 1 }));
    await dispatcher.message(peer, JSON.stringify({ event: "boom", data: 1 }));
    await dispatcher.message(peer, JSON.stringify({ event: "plainBoom", data: 1 }));

    const codes = peer.emitted.map((entry) => (entry.data as { code: string }).code);
    expect(codes).toEqual([
      "WEBSOCKET_HANDLER_ERROR",
      "INVALID_WEBSOCKET_MESSAGE",
      "WEBSOCKET_HANDLER_ERROR",
    ]);
    expect(JSON.stringify(peer.emitted)).not.toContain("secret");
  });

  test("exposes the socket to a guard and refuses an unassignable server property", async () => {
    const guard: CanActivate = {
      canActivate: (context) => {
        const http = context.switchToHttp().getRequest() as { readonly request: Request };
        expect(http.request).toBeInstanceOf(Request);
        expect(typeof context.getClass()).toBe("function");
        expect(typeof context.getHandler()).toBe("function");
        expect(context.switchToWs().getPattern()).toBe("/ws");
        return true;
      },
    };
    const dispatcher = createGatewayDispatcher({}, plan(), [guard]);
    const peer = socket();
    await dispatcher.open(peer);
    expect(peer.closed).toEqual([]);

    expect(() => injectGatewayServer(Object.freeze({}), ["server"], { emit() {} })).toThrow();
  });

  test("a throwing guard closes the socket and refuses later messages", async () => {
    const guard: CanActivate = {
      canActivate: () => {
        throw new Error("guard failed");
      },
    };
    let runs = 0;
    const dispatcher = createGatewayDispatcher(
      {
        ping: () => {
          runs += 1;
          return "pong";
        },
      },
      plan([{ event: "ping", propertyKey: "ping", parameters: [] }]),
      [guard],
    );
    const peer = socket();

    await dispatcher.open(peer);
    expect(peer.closed[0]).toEqual({ code: 1008, reason: "Forbidden" });

    await dispatcher.message(peer, JSON.stringify({ event: "ping", data: 1 }));
    expect(runs).toBe(0);
    expect(peer.closed.at(-1)).toEqual({ code: 1008, reason: "Forbidden" });
  });

  test("emits null and false as values", async () => {
    const dispatcher = createGatewayDispatcher(
      { nil: () => null, no: () => false },
      plan([
        { event: "nil", propertyKey: "nil", parameters: [] },
        { event: "no", propertyKey: "no", parameters: [] },
      ]),
      [],
    );
    const peer = socket();
    await dispatcher.message(peer, JSON.stringify({ event: "nil", data: 1 }));
    await dispatcher.message(peer, JSON.stringify({ event: "no", data: 1 }));
    expect(peer.emitted).toEqual([
      { event: "nil", data: null },
      { event: "no", data: false },
    ]);
  });

  test("broadcasts to every connected peer", async () => {
    const dispatcher = createGatewayDispatcher({}, plan(), []);
    const first = socket("a");
    const second = socket("b");
    await dispatcher.open(first);
    await dispatcher.open(second);

    dispatcher.server.emit("news", { at: 1 });
    dispatcher.broadcast?.("news", { at: 2 });

    expect(first.emitted).toEqual([
      { event: "raw", data: JSON.stringify({ event: "news", data: { at: 1 } }) },
      { event: "raw", data: JSON.stringify({ event: "news", data: { at: 2 } }) },
    ]);
    expect(second.emitted).toHaveLength(2);
    await dispatcher.close(first);
    dispatcher.server.emit("news", { at: 3 });
    expect(first.emitted).toHaveLength(2);
    expect(second.emitted).toHaveLength(3);
  });
});

describe("gateway dispatcher parity", () => {
  const nameValidator = {
    "~standard": {
      version: 1,
      vendor: "gateway-parity",
      validate(value: unknown) {
        if (
          typeof value === "object" &&
          value !== null &&
          typeof (value as { readonly name?: unknown }).name === "string"
        ) {
          return { value };
        }
        return { issues: [{ message: "name must be a string" }] };
      },
    },
  } as never;

  const echoPlan = (extra: Record<string, unknown> = {}) =>
    plan([
      {
        event: "echo",
        propertyKey: "echo",
        parameters: [],
        ...extra,
      },
    ]);

  function emitted(peer: ReturnType<typeof socket>) {
    return peer.emitted.filter((frame) => frame.event !== "raw");
  }

  test("refuses a message above the plan's payload limit", async () => {
    const dispatcher = createGatewayDispatcher(
      { echo: () => "ok" },
      Object.freeze({ ...echoPlan(), maxPayloadLength: 4 }),
      [],
    );
    const peer = socket();
    await dispatcher.message(peer, JSON.stringify({ event: "echo", data: "too long" }));

    expect(emitted(peer)).toEqual([
      {
        event: "exception",
        data: { code: "INVALID_WEBSOCKET_MESSAGE", message: expect.any(String) },
      },
    ]);
  });

  test("validates a declared payload schema before the handler runs", async () => {
    let calls = 0;
    const dispatcher = createGatewayDispatcher(
      {
        echo: (data: unknown) => {
          calls += 1;
          return data;
        },
      },
      echoPlan({
        schema: { data: nameValidator },
        parameters: [{ index: 0, kind: "message-body" }],
      }),
      [],
    );
    const invalid = socket();
    await dispatcher.message(invalid, JSON.stringify({ event: "echo", data: { name: 1 } }));
    expect(emitted(invalid)[0]?.data).toMatchObject({ code: "INVALID_WEBSOCKET_MESSAGE" });
    expect(calls).toBe(0);

    const valid = socket();
    await dispatcher.message(valid, JSON.stringify({ event: "echo", data: { name: "Ada" } }));
    expect(calls).toBe(1);
    expect(emitted(valid)).toEqual([{ event: "echo", data: { name: "Ada" } }]);
  });

  test("answers a failure through the gateway filter", async () => {
    const dispatcher = createGatewayDispatcher(
      {
        echo: () => {
          throw new Error("boom");
        },
      },
      echoPlan(),
      [],
      new Map([
        [
          "echo",
          [
            {
              instance: { catch: () => ({ handled: true }) },
              exceptions: [],
            },
          ],
        ],
      ]),
    );
    const peer = socket();
    await dispatcher.message(peer, JSON.stringify({ event: "echo", data: null }));

    expect(emitted(peer)).toEqual([{ event: "echo", data: { handled: true } }]);
  });

  test("falls back to the standard exception frame when the filter declines", async () => {
    const dispatcher = createGatewayDispatcher(
      {
        echo: () => {
          throw new Error("boom");
        },
      },
      echoPlan(),
      [],
      new Map([["echo", [{ instance: { catch: () => undefined }, exceptions: [] }]]]),
    );
    const peer = socket();
    await dispatcher.message(peer, JSON.stringify({ event: "echo", data: null }));

    expect(emitted(peer)[0]?.data).toMatchObject({ code: "WEBSOCKET_HANDLER_ERROR" });
  });

  test("streams an async generator under the subscribed event", async () => {
    const dispatcher = createGatewayDispatcher(
      {
        echo: async function* () {
          yield 1;
          yield 2;
        },
      },
      echoPlan(),
      [],
    );
    const peer = socket();
    await dispatcher.message(peer, JSON.stringify({ event: "echo", data: null }));

    expect(emitted(peer)).toEqual([
      { event: "echo", data: 1 },
      { event: "echo", data: 2 },
    ]);
  });

  test("streams a sync iterator and preserves falsy values", async () => {
    const dispatcher = createGatewayDispatcher(
      {
        echo: function* () {
          yield 0;
          yield false;
          yield null;
          yield undefined;
        },
      },
      echoPlan(),
      [],
    );
    const peer = socket();
    await dispatcher.message(peer, JSON.stringify({ event: "echo", data: null }));

    expect(emitted(peer)).toEqual([
      { event: "echo", data: 0 },
      { event: "echo", data: false },
      { event: "echo", data: null },
    ]);
  });
});

describe("gateway dispatcher uncovered branches", () => {
  const echoPlan = plan([{ event: "echo", propertyKey: "echo", parameters: [] }]);

  test("skips a filter whose @Catch() list does not match", async () => {
    const dispatcher = createGatewayDispatcher(
      {
        echo: () => {
          throw new Error("boom");
        },
      },
      echoPlan,
      [],
      new Map([["echo", [{ instance: { catch: () => "not reached" }, exceptions: [TypeError] }]]]),
    );
    const peer = socket();
    await dispatcher.message(peer, JSON.stringify({ event: "echo", data: null }));

    expect(peer.emitted[0]?.data).toMatchObject({ code: "WEBSOCKET_HANDLER_ERROR" });
  });

  test("declines a filter that throws and answers the standard frame", async () => {
    const dispatcher = createGatewayDispatcher(
      {
        echo: () => {
          throw new Error("boom");
        },
      },
      echoPlan,
      [],
      new Map([
        [
          "echo",
          [
            {
              instance: {
                catch: () => {
                  throw new Error("filter refused");
                },
              },
              exceptions: [],
            },
          ],
        ],
      ]),
    );
    const peer = socket();
    await dispatcher.message(peer, JSON.stringify({ event: "echo", data: null }));

    expect(peer.emitted[0]?.data).toMatchObject({ code: "WEBSOCKET_HANDLER_ERROR" });
  });

  test("measures every frame shape against the payload limit", async () => {
    const dispatcher = createGatewayDispatcher(
      { echo: () => "ok" },
      Object.freeze({ ...echoPlan, maxPayloadLength: 1 }),
      [],
    );

    for (const raw of [new ArrayBuffer(8), new Uint8Array(8), { event: "echo", data: null }]) {
      const peer = socket();
      await dispatcher.message(peer, raw);
      expect(peer.emitted[0]?.data).toMatchObject({ code: "INVALID_WEBSOCKET_MESSAGE" });
    }

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    for (const raw of [circular, 5]) {
      const peer = socket();
      await dispatcher.message(peer, raw);
      expect(peer.emitted[0]?.data).toMatchObject({ code: "INVALID_WEBSOCKET_MESSAGE" });
    }
  });
});
