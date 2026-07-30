import { expect, test } from "bun:test";
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  getWebSocketGatewayMetadata,
  getWebSocketMessageMetadata,
  getWebSocketParameterMetadata,
  getWebSocketServerProperties,
  type AponiaErrorCode,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  type WsResponse,
} from "../src/index.ts";

const messageMethod = Symbol("message-method");
const serverProperty = Symbol("server-property");

class DefaultGateway {
  handleEvent(_body: unknown, _client: unknown): string {
    return "handled";
  }

  [messageMethod](_body: unknown): string {
    return "symbol-handled";
  }
}

WebSocketGateway()(DefaultGateway);
SubscribeMessage("events")(
  DefaultGateway.prototype,
  "handleEvent",
  Object.getOwnPropertyDescriptor(DefaultGateway.prototype, "handleEvent")!,
);
MessageBody("id")(DefaultGateway.prototype, "handleEvent", 1);
ConnectedSocket()(DefaultGateway.prototype, "handleEvent", 0);
SubscribeMessage("symbol-event")(
  DefaultGateway.prototype,
  messageMethod,
  Object.getOwnPropertyDescriptor(DefaultGateway.prototype, messageMethod)!,
);
MessageBody()(DefaultGateway.prototype, messageMethod, 0);
WebSocketServer()(DefaultGateway.prototype, "server");
WebSocketServer()(DefaultGateway.prototype, serverProperty);
WebSocketServer()(DefaultGateway.prototype, serverProperty);

test("records the default WebSocket gateway path as immutable own metadata", () => {
  const metadata = getWebSocketGatewayMetadata(DefaultGateway);

  expect(metadata).toEqual({ path: "/ws" });
  expect(Object.isFrozen(metadata)).toBe(true);
  expect(
    Reflect.getOwnMetadata(Symbol.for("aponia.websocket-gateway.metadata"), DefaultGateway),
  ).toBe(metadata);

  class ChildGateway extends DefaultGateway {}

  expect(getWebSocketGatewayMetadata(ChildGateway)).toBeUndefined();
});

test("supports string and options gateway overloads without retaining caller state", () => {
  class StringPathGateway {}
  class OptionsGateway {}
  const options = { path: "/notifications" };

  WebSocketGateway("/events")(StringPathGateway);
  WebSocketGateway(options)(OptionsGateway);
  options.path = "/changed";

  expect(getWebSocketGatewayMetadata(StringPathGateway)).toEqual({ path: "/events" });
  expect(getWebSocketGatewayMetadata(OptionsGateway)).toEqual({ path: "/notifications" });
});

test("returns frozen message metadata with string and symbol method keys", () => {
  const messages = getWebSocketMessageMetadata(DefaultGateway);

  expect(messages).toEqual([
    { event: "events", propertyKey: "handleEvent" },
    { event: "symbol-event", propertyKey: messageMethod },
  ]);
  expect(Object.isFrozen(messages)).toBe(true);
  expect(messages.every(Object.isFrozen)).toBe(true);
  expect(getWebSocketMessageMetadata(class EmptyGateway {})).toEqual([]);
  expect(Object.isFrozen(getWebSocketMessageMetadata(class EmptyGateway {}))).toBe(true);

  class ChildGateway extends DefaultGateway {}

  expect(getWebSocketMessageMetadata(ChildGateway)).toEqual([]);
});

test("returns isolated WebSocket parameters in stable positional order", () => {
  const parameters = getWebSocketParameterMetadata(DefaultGateway, "handleEvent");

  expect(parameters).toEqual([
    { index: 0, kind: "connected-socket", property: undefined },
    { index: 1, kind: "message-body", property: "id" },
  ]);
  expect(Object.isFrozen(parameters)).toBe(true);
  expect(parameters.every(Object.isFrozen)).toBe(true);
  expect(getWebSocketParameterMetadata(DefaultGateway, messageMethod)).toEqual([
    { index: 0, kind: "message-body", property: undefined },
  ]);
  expect(getWebSocketParameterMetadata(DefaultGateway, "missing")).toEqual([]);

  class ChildGateway extends DefaultGateway {}

  expect(getWebSocketParameterMetadata(ChildGateway, "handleEvent")).toEqual([]);
});

