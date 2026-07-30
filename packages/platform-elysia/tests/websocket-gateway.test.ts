import { expect, test } from "bun:test";
import {
  AponiaError,
  ConnectedSocket,
  MessageBody,
  Module,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  createToken,
  defineModule,
  provideValue,
  type Constructor,
  type LoggerService,
  type Provider,
  type WsResponse,
} from "@aponiajs/common";
import { createContainer } from "@aponiajs/core";
import { Elysia } from "elysia";
import {
  bindElysiaWebSocketGateway,
  compileElysiaWebSocketGateways,
  registerElysiaWebSocketGateways,
} from "../src/websockets/websocket-gateway.ts";
import { AponiaFactory, ElysiaPluginModule, defineElysiaController } from "../src/index.ts";
import type { ElysiaWebSocket } from "../src/websockets/websocket-gateway.types.ts";

class RecordingSocket {
  readonly sent: unknown[] = [];

  send(data: unknown): number {
    this.sent.push(data);
    return 1;
  }
}

interface NativeWebSocketCallbacks {
  readonly open: (socket: ElysiaWebSocket) => unknown;
  readonly message: (socket: ElysiaWebSocket, message: unknown) => unknown;
  readonly close: (socket: ElysiaWebSocket) => unknown;
}

@WebSocketGateway(" events/ ")
class EventsGateway {
  @WebSocketServer()
  server!: Elysia;

  readonly lifecycle: string[] = [];

  afterInit(server: Elysia): void {
    this.lifecycle.push(server === this.server ? "init" : "wrong-server");
  }

  async handleConnection(): Promise<void> {
    await Promise.resolve();
    this.lifecycle.push("open");
  }

  handleDisconnect(): void {
    this.lifecycle.push("close");
  }

  @SubscribeMessage("echo")
  echo(
    @MessageBody("value") value: unknown,
    @ConnectedSocket() socket: ElysiaWebSocket,
  ): WsResponse {
    return { event: "echo.result", data: { value, connected: socket !== undefined } };
  }

  @SubscribeMessage("value")
  value(@MessageBody() data: unknown): unknown {
    return data;
  }

  @SubscribeMessage("promise")
  async promise(): Promise<string> {
    return "resolved";
  }

  @SubscribeMessage("sync-stream")
  *syncStream(): Generator<number> {
    yield 1;
    yield 2;
  }

  @SubscribeMessage("async-stream")
  async *asyncStream(): AsyncGenerator<string> {
    yield "first";
    await Promise.resolve();
    yield "second";
  }

  @SubscribeMessage("silent")
  silent(): undefined {
    return undefined;
  }

  @SubscribeMessage("failure")
  failure(): never {
    throw new Error("private implementation detail");
  }
}

const eventsToken = createToken<EventsGateway>("events-gateway");
const eventsProvider: Provider = Object.freeze({
  kind: "class",
  provide: eventsToken,
  inject: Object.freeze([]),
  useClass: EventsGateway as Constructor<unknown, never[]>,
});
const eventsModule = defineModule({
  id: "EventsModule",
  providers: [eventsProvider],
});

class MemoryLogger implements LoggerService {
  readonly records: { readonly context: string; readonly message: string }[] = [];

  log(message: unknown, context?: unknown): void {
    this.records.push({
      context: typeof context === "string" ? context : "",
      message: String(message),
    });
  }

  fatal(): void {}
  error(): void {}
  warn(): void {}
}

test("discovers a decorated custom-token class provider and mounts its canonical path", async () => {
  const compiled = compileElysiaWebSocketGateways([eventsModule]);
  const container = createContainer(eventsModule);
  const application = new Elysia();

  expect(compiled).toHaveLength(1);
  expect(compiled[0]?.path).toBe("/events");
  expect(compiled[0]?.token).toBe(eventsToken);
  expect(Object.isFrozen(compiled)).toBe(true);
  expect(Object.isFrozen(compiled[0])).toBe(true);
  expect(Object.isFrozen(compiled[0]?.handlers)).toBe(true);

  await registerElysiaWebSocketGateways(application, container, compiled);
  const instance = container.resolveModuleProvider(eventsModule, eventsToken);

  expect(application.routes.filter((route) => route.method === "WS")).toHaveLength(1);
  expect(application.routes.find((route) => route.method === "WS")?.path).toBe("/events");
  expect(instance.server).toBe(application);
  expect(instance.lifecycle).toEqual(["init"]);
});

