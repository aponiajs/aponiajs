import { describe, expect, test } from "bun:test";
import {
  AponiaError,
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
import { H3 } from "h3";
import { AponiaFactory, createH3Host, toH3PlatformHandler } from "../src/index.ts";

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
    await listener?.close();
    await application.close();
  });

  test("answers without a peer address when the runtime cannot state one", async () => {
    const host = createH3Host();
    let middleware:
      | ((event: unknown, next: () => Promise<unknown>) => Promise<unknown>)
      | undefined;
    const fake = {
      use(handler: (event: unknown, next: () => Promise<unknown>) => Promise<unknown>) {
        middleware = handler;
      },
    } as never;
    host.mount(fake, async (_request, info) => new Response(info.ip ?? "none"));

    const event = {
      req: new Request("http://localhost/x"),
      url: new URL("http://localhost/x"),
      get context(): never {
        throw new Error("the event carries no context");
      },
    };
    const response = (await middleware?.(event, async () => new Response("next"))) as Response;

    expect(await response?.text()).toBe("none");
  });

  test("answers through the managed wrapper's handle", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });
    const response = await application.handle(request("/widgets"));

    expect(response.status).toBe(200);
    expect(application.platform).toBe("h3");
    await application.close();
  });

  test("refuses a gateway the h3 host cannot upgrade", async () => {
    try {
      await AponiaFactory.create(GatewayModule, { logger: false });
      throw new Error("Expected the boot to refuse the gateway.");
    } catch (error) {
      expect(error).toBeInstanceOf(AponiaError);
      expect((error as AponiaError).code).toBe("UNSUPPORTED_PLATFORM_FEATURE");
    }
  });
});
