import { describe, expect, test } from "bun:test";
import {
  ConnectedSocket,
  MessageBody,
  Module,
  SubscribeMessage,
  Validation,
  WebSocketGateway,
  type WsResponse,
} from "@aponiajs/common";
import { t } from "elysia";
import { AponiaFactory } from "../src/application/aponia-factory.ts";
import { defineWebSocketGateway } from "../src/websockets/gateway-definition.ts";
import type { WebSocketClient } from "../src/websockets/websocket-gateway.types.ts";

interface MockClient extends WebSocketClient {
  sent: unknown[];
}

interface StandardSchemaMock {
  "~standard": {
    version: 1;
    vendor: string;
    validate: (value: unknown) => { value: unknown } | { issues: readonly { message: string }[] };
  };
}

const standardSchema: StandardSchemaMock = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value: unknown) => {
      if (
        typeof value === "object" &&
        value !== null &&
        "text" in value &&
        typeof (value as { text: unknown }).text === "string"
      ) {
        return { value: value as { text: string } };
      }
      return { issues: [{ message: "text must be a string" }] };
    },
  },
};

const typeboxSchema = t.Object({
  count: t.Number(),
});

@Validation(standardSchema)
class MessageModel {}

let handlerCallCount = 0;

@WebSocketGateway("/validation-ws")
class ValidationGateway {
  @SubscribeMessage("standard.event", { data: standardSchema })
  handleStandard(
    @MessageBody("text") text: string,
    @ConnectedSocket() _socket: WebSocketClient,
  ): WsResponse<{ echo: string }> {
    handlerCallCount += 1;
    return {
      event: "standard.reply",
      data: { echo: text },
    };
  }

  @SubscribeMessage("typebox.event", { data: typeboxSchema })
  handleTypebox(@MessageBody("count") count: number): WsResponse<{ doubled: number }> {
    handlerCallCount += 1;
    return {
      event: "typebox.reply",
      data: { doubled: count * 2 },
    };
  }

  @SubscribeMessage("model.event", { data: MessageModel })
  handleModel(@MessageBody("text") text: string): WsResponse<{ ok: boolean }> {
    handlerCallCount += 1;
    return {
      event: "model.reply",
      data: { ok: text.length > 0 },
    };
  }
}

class DeclaredValidationGateway {
  handleDeclared(data: { count: number }) {
    handlerCallCount += 1;
    return {
      event: "declared.reply",
      data: { result: data.count + 1 },
    };
  }
}

const declaredGatewayProvider = defineWebSocketGateway(DeclaredValidationGateway, {
  path: "/declared-ws",
  handlers: [
    {
      event: "declared.event",
      schema: { data: typeboxSchema },
      propertyKey: "handleDeclared",
      parameters: [{ index: 0, kind: "message-body", property: undefined }],
    },
  ],
});

@Module({
  providers: [ValidationGateway, declaredGatewayProvider],
})
class ValidationModule {}