test("bootstraps provider gateways and reports Nest-style subscription logs", async () => {
  const logger = new MemoryLogger();
  const application = await AponiaFactory.create(eventsModule, { logger });

  expect(
    application
      .getNativeApplication()
      .routes.some((route) => route.method === "WS" && route.path === "/events"),
  ).toBe(true);
  expect(logger.records).toContainEqual({
    context: "WebSocketsController",
    message: "EventsGateway {/events}:",
  });
  expect(logger.records).toContainEqual({
    context: "WebSocketsController",
    message: 'Subscribed to "echo" message',
  });
  await application.close();
});

test("forwards native Elysia WebSocket callbacks into the bound gateway", async () => {
  let callbacks: NativeWebSocketCallbacks | undefined;
  const nativeApplication = {
    routes: [],
    ws(_path: string, options: NativeWebSocketCallbacks) {
      callbacks = options;
      return this;
    },
  } as unknown as Elysia;
  const container = createContainer(eventsModule);
  const compiled = compileElysiaWebSocketGateways([eventsModule]);
  const recording = new RecordingSocket();
  const socket = recording as unknown as ElysiaWebSocket;

  await registerElysiaWebSocketGateways(nativeApplication, container, compiled);
  await callbacks!.open(socket);
  await callbacks!.message(socket, { event: "value", data: "native" });
  await callbacks!.close(socket);

  expect(recording.sent).toEqual([{ event: "value", data: "native" }]);
  expect(container.resolveModuleProvider(eventsModule, eventsToken).lifecycle).toEqual([
    "init",
    "open",
    "close",
  ]);
});

test("binds lifecycle and every supported message return shape without reflection", async () => {
  const compiled = compileElysiaWebSocketGateways([eventsModule]);
  const container = createContainer(eventsModule);
  const instance = container.resolveModuleProvider(eventsModule, eventsToken);
  const bound = bindElysiaWebSocketGateway(compiled[0]!, instance);
  const recording = new RecordingSocket();
  const socket = recording as unknown as ElysiaWebSocket;

  await bound.initialize(new Elysia());
  await bound.open(socket);
  await bound.message(socket, JSON.stringify({ event: "echo", data: { value: 42 } }));
  await bound.message(socket, { event: "value", data: null });
  await bound.message(socket, { event: "value", data: false });
  await bound.message(socket, { event: "value", data: 0 });
  await bound.message(socket, { event: "promise" });
  await bound.message(socket, { event: "sync-stream" });
  await bound.message(socket, { event: "async-stream" });
  await bound.message(socket, { event: "silent" });
  await bound.close(socket);

  expect(instance.lifecycle).toEqual(["init", "open", "close"]);
  expect(recording.sent).toEqual([
    { event: "echo.result", data: { value: 42, connected: true } },
    { event: "value", data: null },
    { event: "value", data: false },
    { event: "value", data: 0 },
    { event: "promise", data: "resolved" },
    { event: "sync-stream", data: 1 },
    { event: "sync-stream", data: 2 },
    { event: "async-stream", data: "first" },
    { event: "async-stream", data: "second" },
  ]);
});

test("sends stable exception envelopes for malformed, unknown, and failed messages", async () => {
  const gateway = compileElysiaWebSocketGateways([eventsModule])[0]!;
  const container = createContainer(eventsModule);
  const instance = container.resolveModuleProvider(eventsModule, eventsToken);
  const bound = bindElysiaWebSocketGateway(gateway, instance);
  const recording = new RecordingSocket();
  const socket = recording as unknown as ElysiaWebSocket;

  await bound.message(socket, "not-json");
  await bound.message(socket, null);
  await bound.message(socket, {});
  await bound.message(socket, { event: "   " });
  await bound.message(
    socket,
    new Proxy(
      {},
      {
        get() {
          throw new Error("hostile message");
        },
      },
    ),
  );
  await bound.message(socket, { event: "missing", data: "ignored" });
  await bound.message(socket, { event: "failure" });

  expect(recording.sent).toEqual([
    ...Array.from({ length: 5 }, () => ({
      event: "exception",
      data: {
        code: "INVALID_WEBSOCKET_MESSAGE",
        message: "WebSocket messages must contain a non-empty string event.",
      },
    })),
    {
      event: "exception",
      data: {
        code: "UNKNOWN_WEBSOCKET_EVENT",
        message: "No WebSocket handler is registered for this event.",
      },
    },
    {
      event: "exception",
      data: {
        code: "WEBSOCKET_HANDLER_ERROR",
        message: "The WebSocket handler failed.",
      },
    },
  ]);
  expect(JSON.stringify(recording.sent)).not.toContain("private implementation detail");
});

