import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  defineModule,
  type Constructor,
  type Provider,
} from "@aponiajs/common";
import { createContainer } from "@aponiajs/core";
import type { Elysia } from "elysia";
import type { ElysiaWS } from "elysia/ws";
import {
  bindElysiaWebSocketGateway,
  compileElysiaWebSocketGateways,
} from "../src/websockets/websocket-gateway.ts";
import type { ElysiaWebSocket, ElysiaWebSocketServer } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");
type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

type ClientAliasAssertion = Expect<Equals<ElysiaWebSocket, ElysiaWS>>;
type ServerAliasAssertion = Expect<Equals<ElysiaWebSocketServer, Elysia>>;

@WebSocketGateway("/conformance/")
class ConformanceGateway {
  @SubscribeMessage("echo")
  echo(@MessageBody("text") text: unknown): unknown {
    return text;
  }
}

const provider: Provider = Object.freeze({
  kind: "class",
  provide: ConformanceGateway,
  inject: Object.freeze([]),
  useClass: ConformanceGateway as Constructor<unknown, never[]>,
});
const module = defineModule({
  id: "WebSocketConformanceModule",
  providers: [provider],
});

test("the Vite+ lane preserves native WebSocket gateway compilation and dispatch", async () => {
  const clientAliasAssertion: ClientAliasAssertion = true;
  const serverAliasAssertion: ServerAliasAssertion = true;
  const compiled = compileElysiaWebSocketGateways([module]);
  const container = createContainer(module);
  const instance = container.resolveModuleProvider(module, ConformanceGateway);
  const gateway = bindElysiaWebSocketGateway(compiled[0]!, instance);
  const sent: unknown[] = [];
  const socket = {
    send(value: unknown): number {
      sent.push(value);
      return 1;
    },
  } as unknown as ElysiaWebSocket;

  await gateway.message(socket, { event: "echo", data: { text: "typed" } });

  expect(clientAliasAssertion).toBe(true);
  expect(serverAliasAssertion).toBe(true);
  expect(compiled[0]?.path).toBe("/conformance");
  expect(sent).toEqual([{ event: "echo", data: "typed" }]);
});