test("records frozen WebSocket server properties once and supports symbol keys", () => {
  const properties = getWebSocketServerProperties(DefaultGateway);

  expect(properties).toEqual(["server", serverProperty]);
  expect(Object.isFrozen(properties)).toBe(true);
  expect(
    Reflect.getOwnMetadata(
      Symbol.for("aponia.websocket-server-properties.metadata"),
      DefaultGateway.prototype,
    ),
  ).toEqual(["server", serverProperty]);

  class ChildGateway extends DefaultGateway {}

  expect(getWebSocketServerProperties(ChildGateway)).toEqual([]);
});

test("rejects invalid gateway and message decorator input before recording metadata", () => {
  expect(() => WebSocketGateway("")).toThrow(TypeError);
  expect(() => WebSocketGateway({ path: "" })).toThrow(
    "@WebSocketGateway path must be a non-empty string",
  );
  expect(() => WebSocketGateway({ path: 1 } as unknown as { path: string })).toThrow(TypeError);
  expect(() => (WebSocketGateway() as unknown as (target: object) => void)({})).toThrow(
    "@WebSocketGateway can only decorate a class",
  );
  expect(() => SubscribeMessage("")).toThrow(TypeError);
  expect(() => SubscribeMessage("   ")).toThrow(
    "@SubscribeMessage requires a non-empty event name",
  );
  expect(() => SubscribeMessage(1 as unknown as string)).toThrow(TypeError);
  expect(() =>
    (
      SubscribeMessage("field") as unknown as (
        target: object,
        propertyKey: string,
        descriptor: undefined,
      ) => void
    )(DefaultGateway.prototype, "field", undefined),
  ).toThrow("@SubscribeMessage can only decorate an instance method");

  class StaticGateway {
    static handle(): void {}
  }

  expect(() =>
    SubscribeMessage("static")(
      StaticGateway,
      "handle",
      Object.getOwnPropertyDescriptor(StaticGateway, "handle")!,
    ),
  ).toThrow("@SubscribeMessage can only decorate an instance method");
});

test("rejects parameter and server decorators outside supported instance members", () => {
  expect(() => MessageBody(1 as unknown as string)).toThrow(
    "@MessageBody property must be a string",
  );
  expect(() => MessageBody()(DefaultGateway.prototype, undefined, 0)).toThrow(
    "@MessageBody can only decorate an instance method parameter",
  );
  expect(() => ConnectedSocket()(DefaultGateway, "handleEvent", 0)).toThrow(
    "@ConnectedSocket can only decorate an instance method parameter",
  );
  expect(() => MessageBody()(DefaultGateway.prototype, "handleEvent", -1)).toThrow(TypeError);
  expect(() => WebSocketServer()(DefaultGateway, "server")).toThrow(
    "@WebSocketServer can only decorate an instance property",
  );
  expect(() => WebSocketServer()(DefaultGateway.prototype, "handleEvent")).toThrow(TypeError);

  class AccessorGateway {
    get server(): unknown {
      return undefined;
    }
  }

  expect(() => WebSocketServer()(AccessorGateway.prototype, "server")).toThrow(TypeError);
});

test("exports lifecycle and response contracts without platform dependencies", async () => {
  const calls: string[] = [];
  const lifecycle: OnGatewayInit<string> &
    OnGatewayConnection<number> &
    OnGatewayDisconnect<number> = {
    afterInit(server) {
      calls.push(server);
    },
    async handleConnection(client) {
      calls.push(`open:${client}`);
    },
    handleDisconnect(client) {
      calls.push(`close:${client}`);
    },
  };
  const response: WsResponse<{ readonly accepted: true }> = {
    event: "events",
    data: { accepted: true },
  };
  const websocketErrorCodes = [
    "INVALID_WEBSOCKET_GATEWAY",
    "DUPLICATE_WEBSOCKET_GATEWAY",
    "DUPLICATE_WEBSOCKET_HANDLER",
    "INVALID_WEBSOCKET_MESSAGE",
    "UNKNOWN_WEBSOCKET_EVENT",
    "WEBSOCKET_HANDLER_ERROR",
  ] as const satisfies readonly AponiaErrorCode[];

  await lifecycle.afterInit("ready");
  await lifecycle.handleConnection(1);
  await lifecycle.handleDisconnect(1);

  expect(calls).toEqual(["ready", "open:1", "close:1"]);
  expect(response).toEqual({ event: "events", data: { accepted: true } });
  expect(websocketErrorCodes).toHaveLength(6);
});