test("contains rejected connection and disconnect lifecycle hooks", async () => {
  @WebSocketGateway("/lifecycle")
  class RejectingGateway {
    async handleConnection(): Promise<void> {
      throw new Error("private connection detail");
    }

    handleDisconnect(): never {
      throw new Error("private disconnection detail");
    }
  }

  const provider: Provider = Object.freeze({
    kind: "class",
    provide: RejectingGateway,
    inject: Object.freeze([]),
    useClass: RejectingGateway as Constructor<unknown, never[]>,
  });
  const module = defineModule({ id: "RejectingModule", providers: [provider] });
  const gateway = compileElysiaWebSocketGateways([module])[0]!;
  const instance = createContainer(module).resolveModuleProvider(module, RejectingGateway);
  const bound = bindElysiaWebSocketGateway(gateway, instance);
  const recording = new RecordingSocket();
  const socket = recording as unknown as ElysiaWebSocket;

  await Promise.resolve(bound.open(socket));
  expect(bound.close(socket)).toBeUndefined();
  expect(recording.sent).toEqual([
    {
      event: "exception",
      data: {
        code: "WEBSOCKET_HANDLER_ERROR",
        message: "The WebSocket lifecycle handler failed.",
      },
    },
    {
      event: "exception",
      data: {
        code: "WEBSOCKET_HANDLER_ERROR",
        message: "The WebSocket lifecycle handler failed.",
      },
    },
  ]);
});

test("ignores decorated classes that are not registered as class providers", () => {
  const valueModule = defineModule({
    id: "ValueModule",
    providers: [provideValue(createToken<EventsGateway>("value-gateway"), new EventsGateway())],
  });

  expect(compileElysiaWebSocketGateways([valueModule])).toEqual([]);
});

test("rejects duplicate canonical gateway paths and native Elysia WS routes", async () => {
  @WebSocketGateway("/duplicate/")
  class FirstGateway {}

  @WebSocketGateway("duplicate")
  class SecondGateway {}

  const first = classProvider(FirstGateway);
  const second = classProvider(SecondGateway);
  const firstModule = defineModule({ id: "FirstModule", providers: [first] });
  const secondModule = defineModule({ id: "SecondModule", providers: [second] });

  expectAponiaCode(
    () => compileElysiaWebSocketGateways([firstModule, secondModule]),
    "DUPLICATE_WEBSOCKET_GATEWAY",
  );

  const compiled = compileElysiaWebSocketGateways([firstModule]);
  const application = new Elysia().ws("//duplicate//", { message() {} });
  try {
    await registerElysiaWebSocketGateways(application, createContainer(firstModule), compiled);
    throw new Error("Expected a native WebSocket collision.");
  } catch (error) {
    expect(error).toBeInstanceOf(AponiaError);
    expect(error).toMatchObject({
      code: "DUPLICATE_WEBSOCKET_GATEWAY",
      details: {
        path: "/duplicate",
        source: "native",
      },
    });
  }
  expect(application.routes.filter((route) => route.method === "WS")).toHaveLength(1);
});

test("waits for promised native plugins before checking WebSocket route collisions", async () => {
  @WebSocketGateway("/promised-collision")
  class PromisedCollisionGateway {}

  const promisedPlugin = ElysiaPluginModule.register(
    Promise.resolve(new Elysia().ws("/promised-collision", { message() {} })),
  );
  @Module({
    imports: [promisedPlugin],
    providers: [classProvider(PromisedCollisionGateway)],
  })
  class PromisedCollisionModule {}

  const error = await AponiaFactory.create(PromisedCollisionModule, { logger: false }).then(
    () => undefined,
    (reason: unknown) => reason,
  );

  expect(error).toBeInstanceOf(AponiaError);
  expect(error).toMatchObject({
    code: "DUPLICATE_WEBSOCKET_GATEWAY",
    details: {
      path: "/promised-collision",
      source: "native",
    },
  });
});

