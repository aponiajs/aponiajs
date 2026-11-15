import { describe, expect, test } from "bun:test";
import {
  Body,
  Controller,
  Get,
  Injectable,
  MessageBody,
  Module,
  Post,
  Query,
  SubscribeMessage,
  UseGuards,
  WebSocketGateway,
  type CanActivate,
} from "@aponiajs/common";
import { Type } from "typebox";
import { Hono } from "hono";
import { AponiaFactory, createHonoHost, toHonoPlatformHandler } from "../src/index.ts";

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
  @SubscribeMessage("echo")
  echo(@MessageBody() data: unknown): unknown {
    return data;
  }
}

@Module({ providers: [EchoGateway] })
class GatewayModule {}

describe("Aponia on Hono", () => {
  test("answers through the native Hono application", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });
    const native = application.getNativeApplication();
    const response = await native.request("/widgets");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    await application.close();
  });

  test("coerces and validates the route schema", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });
    const native = application.getNativeApplication();

    const accepted = await native.request("/widgets/7?page=2");
    expect(await accepted.json()).toEqual({ page: 2 });

    const refused = await native.request("/widgets/7?page=no");
    expect(refused.status).toBe(422);
    await application.close();
  });

  test("validates a JSON body", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });
    const native = application.getNativeApplication();
    const response = await native.request("/widgets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "widget" }),
    });

    expect(await response.json()).toEqual({ name: "widget" });
    await application.close();
  });

  test("answers a guard's refusal as a problem document", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });
    const response = await application.getNativeApplication().request("/widgets/guarded");

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

    expect((await native.request("/api/widgets")).status).toBe(200);
    expect((await native.request("/widgets")).status).toBe(404);
    await application.close();
  });

  test("declines a request it does not own so the application can answer it", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });
    const app = new Hono();
    app.get("/health", (context) => context.text("ok"));
    app.use("*", toHonoPlatformHandler(application));

    expect(await (await app.request("/health")).text()).toBe("ok");
    expect((await app.request("/widgets")).status).toBe(200);
    expect((await app.request("/nothing")).status).toBe(404);
    await application.close();
  });

  test("runs Hono middleware registered before the dispatcher first", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });
    const order: string[] = [];
    const app = new Hono();
    app.use("*", async (_context, next) => {
      order.push("middleware");
      await next();
    });
    app.use("*", toHonoPlatformHandler(application));

    await app.request("/widgets");
    expect(order).toEqual(["middleware"]);
    await application.close();
  });

  test("createNative returns the Hono instance", async () => {
    const native = await AponiaFactory.createNative(AppModule, { logger: false });

    expect((await native.request("/widgets")).status).toBe(200);
  });

  test("the host answers through the native fetch", async () => {
    const host = createHonoHost();
    const native = host.createApplication("test");
    const response = await host.fetch?.(native, new Request("http://localhost/"));

    expect(response?.status).toBe(404);
  });

  test("the host listens on Bun's server and closes it", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });
    const host = createHonoHost();
    const listener = await host.listen?.(application.getNativeApplication(), 0);

    expect(listener).toBeDefined();
    const response = await fetch(`${listener?.url}/widgets`);
    expect(response.status).toBe(200);
    await listener?.close();
    await application.close();
  });

  test("answers through the managed wrapper's handle", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });
    const response = await application.handle(new Request("http://localhost/widgets"));

    expect(response.status).toBe(200);
    expect(application.platform).toBe("hono");
    await application.close();
  });

  test("upgrades a gateway over Bun's server and answers an event", async () => {
    const application = await AponiaFactory.create(GatewayModule, { logger: false });
    const host = createHonoHost();
    const listener = await host.listen?.(application.getNativeApplication(), 0);
    const socket = new WebSocket(`${listener?.url.replace("http", "ws")}/ws`);

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
    await listener?.close();
    await application.close();
  });

  test("answers an HTTP request through the listener with the peer address", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });
    const host = createHonoHost();
    const listener = await host.listen?.(application.getNativeApplication(), 0);

    const response = await fetch(`${listener?.url}/widgets/1?page=2`);
    expect(response.status).toBe(200);
    await listener?.close();
    await application.close();
  });
});
