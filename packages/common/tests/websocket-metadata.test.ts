import { describe, expect, test } from "bun:test";
import {
  SubscribeMessage,
  WebSocketGateway,
  getWebSocketGatewayMetadata,
  getWebSocketMessageMetadata,
  type CanActivate,
} from "../src/index.ts";

class MockGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

describe("WebSocket gateway and message schema metadata", () => {
  test("@SubscribeMessage records message schema when provided", () => {
    const mockValidator = {
      "~standard": { version: 1, vendor: "test", validate: () => ({ value: 1 }) },
    };

    class SchemaGateway {
      @SubscribeMessage("chat.message", { data: mockValidator })
      handle(_data: unknown) {}
    }

    const messages = getWebSocketMessageMetadata(SchemaGateway);
    expect(messages).toHaveLength(1);
    expect(messages[0].event).toBe("chat.message");
    expect(messages[0].propertyKey).toBe("handle");
    expect(messages[0].schema).toEqual({ data: mockValidator });
    expect(Object.isFrozen(messages[0].schema)).toBe(true);
  });

  test("@SubscribeMessage rejects invalid schema object", () => {
    expect(() => {
      class InvalidGateway {
        @SubscribeMessage("chat.message", "not-a-schema" as never)
        handle(_data: unknown) {}
      }
      void InvalidGateway;
    }).toThrow(TypeError);
  });

  test("@WebSocketGateway records guards and maxPayloadLength", () => {
    @WebSocketGateway({
      path: "/chat",
      guards: [MockGuard],
      maxPayloadLength: 65536,
      origins: ["https://app.example"],
      idleTimeoutMs: 30_000,
      sendPings: true,
    })
    class SecureGateway {}

    const metadata = getWebSocketGatewayMetadata(SecureGateway);
    expect(metadata).toEqual({
      path: "/chat",
      guards: [MockGuard],
      maxPayloadLength: 65536,
      origins: ["https://app.example"],
      idleTimeoutMs: 30_000,
      sendPings: true,
    });
    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.isFrozen(metadata?.guards)).toBe(true);
    expect(Object.isFrozen(metadata?.origins)).toBe(true);
  });

  test("@WebSocketGateway rejects invalid maxPayloadLength and guards", () => {
    expect(() => {
      @WebSocketGateway({ maxPayloadLength: -1 })
      class InvalidLengthGateway {}
      void InvalidLengthGateway;
    }).toThrow(TypeError);

    expect(() => {
      @WebSocketGateway({ guards: "not-an-array" as never })
      class InvalidGuardsGateway {}
      void InvalidGuardsGateway;
    }).toThrow(TypeError);

    expect(() => {
      @WebSocketGateway({ guards: ["not-a-class" as never] })
      class InvalidGuardItemGateway {}
      void InvalidGuardItemGateway;
    }).toThrow(TypeError);

    expect(() => {
      @WebSocketGateway({ origins: "not-an-array" as never })
      class InvalidOriginsGateway {}
      void InvalidOriginsGateway;
    }).toThrow(TypeError);

    expect(() => {
      @WebSocketGateway({ origins: [] })
      class EmptyOriginsGateway {}
      void EmptyOriginsGateway;
    }).toThrow(TypeError);

    expect(() => {
      @WebSocketGateway({ origins: ["" as never] })
      class BlankOriginGateway {}
      void BlankOriginGateway;
    }).toThrow(TypeError);

    expect(() => {
      @WebSocketGateway({ idleTimeoutMs: 0 })
      class InvalidIdleGateway {}
      void InvalidIdleGateway;
    }).toThrow(TypeError);

    expect(() => {
      @WebSocketGateway({ sendPings: "yes" as never })
      class InvalidPingsGateway {}
      void InvalidPingsGateway;
    }).toThrow(TypeError);
  });
});