test("mounts gateways after promised native plugins finish composing", async () => {
  @WebSocketGateway("/after-promised-plugin")
  class GatewayAfterPromisedPlugin {}

  const promisedPlugin = ElysiaPluginModule.register(
    Promise.resolve(new Elysia().get("/promised-plugin-ready", () => "ready")),
  );

  @Module({
    imports: [promisedPlugin],
    providers: [classProvider(GatewayAfterPromisedPlugin)],
  })
  class GatewayAfterPromisedPluginModule {}

  const application = await AponiaFactory.create(GatewayAfterPromisedPluginModule, {
    logger: false,
  });
  const nativeApplication = application.getNativeApplication();
  const promisedPluginResponse = await nativeApplication.handle(
    new Request("http://localhost/promised-plugin-ready"),
  );

  expect(await promisedPluginResponse.text()).toBe("ready");
  expect(
    nativeApplication.routes.some(
      (route) => route.method === "WS" && route.path === "/after-promised-plugin",
    ),
  ).toBe(true);
  await application.close();
});

test("includes controller-owned native routes in WebSocket collision checks", async () => {
  @WebSocketGateway("/controller-collision")
  class ControllerCollisionGateway {}

  class NativeWebSocketController {}
  const nativeWebSocketController = defineElysiaController(NativeWebSocketController, {
    inject: [] as const,
    buildPlugin: () => new Elysia().ws("/controller-collision", { message() {} }),
  });
  const module = defineModule({
    id: "ControllerCollisionModule",
    controllers: [nativeWebSocketController],
    providers: [classProvider(ControllerCollisionGateway)],
  });

  const error = await AponiaFactory.create(module, { logger: false }).then(
    () => undefined,
    (reason: unknown) => reason,
  );

  expect(error).toBeInstanceOf(AponiaError);
  expect(error).toMatchObject({
    code: "DUPLICATE_WEBSOCKET_GATEWAY",
    details: {
      path: "/controller-collision",
      source: "native",
    },
  });
});

test("rejects duplicate events, invalid definitions, and invalid resolved instances", () => {
  class DuplicateHandlerGateway {
    first(): void {}
    second(): void {}
  }
  WebSocketGateway()(DuplicateHandlerGateway);
  decorateMessage(DuplicateHandlerGateway, "first", "duplicate");
  decorateMessage(DuplicateHandlerGateway, "second", "duplicate");
  const duplicateModule = defineModule({
    id: "DuplicateHandlerModule",
    providers: [classProvider(DuplicateHandlerGateway)],
  });
  expectAponiaCode(
    () => compileElysiaWebSocketGateways([duplicateModule]),
    "DUPLICATE_WEBSOCKET_HANDLER",
  );

  class InvalidHandlerGateway {
    handle(): void {}
  }
  WebSocketGateway()(InvalidHandlerGateway);
  decorateMessage(InvalidHandlerGateway, "handle", "invalid");
  Object.defineProperty(InvalidHandlerGateway.prototype, "handle", { value: 1 });
  const invalidModule = defineModule({
    id: "InvalidHandlerModule",
    providers: [classProvider(InvalidHandlerGateway)],
  });
  expectAponiaCode(
    () => compileElysiaWebSocketGateways([invalidModule]),
    "INVALID_WEBSOCKET_GATEWAY",
  );

  const compiled = compileElysiaWebSocketGateways([eventsModule])[0]!;
  const invalidInstance = Object.create(EventsGateway.prototype) as Record<string, unknown>;
  invalidInstance.echo = 0;
  expectAponiaCode(
    () => bindElysiaWebSocketGateway(compiled, invalidInstance),
    "INVALID_WEBSOCKET_GATEWAY",
  );
  expectAponiaCode(() => bindElysiaWebSocketGateway(compiled, null), "INVALID_WEBSOCKET_GATEWAY");
});

