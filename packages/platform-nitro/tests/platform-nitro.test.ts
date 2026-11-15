import { describe, expect, test } from "bun:test";
import {
  Body,
  Controller,
  Get,
  Injectable,
  MessageBody,
  Module,
  Post,
  SubscribeMessage,
  WebSocketGateway,
} from "@aponiajs/common";
import { AponiaFactory, createAponiaNitroHandler } from "../src/index.ts";

@Controller("widgets")
class WidgetController {
  @Get()
  list(): { readonly ok: boolean } {
    return { ok: true };
  }

  @Post()
  create(@Body() body: { readonly name: string }): { readonly name: string } {
    return body;
  }
}

@Module({ controllers: [WidgetController] })
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

describe("Aponia on Nitro", () => {
  test("serves the application through the Nitro handler", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });
    const handler = createAponiaNitroHandler(application);
    const response = await handler.fetch?.(request("/widgets"));

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true });
    await application.close();
  });

  test("reads a JSON body through the handler", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });
    const handler = createAponiaNitroHandler(application);
    const response = await handler.fetch?.(
      request("/widgets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "widget" }),
      }),
    );

    expect(await response?.json()).toEqual({ name: "widget" });
    await application.close();
  });

  test("names the platform nitro and returns the H3 application", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });
    const native = await AponiaFactory.createNative(AppModule, { logger: false });

    expect(application.platform).toBe("nitro");
    expect((await native.fetch(request("/widgets"))).status).toBe(200);
    await application.close();
  });

  test("answers 404 through the handler for a route it does not own", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });
    const handler = createAponiaNitroHandler(application);
    const response = await handler.fetch?.(request("/none"));

    expect(response?.status).toBe(404);
    await application.close();
  });

  test("mounts a gateway route for the server to upgrade", async () => {
    const application = await AponiaFactory.create(GatewayModule, { logger: false });
    const native = application.getNativeApplication();
    const response = await native.fetch(request("/ws"));

    expect(response.status).toBe(426);
    await application.close();
  });
});
