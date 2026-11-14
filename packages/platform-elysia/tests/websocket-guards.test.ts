import { describe, expect, test } from "bun:test";
import {
  Injectable,
  MessageBody,
  Module,
  SubscribeMessage,
  WebSocketGateway,
  type CanActivate,
  type ExecutionContext,
  type OnGatewayConnection,
  type WsResponse,
} from "@aponiajs/common";
import { AponiaFactory } from "../src/application/aponia-factory.ts";
import { defineWebSocketGateway } from "../src/websockets/gateway-definition.ts";
import type { WebSocketClient } from "../src/websockets/websocket-gateway.types.ts";

interface MockClient extends WebSocketClient {
  sent: unknown[];
}

let connectionCount = 0;

@Injectable()
class HandshakeAuthGuard implements CanActivate {
  canActivate(execution: ExecutionContext): boolean {
    const request = execution.switchToHttp().getRequest().request;
    const authHeader = request.headers.get("authorization");
    return authHeader === "Bearer secret-token";
  }
}

@WebSocketGateway({
  path: "/guarded-ws",
  guards: [HandshakeAuthGuard],
  maxPayloadLength: 100,
})
class GuardedGateway implements OnGatewayConnection<WebSocketClient> {
  handleConnection(_client: WebSocketClient) {
    connectionCount += 1;
  }

  @SubscribeMessage("ping")
  ping(@MessageBody("text") text: string): WsResponse<{ pong: string }> {
    return {
      event: "pong",
      data: { pong: text },
    };
  }
}

class DeclaredGuardedGateway implements OnGatewayConnection<WebSocketClient> {
  handleConnection(_client: WebSocketClient) {
    connectionCount += 1;
  }

  ping(text: string): WsResponse<{ pong: string }> {
    return {
      event: "pong",
      data: { pong: text },
    };
  }
}

const declaredGateway = defineWebSocketGateway(DeclaredGuardedGateway, {
  path: "/declared-guarded-ws",
  guards: [HandshakeAuthGuard],
  maxPayloadLength: 100,
  handlers: [
    {
      event: "ping",
      propertyKey: "ping",
      parameters: [{ index: 0, kind: "message-body", property: "text" }],
    },
  ],
});

@Module({
  providers: [GuardedGateway, declaredGateway, HandshakeAuthGuard],
})
class GuardedModule {}

describe("WebSocket gateway handshake guards and payload limits", () => {
  test("refuses unauthorized HTTP upgrade request with 403 before socket upgrades", async () => {
    connectionCount = 0;
    const app = await AponiaFactory.create(GuardedModule, { logger: false });

    // Request without authorization header
    const response = await app.handle(
      new Request("http://localhost/guarded-ws", {
        headers: {
          upgrade: "websocket",
        },
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(connectionCount).toBe(0);
  });

  test("allows authorized HTTP upgrade request past the handshake guard", async () => {
    connectionCount = 0;
    const app = await AponiaFactory.create(GuardedModule, { logger: false });

    const wsRoute = (app as any)
      .getNativeApplication()
      .routes.find((r: any) => r.path === "/guarded-ws" && r.method === "WS");
    expect(wsRoute).toBeDefined();

    // Verify beforeHandle directly allows valid authorization
    const mockContext = {
      request: new Request("http://localhost/guarded-ws", {
        headers: {
          upgrade: "websocket",
          authorization: "Bearer secret-token",
        },
      }),
    };

    const beforeResult = await wsRoute.hooks.beforeHandle(mockContext);
    expect(beforeResult).toBeUndefined();
  });

  test("enforces maxPayloadLength on incoming message frames", async () => {
    const app = await AponiaFactory.create(GuardedModule, { logger: false });
    const sent: unknown[] = [];
    const client: MockClient = {
      id: "client-guard-1",
      sent,
      send(message: unknown) {
        sent.push(message);
      },
    } as unknown as MockClient;

    const wsRoute = (app as any)
      .getNativeApplication()
      .routes.find((r: any) => r.path === "/guarded-ws" && r.method === "WS");

    // Message under 100 bytes -> accepted
    await wsRoute.hooks.message(client, {
      event: "ping",
      data: { text: "small" },
    });

    expect(client.sent).toHaveLength(1);
    expect(client.sent[0]).toEqual({
      event: "pong",
      data: { pong: "small" },
    });

    // Message over 100 bytes -> rejected with exception frame
    const largeText = "x".repeat(150);
    await wsRoute.hooks.message(
      client,
      JSON.stringify({
        event: "ping",
        data: { text: largeText },
      }),
    );

    expect(client.sent).toHaveLength(2);
    expect(client.sent[1]).toEqual({
      event: "exception",
      data: {
        code: "INVALID_WEBSOCKET_MESSAGE",
        message: "WebSocket message exceeds the maximum payload limit of 100 bytes.",
      },
    });
  });

  test("declared gateway with defineWebSocketGateway enforces handshake guards", async () => {
    const app = await AponiaFactory.create(GuardedModule, { logger: false });

    // Request without authorization header
    const response = await app.handle(
      new Request("http://localhost/declared-guarded-ws", {
        headers: {
          upgrade: "websocket",
        },
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });
});
