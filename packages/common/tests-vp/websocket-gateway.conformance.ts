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
  type OnGatewayConnection,
  type WsResponse,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("the Vite+ lane preserves the public WebSocket gateway contract", () => {
  const messageMethod = Symbol("message-method");
  const serverProperty = Symbol("server-property");

  class EventsGateway implements OnGatewayConnection<string> {
    handleConnection(_client: string): void {}

    handleEvent(_body: unknown, _client: unknown): WsResponse<string> {
      return { event: "events", data: "handled" };
    }

    [messageMethod](): void {}
  }

  WebSocketGateway({ path: "/events" })(EventsGateway);
  SubscribeMessage("events")(
    EventsGateway.prototype,
    "handleEvent",
    Object.getOwnPropertyDescriptor(EventsGateway.prototype, "handleEvent")!,
  );
  MessageBody("id")(EventsGateway.prototype, "handleEvent", 1);
  ConnectedSocket()(EventsGateway.prototype, "handleEvent", 0);
  SubscribeMessage("symbol-event")(
    EventsGateway.prototype,
    messageMethod,
    Object.getOwnPropertyDescriptor(EventsGateway.prototype, messageMethod)!,
  );
  WebSocketServer()(EventsGateway.prototype, serverProperty);

  expect(getWebSocketGatewayMetadata(EventsGateway)).toEqual({ path: "/events" });
  expect(getWebSocketMessageMetadata(EventsGateway)).toEqual([
    { event: "events", propertyKey: "handleEvent" },
    { event: "symbol-event", propertyKey: messageMethod },
  ]);
  expect(getWebSocketParameterMetadata(EventsGateway, "handleEvent")).toEqual([
    { index: 0, kind: "connected-socket", property: undefined },
    { index: 1, kind: "message-body", property: "id" },
  ]);
  expect(getWebSocketServerProperties(EventsGateway)).toEqual([serverProperty]);
  expect(Object.isFrozen(getWebSocketMessageMetadata(EventsGateway))).toBe(true);

  new EventsGateway().handleConnection("client");
});

test("the Vite+ lane preserves default and own-only gateway metadata", () => {
  class ParentGateway {}
  class ChildGateway extends ParentGateway {}

  WebSocketGateway()(ParentGateway);

  expect(getWebSocketGatewayMetadata(ParentGateway)).toEqual({ path: "/ws" });
  expect(getWebSocketGatewayMetadata(ChildGateway)).toBeUndefined();
  expect(() => SubscribeMessage("")).toThrow(TypeError);
});
