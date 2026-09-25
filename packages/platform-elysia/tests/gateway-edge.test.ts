import { expect, test } from "bun:test";
import { MessageBody, Module, SubscribeMessage, WebSocketGateway } from "@aponiajs/common";
import { createContainer } from "@aponiajs/core";
import { AponiaFactory, compileRootModule, type ElysiaWebSocket } from "../src/index.ts";
import {
  bindElysiaWebSocketGateway,
  compileElysiaWebSocketGateways,
} from "../src/websockets/websocket-gateway.ts";

class RecordingSocket {
  readonly sent: unknown[] = [];

  send(data: unknown): number {
    this.sent.push(data);
    return 1;
  }
}

@WebSocketGateway("/edge")
class EdgeGateway {
  @SubscribeMessage("data-only")
  dataOnly(): unknown {
    return { data: "payload" };
  }

  @SubscribeMessage("empty-event")
  emptyEvent(): unknown {
    return { event: "   ", data: "payload" };
  }

  @SubscribeMessage("non-string-event")
  nonStringEvent(): unknown {
    return { event: 42, data: "payload" };
  }

  @SubscribeMessage("event-only")
  eventOnly(): unknown {
    return { event: "redirected" };
  }

  @SubscribeMessage("array")
  array(): readonly number[] {
    return [1, 2];
  }

  @SubscribeMessage("property")
  property(@MessageBody("value") value: unknown): unknown {
    return value;
  }

  @SubscribeMessage("stream")
  *stream(): Generator<number> {
    yield 1;
    throw new Error("private stream detail");
  }
}

@Module({ providers: [EdgeGateway] })
class EdgeGatewayModule {}

function bindEdgeGateway(recording: RecordingSocket): {
  readonly send: (message: unknown) => Promise<void>;
} {
  const module = compileRootModule(EdgeGatewayModule);
  const gateway = compileElysiaWebSocketGateways([module])[0];
  if (!gateway) {
    throw new Error("Expected one compiled gateway.");
  }

  const bound = bindElysiaWebSocketGateway(
    gateway,
    createContainer(module).resolveModuleProvider(module, EdgeGateway),
  );
  const socket = recording as unknown as ElysiaWebSocket;

  return {
    send: async (message: unknown) => {
      await bound.message(socket, message);
    },
  };
}

test("emits an object result without a recognized response event as subscribed data", async () => {
  const recording = new RecordingSocket();
  const edge = bindEdgeGateway(recording);

  await edge.send({ event: "data-only" });
  await edge.send({ event: "empty-event" });
  await edge.send({ event: "non-string-event" });
  await edge.send({ event: "event-only" });
  await edge.send({ event: "array" });

  expect(recording.sent).toEqual([
    { event: "data-only", data: { data: "payload" } },
    { event: "empty-event", data: { event: "   ", data: "payload" } },
    { event: "non-string-event", data: { event: 42, data: "payload" } },
    { event: "event-only", data: { event: "redirected" } },
    { event: "array", data: [1, 2] },
  ]);
  expect(recording.sent.every(Object.isFrozen)).toBe(true);
});

test("binds a named message property only when the payload is an object", async () => {
  const recording = new RecordingSocket();
  const edge = bindEdgeGateway(recording);

  await edge.send({ event: "property", data: "plain text" });
  await edge.send({ event: "property", data: 7 });
  await edge.send({ event: "property", data: null });
  await edge.send({ event: "property", data: { other: true } });
  await edge.send({ event: "property", data: { value: 0 } });

  expect(recording.sent).toEqual([{ event: "property", data: 0 }]);
});

test("sends one exception frame when a stream fails after emitting", async () => {
  const recording = new RecordingSocket();
  const edge = bindEdgeGateway(recording);

  await edge.send({ event: "stream" });

  expect(recording.sent).toEqual([
    { event: "stream", data: 1 },
    {
      event: "exception",
      data: {
        code: "WEBSOCKET_HANDLER_ERROR",
        message: "The WebSocket handler failed.",
      },
    },
  ]);
  expect(JSON.stringify(recording.sent)).not.toContain("private stream detail");
});

@WebSocketGateway("/edge-alpha")
class AlphaEdgeGateway {
  @SubscribeMessage("alpha.event")
  read(): string {
    return "alpha";
  }
}

@WebSocketGateway("/edge-beta")
class BetaEdgeGateway {
  @SubscribeMessage("beta.event")
  read(): string {
    return "beta";
  }
}

@Module({ providers: [AlphaEdgeGateway, BetaEdgeGateway] })
class GatewayPairModule {}

test("keeps each gateway's events isolated while mounting one native route per gateway", async () => {
  const application = await AponiaFactory.create(GatewayPairModule, { logger: false });
  const module = compileRootModule(GatewayPairModule);
  const alpha = compileElysiaWebSocketGateways([module]).find(
    (gateway) => gateway.path === "/edge-alpha",
  );
  const recording = new RecordingSocket();
  const socket = recording as unknown as ElysiaWebSocket;

  expect(
    application
      .getNativeApplication()
      .routes.filter((route) => route.method === "WS")
      .map((route) => route.path)
      .toSorted(),
  ).toEqual(["/edge-alpha", "/edge-beta"]);

  if (!alpha) {
    throw new Error("Expected a compiled /edge-alpha gateway.");
  }

  const bound = bindElysiaWebSocketGateway(
    alpha,
    createContainer(module).resolveModuleProvider(module, AlphaEdgeGateway),
  );
  await bound.message(socket, { event: "beta.event" });
  await bound.message(socket, { event: "alpha.event" });

  expect(recording.sent).toEqual([
    {
      event: "exception",
      data: {
        code: "UNKNOWN_WEBSOCKET_EVENT",
        message: "No WebSocket handler is registered for this event.",
      },
    },
    { event: "alpha.event", data: "alpha" },
  ]);
  await application.close();
});
