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
  bindWebSocketGateway,
  compileWebSocketGateways,
} from "../src/websockets/websocket-gateway.ts";
import {
  defineWebSocketGateway,
  type WebSocketClient,
  type WebSocketServerRef,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");
type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

type ClientAliasAssertion = Expect<Equals<WebSocketClient, ElysiaWS>>;
type ServerAliasAssertion = Expect<Equals<WebSocketServerRef, Elysia>>;

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
  const compiled = compileWebSocketGateways([module]);
  const container = createContainer(module);
  const instance = container.resolveModuleProvider(module, ConformanceGateway);
  const gateway = bindWebSocketGateway(compiled[0]!, instance);
  const sent: unknown[] = [];
  const socket = {
    send(value: unknown): number {
      sent.push(value);
      return 1;
    },
  } as unknown as WebSocketClient;

  await gateway.message(socket, { event: "echo", data: { text: "typed" } });

  expect(clientAliasAssertion).toBe(true);
  expect(serverAliasAssertion).toBe(true);
  expect(compiled[0]?.path).toBe("/conformance");
  expect(sent).toEqual([{ event: "echo", data: "typed" }]);
});

/** The same gateway as data: `@SubscribeMessage("echo")` on `echo(@MessageBody("text") text)`. */
class DeclaredConformanceGateway {
  echo(text: unknown): unknown {
    return text;
  }
}

const declaredModule = defineModule({
  id: "DeclaredWebSocketConformanceModule",
  providers: [
    defineWebSocketGateway(DeclaredConformanceGateway, {
      path: "/conformance/",
      handlers: [
        {
          event: "echo",
          propertyKey: "echo",
          parameters: [{ index: 0, kind: "message-body", property: "text" }],
        },
      ],
    }),
  ],
});

test("the Vite+ lane compiles and dispatches a declared gateway through the same path", async () => {
  const compiled = compileWebSocketGateways([declaredModule]);
  const instance = createContainer(declaredModule).resolveModuleProvider(
    declaredModule,
    DeclaredConformanceGateway,
  );
  const gateway = bindWebSocketGateway(compiled[0]!, instance);
  const sent: unknown[] = [];
  const socket = {
    send(value: unknown): number {
      sent.push(value);
      return 1;
    },
  } as unknown as WebSocketClient;

  await gateway.message(socket, { event: "echo", data: { text: "declared" } });

  expect(compiled[0]?.path).toBe("/conformance");
  expect(sent).toEqual([{ event: "echo", data: "declared" }]);
  expect(() => compileWebSocketGateways([module, declaredModule])).toThrow(
    "WebSocket gateway path",
  );
});
