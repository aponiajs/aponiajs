import { describe, expect, test } from "bun:test";
import {
  Body,
  Controller,
  Get,
  Injectable,
  ConnectedSocket,
  MessageBody,
  Module,
  Post,
  Query,
  SubscribeMessage,
  UseGuards,
  WebSocketGateway,
  WebSocketServer,
  type CanActivate,
  type ExecutionContext,
} from "@aponiajs/common";
import { Type } from "typebox";
import { H3 } from "h3";
import { AponiaFactory, createH3Host, toH3PlatformHandler } from "./index.ts";

@Injectable()
class DenyGuard implements CanActivate {
  canActivate(): boolean {
    return false;
  }
}

@Controller("widgets")
class WidgetController {
  @Get()
  list(): { readonly ok: boolean } {
    return { ok: true };
  }

  @Get(":id", { query: Type.Object({ page: Type.Number() }) })
  find(@Query("page") page: number): { readonly page: number } {
    return { page };
  }

  @Post()
  create(@Body() body: { readonly name: string }): { readonly name: string } {
    return body;
  }

  @Get("guarded")
  @UseGuards(DenyGuard)
  secret(): string {
    return "secret";
  }
}

@Module({ controllers: [WidgetController], providers: [DenyGuard] })
class AppModule {}

@WebSocketGateway("/ws")
@Injectable()
class EchoGateway {
  @WebSocketServer() server!: { emit(event: string, data: unknown): void };

  @SubscribeMessage("echo")
  echo(@MessageBody() data: unknown): unknown {
    return data;
  }

  @SubscribeMessage("direct")
  direct(@ConnectedSocket() socket: { emit(event: string, data: unknown): void }): undefined {
    socket.emit("directed", { n: 1 });
    return undefined;
  }

  @SubscribeMessage("broadcast")
  broadcast(): undefined {
    this.server.emit("news", { n: 2 });
    return undefined;
  }

  @SubscribeMessage("use-socket")
  useSocket(
    @ConnectedSocket() socket: {
      subscribe(topic: string): void;
      publish(topic: string, data: string): void;
      close(code?: number, reason?: string): void;
    },
  ): undefined {
    socket.subscribe("room");
    socket.publish("room", "broadcast");
    socket.close(1000, "done");
    return undefined;
  }
}

@Module({ providers: [EchoGateway] })
class GatewayModule {}

@Injectable()
class HeaderGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp().getRequest() as { readonly request: Request };
    seenAuthorization = http.request.headers.get("authorization");
    return seenAuthorization === "Bearer ok";
  }
}

let seenAuthorization: string | null = null;
let guardedRuns = 0;

@WebSocketGateway({ path: "/guarded", guards: [HeaderGuard] })
@Injectable()
class GuardedGateway {
  @SubscribeMessage("echo")
  echo(@MessageBody() data: unknown): unknown {
    guardedRuns += 1;
    return data;
  }
}

@Module({ providers: [GuardedGateway, HeaderGuard] })
class GuardedGatewayModule {}

function request(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, init);
}