test("rejects invalid paths, duplicate parameters, lifecycle members, and server targets", async () => {
  class InvalidPathGateway {}
  WebSocketGateway()(InvalidPathGateway);
  Reflect.defineMetadata(
    Symbol.for("aponia.websocket-gateway.metadata"),
    Object.freeze({ path: "   " }),
    InvalidPathGateway,
  );
  const invalidPathModule = defineModule({
    id: "InvalidPathModule",
    providers: [classProvider(InvalidPathGateway)],
  });
  expectAponiaCode(
    () => compileElysiaWebSocketGateways([invalidPathModule]),
    "INVALID_WEBSOCKET_GATEWAY",
  );

  class DuplicateParameterGateway {
    handle(_value: unknown): void {}
  }
  WebSocketGateway()(DuplicateParameterGateway);
  decorateMessage(DuplicateParameterGateway, "handle", "duplicate-parameter");
  MessageBody()(DuplicateParameterGateway.prototype, "handle", 0);
  ConnectedSocket()(DuplicateParameterGateway.prototype, "handle", 0);
  const duplicateParameterModule = defineModule({
    id: "DuplicateParameterModule",
    providers: [classProvider(DuplicateParameterGateway)],
  });
  expectAponiaCode(
    () => compileElysiaWebSocketGateways([duplicateParameterModule]),
    "INVALID_WEBSOCKET_GATEWAY",
  );

  const compiled = compileElysiaWebSocketGateways([eventsModule])[0]!;
  const invalidLifecycle = new EventsGateway() as unknown as Record<PropertyKey, unknown>;
  invalidLifecycle.handleConnection = 1;
  expectAponiaCode(
    () => bindElysiaWebSocketGateway(compiled, invalidLifecycle),
    "INVALID_WEBSOCKET_GATEWAY",
  );

  const lockedServer = new EventsGateway();
  Object.defineProperty(lockedServer, "server", {
    configurable: false,
    value: undefined,
    writable: false,
  });
  const lockedGateway = bindElysiaWebSocketGateway(compiled, lockedServer);
  expectAponiaCode(() => lockedGateway.initialize(new Elysia()), "INVALID_WEBSOCKET_GATEWAY");

  const hostileServer = new Proxy(new EventsGateway(), {
    set() {
      throw new Error("hostile server property");
    },
  });
  const hostileGateway = bindElysiaWebSocketGateway(compiled, hostileServer);
  expectAponiaCode(() => hostileGateway.initialize(new Elysia()), "INVALID_WEBSOCKET_GATEWAY");

  @WebSocketGateway("/")
  class EmptyGateway {}
  const emptyModule = defineModule({
    id: "EmptyModule",
    providers: [classProvider(EmptyGateway)],
  });
  const emptyPlan = compileElysiaWebSocketGateways([emptyModule])[0]!;
  const emptyBound = bindElysiaWebSocketGateway(emptyPlan, new EmptyGateway());
  const socket = new RecordingSocket() as unknown as ElysiaWebSocket;

  expect(emptyPlan.path).toBe("/");
  expect(await emptyBound.initialize(new Elysia())).toBeUndefined();
  expect(await emptyBound.open(socket)).toBeUndefined();
  expect(await emptyBound.close(socket)).toBeUndefined();
});

function classProvider<T>(useClass: Constructor<T, readonly []>): Provider {
  return Object.freeze({
    kind: "class",
    provide: useClass,
    inject: Object.freeze([]),
    useClass: useClass as Constructor<unknown, never[]>,
  });
}

function decorateMessage(
  gateway: Constructor<unknown, readonly []>,
  propertyKey: string,
  event: string,
): void {
  SubscribeMessage(event)(
    gateway.prototype,
    propertyKey,
    Object.getOwnPropertyDescriptor(gateway.prototype, propertyKey)!,
  );
}

function expectAponiaCode(operation: () => unknown, code: AponiaError["code"]): void {
  try {
    operation();
    throw new Error(`Expected ${code}.`);
  } catch (error) {
    expect(error).toBeInstanceOf(AponiaError);
    expect((error as AponiaError).code).toBe(code);
    expect(Object.isFrozen((error as AponiaError).details)).toBe(true);
  }
}
