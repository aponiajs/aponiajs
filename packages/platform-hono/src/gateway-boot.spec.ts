import { describe, expect, test } from "bun:test";
import {
  AponiaError,
  Injectable,
  MessageBody,
  Module,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type CanActivate,
} from "@aponiajs/common";
import { createBootstrapFactory } from "./application/bootstrap.ts";
import type { GatewayHooks, GatewayPlan, PlatformHost } from "@aponiajs/common";

@Injectable()
class AllowGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

@WebSocketGateway("/ws")
@Injectable()
class FirstGateway {
  @WebSocketServer() server: unknown;

  @SubscribeMessage("ping")
  ping(@MessageBody() data: unknown): unknown {
    return data;
  }
}

@WebSocketGateway("/ws")
@Injectable()
class DuplicatePathGateway {
  @SubscribeMessage("other")
  other(): string {
    return "other";
  }
}

@WebSocketGateway("/second")
@Injectable()
class DuplicateEventGateway {
  @SubscribeMessage("ping")
  ping(): string {
    return "ping";
  }
}

@WebSocketGateway({ path: "/guarded", guards: [AllowGuard] })
@Injectable()
class GuardedGateway {
  @SubscribeMessage("ping")
  ping(): string {
    return "guarded";
  }
}

interface FakeApp {
  readonly name: string;
}

function hostWithGateway(): PlatformHost<FakeApp> & {
  readonly mounted: { plan: GatewayPlan; hooks: GatewayHooks }[];
} {
  const mounted: { plan: GatewayPlan; hooks: GatewayHooks }[] = [];
  return {
    name: "fake",
    mounted,
    createApplication: (name) => ({ name }),
    mountRoute() {},
    mountGateway(_application, plan, hooks) {
      mounted.push({ plan, hooks });
    },
  };
}

function hostWithoutGateway(): PlatformHost<FakeApp> {
  return {
    name: "plain",
    createApplication: (name) => ({ name }),
    mountRoute() {},
  };
}

describe("the platform boot's gateway passes", () => {
  test("mounts a gateway and injects the server reference", async () => {
    @Module({ providers: [FirstGateway] })
    class GatewayModule {}

    const host = hostWithGateway();
    const application = await createBootstrapFactory(host).create(GatewayModule, {
      logger: false,
    });

    expect(host.mounted).toHaveLength(1);
    expect(host.mounted[0]?.plan.path).toBe("/ws");
    expect(application.get(FirstGateway)).toBeDefined();
    await application.close();
  });

  test("refuses two gateways on one path", async () => {
    @Module({ providers: [FirstGateway, DuplicatePathGateway] })
    class DuplicateModule {}

    try {
      await createBootstrapFactory(hostWithGateway()).create(DuplicateModule, { logger: false });
      throw new Error("Expected the boot to refuse the second gateway.");
    } catch (error) {
      expect(error).toBeInstanceOf(AponiaError);
      expect((error as AponiaError).code).toBe("DUPLICATE_WEBSOCKET_GATEWAY");
    }
  });

  test("refuses two gateways answering one event", async () => {
    @Module({ providers: [FirstGateway, DuplicateEventGateway] })
    class DuplicateEventModule {}

    try {
      await createBootstrapFactory(hostWithGateway()).create(DuplicateEventModule, {
        logger: false,
      });
      throw new Error("Expected the boot to refuse the duplicate event.");
    } catch (error) {
      expect((error as AponiaError).code).toBe("DUPLICATE_WEBSOCKET_HANDLER");
    }
  });

  test("refuses a gateway on a host that cannot upgrade", async () => {
    @Module({ providers: [FirstGateway] })
    class GatewayModule {}

    try {
      await createBootstrapFactory(hostWithoutGateway()).create(GatewayModule, { logger: false });
      throw new Error("Expected the boot to refuse the gateway.");
    } catch (error) {
      expect(error).toBeInstanceOf(AponiaError);
      expect((error as AponiaError).code).toBe("UNSUPPORTED_PLATFORM_FEATURE");
    }
  });

  test("resolves a gateway's handshake guards", async () => {
    @Module({ providers: [GuardedGateway, AllowGuard] })
    class GuardedModule {}

    const host = hostWithGateway();
    await createBootstrapFactory(host).create(GuardedModule, { logger: false });
    const client = {
      sent: [],
      close: () => undefined,
      subscribe: () => undefined,
      publish: () => undefined,
    };

    await host.mounted[0]?.hooks.open(client as never);
    expect(host.mounted[0]?.plan.guards).toEqual([AllowGuard]);
  });
});