describe("WebSocket gateway per-message schema validation", () => {
  test("accepts valid Standard Schema payload and sends response", async () => {
    handlerCallCount = 0;
    const app = await AponiaFactory.create(ValidationModule, { logger: false });
    const sent: unknown[] = [];
    const client: MockClient = {
      id: "client-1",
      sent,
      send(message: unknown) {
        sent.push(message);
      },
    } as unknown as MockClient;

    // Simulate sending message to the bound gateway
    const wsRoute = (app as any)
      .getNativeApplication()
      .routes.find((r: any) => r.path === "/validation-ws" && r.method === "WS");
    expect(wsRoute).toBeDefined();

    await wsRoute.hooks.message(client, {
      event: "standard.event",
      data: { text: "hello standard" },
    });

    expect(handlerCallCount).toBe(1);
    expect(client.sent).toHaveLength(1);
    expect(client.sent[0]).toEqual({
      event: "standard.reply",
      data: { echo: "hello standard" },
    });
  });

  test("rejects invalid Standard Schema payload with exception frame and does not invoke handler", async () => {
    handlerCallCount = 0;
    const app = await AponiaFactory.create(ValidationModule, { logger: false });
    const sent: unknown[] = [];
    const client: MockClient = {
      id: "client-2",
      sent,
      send(message: unknown) {
        sent.push(message);
      },
    } as unknown as MockClient;

    const wsRoute = (app as any)
      .getNativeApplication()
      .routes.find((r: any) => r.path === "/validation-ws" && r.method === "WS");

    await wsRoute.hooks.message(client, {
      event: "standard.event",
      data: { text: 12345 },
    });

    expect(handlerCallCount).toBe(0);
    expect(client.sent).toHaveLength(1);
    expect(client.sent[0]).toEqual({
      event: "exception",
      data: {
        code: "INVALID_WEBSOCKET_MESSAGE",
        message: "Invalid WebSocket message data.",
      },
    });
  });

  test("validates TypeBox schema and rejects invalid payload", async () => {
    handlerCallCount = 0;
    const app = await AponiaFactory.create(ValidationModule, { logger: false });
    const sent: unknown[] = [];
    const client: MockClient = {
      id: "client-3",
      sent,
      send(message: unknown) {
        sent.push(message);
      },
    } as unknown as MockClient;

    const wsRoute = (app as any)
      .getNativeApplication()
      .routes.find((r: any) => r.path === "/validation-ws" && r.method === "WS");

    // Valid
    await wsRoute.hooks.message(client, {
      event: "typebox.event",
      data: { count: 21 },
    });
    expect(handlerCallCount).toBe(1);
    expect(client.sent[0]).toEqual({
      event: "typebox.reply",
      data: { doubled: 42 },
    });

    // Invalid
    await wsRoute.hooks.message(client, {
      event: "typebox.event",
      data: { count: "not a number" },
    });
    expect(handlerCallCount).toBe(1); // not incremented
    expect(client.sent[1]).toEqual({
      event: "exception",
      data: {
        code: "INVALID_WEBSOCKET_MESSAGE",
        message: "Invalid WebSocket message data.",
      },
    });
  });

  test("validates @Validation() model class", async () => {
    handlerCallCount = 0;
    const app = await AponiaFactory.create(ValidationModule, { logger: false });
    const sent: unknown[] = [];
    const client: MockClient = {
      id: "client-4",
      sent,
      send(message: unknown) {
        sent.push(message);
      },
    } as unknown as MockClient;

    const wsRoute = (app as any)
      .getNativeApplication()
      .routes.find((r: any) => r.path === "/validation-ws" && r.method === "WS");

    await wsRoute.hooks.message(client, {
      event: "model.event",
      data: { text: "valid model" },
    });
    expect(handlerCallCount).toBe(1);

    await wsRoute.hooks.message(client, {
      event: "model.event",
      data: { text: null },
    });
    expect(handlerCallCount).toBe(1);
    expect(client.sent[1]).toEqual({
      event: "exception",
      data: {
        code: "INVALID_WEBSOCKET_MESSAGE",
        message: "Invalid WebSocket message data.",
      },
    });
  });

  test("validates declared gateway schema with defineWebSocketGateway", async () => {
    handlerCallCount = 0;
    const app = await AponiaFactory.create(ValidationModule, { logger: false });
    const sent: unknown[] = [];
    const client: MockClient = {
      id: "client-5",
      sent,
      send(message: unknown) {
        sent.push(message);
      },
    } as unknown as MockClient;

    const wsRoute = (app as any)
      .getNativeApplication()
      .routes.find((r: any) => r.path === "/declared-ws" && r.method === "WS");

    await wsRoute.hooks.message(client, {
      event: "declared.event",
      data: { count: 9 },
    });
    expect(handlerCallCount).toBe(1);
    expect(client.sent[0]).toEqual({
      event: "declared.reply",
      data: { result: 10 },
    });

    await wsRoute.hooks.message(client, {
      event: "declared.event",
      data: { count: "invalid" },
    });
    expect(handlerCallCount).toBe(1);
    expect(client.sent[1]).toEqual({
      event: "exception",
      data: {
        code: "INVALID_WEBSOCKET_MESSAGE",
        message: "Invalid WebSocket message data.",
      },
    });
  });
});
