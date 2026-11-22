import { describe, expect, test } from "bun:test";
import {
  All,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Injectable,
  MessageBody,
  Module,
  ResponseSettings,
  SubscribeMessage,
  WebSocketGateway,
  type ResponseSettingsState,
} from "@aponiajs/common";
import { AponiaFactory } from "../src/index.ts";

@Controller("surface")
class SurfaceController {
  @Get()
  @Header("x-list", ["a", "b"])
  @HttpCode(204)
  run(): string {
    return "ignored";
  }

  @Get("accepted")
  accepted(@ResponseSettings() settings: ResponseSettingsState): string {
    settings.status = "Accepted";
    settings.headers["x-list"] = ["c", "d"];
    settings.headers["x-skip"] = undefined;
    return "created";
  }

  @Get("status")
  status(@HttpStatus() status: (code: string, body?: unknown) => Response): Response {
    return status("Accepted", { ok: true });
  }

  @All("any")
  any(): string {
    return "any";
  }
}

@Module({ controllers: [SurfaceController] })
class SurfaceModule {}

@WebSocketGateway({ path: "/origin", origins: ["https://ok.example"] })
@Injectable()
class OriginGateway {
  @SubscribeMessage("ping")
  ping(@MessageBody() data: unknown): unknown {
    return data;
  }
}

@WebSocketGateway({
  path: "/configured",
  maxPayloadLength: 1024,
  idleTimeoutMs: 1500,
  sendPings: true,
})
@Injectable()
class ConfiguredGateway {
  @SubscribeMessage("ping")
  ping(): string {
    return "pong";
  }
}

@Module({ providers: [OriginGateway] })
class OriginModule {}

@Module({ providers: [ConfiguredGateway] })
class ConfiguredModule {}

describe("Hono response surface", () => {
  test("applies declared headers and a bodyless status", async () => {
    const application = await AponiaFactory.create(SurfaceModule, { logger: false });
    const response = await application.getNativeApplication().request("/surface");

    expect(response.status).toBe(204);
    expect(response.headers.get("x-list")).toBe("a, b");
    expect(await response.text()).toBe("");
    await application.close();
  });

  test("applies a status name and array headers from @ResponseSettings", async () => {
    const application = await AponiaFactory.create(SurfaceModule, { logger: false });
    const response = await application.getNativeApplication().request("/surface/accepted");

    expect(response.status).toBe(202);
    expect(response.headers.get("x-list")).toBe("c, d");
    expect(await response.text()).toBe("created");
    await application.close();
  });

  test("refuses a gateway handshake whose origin is missing or not allowed", async () => {
    const application = await AponiaFactory.create(OriginModule, { logger: false });
    const native = application.getNativeApplication();

    expect((await native.request("/origin")).status).toBe(403);
    expect(
      (await native.request("/origin", { headers: { origin: "https://evil.example" } })).status,
    ).toBe(403);
    const allowed = await Promise.resolve(
      native.request("/origin", { headers: { origin: "https://ok.example" } }),
    ).catch(() => undefined);
    expect(allowed?.status).not.toBe(403);
    await application.close();
  });

  test("answers through the context status helper", async () => {
    const application = await AponiaFactory.create(SurfaceModule, { logger: false });
    const response = await application.getNativeApplication().request("/surface/status");

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true });
    await application.close();
  });

  test("applies the merged gateway options to the listener", async () => {
    const application = await AponiaFactory.create(ConfiguredModule, { logger: false });
    await application.listen(0, { shutdownSignals: false });
    expect(application.getUrl()).toStartWith("http://");
    await application.close();
  });
});