describe("Aponia on H3", () => {
  test("answers through the native H3 application", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });
    const native = application.getNativeApplication();
    const response = await native.fetch(request("/widgets"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    await application.close();
  });

  test("coerces and validates the route schema", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });
    const native = application.getNativeApplication();

    const accepted = await native.fetch(request("/widgets/7?page=2"));
    expect(await accepted.json()).toEqual({ page: 2 });

    const refused = await native.fetch(request("/widgets/7?page=no"));
    expect(refused.status).toBe(422);
    await application.close();
  });

  test("validates a JSON body", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });
    const native = application.getNativeApplication();
    const response = await native.fetch(
      request("/widgets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "widget" }),
      }),
    );

    expect(await response.json()).toEqual({ name: "widget" });
    await application.close();
  });

  test("answers a guard's refusal as a problem document", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });
    const response = await application.getNativeApplication().fetch(request("/widgets/guarded"));

    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    await application.close();
  });

  test("mounts under the declared prefix", async () => {
    const application = await AponiaFactory.create(AppModule, {
      logger: false,
      prefix: "/api",
    });
    const native = application.getNativeApplication();

    expect((await native.fetch(request("/api/widgets"))).status).toBe(200);
    expect((await native.fetch(request("/widgets"))).status).toBe(404);
    await application.close();
  });

  test("declines a request it does not own so the application can answer it", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });
    const app = new H3();
    app.get("/health", () => "ok");
    app.use(toH3PlatformHandler(application));

    expect(await (await app.fetch(request("/health"))).text()).toBe("ok");
    expect((await app.fetch(request("/widgets"))).status).toBe(200);
    expect((await app.fetch(request("/nothing"))).status).toBe(404);
    await application.close();
  });

  test("runs H3 middleware registered before the dispatcher first", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });
    const order: string[] = [];
    const app = new H3();
    app.use(async (_event, next) => {
      order.push("middleware");
      await next();
    });
    app.use(toH3PlatformHandler(application));

    await app.fetch(request("/widgets"));
    expect(order).toEqual(["middleware"]);
    await application.close();
  });

  test("createNative returns the H3 instance", async () => {
    const native = await AponiaFactory.createNative(AppModule, { logger: false });

    expect((await native.fetch(request("/widgets"))).status).toBe(200);
  });

  test("the host answers through the native fetch", async () => {
    const host = createH3Host();
    const native = host.createApplication("test");
    const response = await host.fetch?.(native, request("/"));

    expect(response?.status).toBe(404);
  });

  test("the host listens on Bun's server and closes it", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });
    const host = createH3Host();
    const listener = await host.listen?.(application.getNativeApplication(), 0);

    expect(listener).toBeDefined();
    const response = await fetch(`${listener?.url}/widgets`);
    expect(response.status).toBe(200);
    await application.close();
  });

  test("answers without a peer address when the runtime cannot state one", async () => {
    const host = createH3Host();
    let routeHandler: ((event: unknown) => Promise<Response>) | undefined;
    const fake = {
      on(_method: string, _path: string, handler: (event: unknown) => Promise<Response>) {
        routeHandler = handler;
      },
      all(_path: string, handler: (event: unknown) => Promise<Response>) {
        routeHandler = handler;
      },
    } as never;
    let seen: unknown = "unset";
    host.mountRoute(
      fake,
      {
        route: {
          method: "GET",
          path: "/x",
          propertyKey: "handle",
          parameters: [],
          schema: undefined,
          declaredParameterCount: 0,
          pipes: [],
          enhancers: { guards: [], interceptors: [], filters: [] },
          serializer: undefined,
        },
        controller: class {},
        instance: {},
        guards: [],
        interceptors: [],
        filters: [],
        pipes: [],
      } as never,
      async (context) => {
        seen = context.ip;
        return new Response("ok");
      },
    );

    const event = {
      req: new Request("http://localhost/x"),
      url: new URL("http://localhost/x"),
      context: {},
    };
    const response = await routeHandler?.(event);

    expect(await response?.text()).toBe("ok");
    expect(seen).toBeUndefined();
  });

  test("answers through the managed wrapper's handle", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });
    const response = await application.handle(request("/widgets"));

    expect(response.status).toBe(200);
    expect(application.platform).toBe("h3");
    await application.close();
  });

  test("upgrades a gateway over Bun's server and answers an event", async () => {
    const application = await AponiaFactory.create(GatewayModule, { logger: false });
    await application.listen(0);
    const socket = new WebSocket(`${application.getUrl().replace("http", "ws")}/ws`);

    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error("the socket did not open"));
    });
    const frame = new Promise<string>((resolve) => {
      socket.onmessage = (event) => resolve(String(event.data));
    });
    socket.send(JSON.stringify({ event: "echo", data: { n: 1 } }));

    expect(JSON.parse(await frame)).toEqual({ event: "echo", data: { n: 1 } });
    socket.close();
    await application.close();
  });

  test("mounts the gateway route an upgrading server runs", async () => {
    const application = await AponiaFactory.create(GatewayModule, { logger: false });
    const response = await application
      .getNativeApplication()
      .fetch(new Request("http://localhost/ws", { headers: { upgrade: "websocket" } }));
    const hooks = (
      response as unknown as {
        readonly crossws?: {
          open?(peer: unknown): unknown;
          message?(peer: unknown, message: unknown): unknown;
          close?(peer: unknown): unknown;
        };
      }
    ).crossws;
    expect(hooks).toBeDefined();

    const sent: string[] = [];
    const peer = {
      send(data: string) {
        sent.push(data);
      },
      close() {},
      subscribe() {},
      publish() {},
    };
    await hooks?.open?.(peer);
    await hooks?.message?.(peer, {
      text: () => JSON.stringify({ event: "echo", data: { n: 1 } }),
    });
    await hooks?.close?.(peer);
    await Bun.sleep(0);

    expect(sent.map((frame) => JSON.parse(frame))).toEqual([{ event: "echo", data: { n: 1 } }]);
    await application.close();
  });

  test("runs a handshake guard against the upgrade request", async () => {
    const application = await AponiaFactory.create(GuardedGatewayModule, { logger: false });
    const response = await application
      .getNativeApplication()
      .fetch(new Request("http://localhost/guarded", { headers: { upgrade: "websocket" } }));
    const hooks = (
      response as unknown as {
        readonly crossws?: {
          open?(peer: unknown): unknown;
          message?(peer: unknown, message: unknown): unknown;
        };
      }
    ).crossws;
    expect(hooks).toBeDefined();

    const sent: string[] = [];
    const closed: { readonly code?: number }[] = [];
    const allowed = {
      id: "allowed-peer",
      request: new Request("http://localhost/guarded", {
        headers: { authorization: "Bearer ok" },
      }),
      send(data: string) {
        sent.push(data);
      },
      close(code?: number) {
        closed.push({ code });
      },
      subscribe() {},
      publish() {},
    };
    await hooks?.open?.(allowed);
    await hooks?.message?.(allowed, {
      text: () => JSON.stringify({ event: "echo", data: { n: 1 } }),
    });
    await Bun.sleep(0);
    expect(seenAuthorization).toBe("Bearer ok");
    expect(guardedRuns).toBe(1);

    const denied = {
      id: "denied-peer",
      request: new Request("http://localhost/guarded"),
      send(data: string) {
        sent.push(data);
      },
      close(code?: number) {
        closed.push({ code });
      },
      subscribe() {},
      publish() {},
    };
    await hooks?.open?.(denied);
    await hooks?.message?.(denied, {
      text: () => JSON.stringify({ event: "echo", data: { n: 2 } }),
    });
    await Bun.sleep(0);
    expect(guardedRuns).toBe(1);
    expect(closed[0]?.code).toBe(1008);
    await application.close();
  });

  test("hands a handler the socket, which can subscribe, publish, and close", async () => {
    const application = await AponiaFactory.create(GatewayModule, { logger: false });
    await application.listen(0);
    const socket = new WebSocket(`${application.getUrl().replace("http", "ws")}/ws`);

    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error("the socket did not open"));
    });
    const closed = new Promise<number>((resolve) => {
      socket.onclose = (event) => resolve(event.code);
    });
    socket.send(JSON.stringify({ event: "use-socket", data: {} }));

    expect(await closed).toBe(1000);
    await application.close();
  });

  test("emits to one client and broadcasts to every client", async () => {
    const application = await AponiaFactory.create(GatewayModule, { logger: false });
    await application.listen(0);
    const base = application.getUrl().replace("http", "ws");
    const first = new WebSocket(`${base}/ws`);
    const second = new WebSocket(`${base}/ws`);

    await Promise.all(
      [first, second].map(
        (socket) =>
          new Promise<void>((resolve, reject) => {
            socket.onopen = () => resolve();
            socket.onerror = () => reject(new Error("the socket did not open"));
          }),
      ),
    );

    const firstFrames: string[] = [];
    const secondFrames: string[] = [];
    first.onmessage = (event) => firstFrames.push(String(event.data));
    second.onmessage = (event) => secondFrames.push(String(event.data));

    first.send(JSON.stringify({ event: "direct", data: {} }));
    await Bun.sleep(50);
    expect(firstFrames.map((frame) => JSON.parse(frame))).toEqual([
      { event: "directed", data: { n: 1 } },
    ]);
    expect(secondFrames).toEqual([]);

    first.send(JSON.stringify({ event: "broadcast", data: {} }));
    await Bun.sleep(50);
    expect(firstFrames.map((frame) => JSON.parse(frame))).toContainEqual({
      event: "news",
      data: { n: 2 },
    });
    expect(secondFrames.map((frame) => JSON.parse(frame))).toEqual([
      { event: "news", data: { n: 2 } },
    ]);

    first.close();
    second.close();
    await application.close();
  });
});
