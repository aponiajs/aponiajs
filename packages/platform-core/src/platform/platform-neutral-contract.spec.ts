import { describe, expect, test } from "bun:test";
import { AponiaError, Controller, Get, Module, type AponiaErrorCode } from "@aponiajs/common";
import {
  createPlatformFactory,
  matchedRouteOf,
  provideHttpPolicies,
  providePlatformCapabilities,
  provideRequestLifecycleHook,
  requirePlatformCapabilities,
  type PlatformCapability,
  type PlatformHost,
} from "../index.ts";
import type { FakeApp } from "../../test/fixtures/fake-host.ts";
import { fakeHost } from "../../test/fixtures/fake-host.ts";

function codeOf(error: unknown): AponiaErrorCode | undefined {
  return error instanceof AponiaError ? error.code : undefined;
}

function hostWith(capabilities?: readonly PlatformCapability[]): PlatformHost<FakeApp> {
  const host = fakeHost();
  return capabilities === undefined ? host : { ...host, capabilities };
}

@Controller("probe")
class ProbeController {
  @Get()
  read(): string {
    return "ok";
  }
}

describe("platform capabilities", () => {
  test("refuses a registration that needs a capability the platform lacks", async () => {
    @Module({
      imports: [
        {
          module: class CapabilityModule {},
          id: "CapabilityModule",
          instanceId: Symbol.for("test.capability.module"),
          providers: [requirePlatformCapabilities("widgets", ["websockets"])],
        },
      ],
      controllers: [ProbeController],
    })
    class AppModule {}

    let thrown: unknown;
    try {
      await createPlatformFactory(hostWith(["http", "streaming"])).create(AppModule, {
        logger: false,
      });
    } catch (error) {
      thrown = error;
    }

    expect(codeOf(thrown)).toBe("UNSUPPORTED_PLATFORM_FEATURE");
    expect((thrown as AponiaError).details).toMatchObject({
      module: "widgets",
      platform: "fake",
      capability: "websockets",
    });
  });

  test("serves a registration whose capabilities the platform has", async () => {
    @Module({
      imports: [
        {
          module: class CapabilityModule {},
          id: "CapabilityModule",
          instanceId: Symbol.for("test.capability.present"),
          providers: [requirePlatformCapabilities("widgets", ["http"])],
        },
      ],
      controllers: [ProbeController],
    })
    class AppModule {}

    const application = await createPlatformFactory(hostWith(["http"])).create(AppModule, {
      logger: false,
    });

    try {
      expect((await application.handle(new Request("http://localhost/probe"))).status).toBe(200);
    } finally {
      await application.close();
    }
  });

  test("does not refuse a registration that only needs background work", async () => {
    @Module({
      imports: [
        {
          module: class ScheduledModule {},
          id: "ScheduledModule",
          instanceId: Symbol.for("test.capability.background"),
          providers: [requirePlatformCapabilities("scheduler", ["backgroundWork"])],
        },
      ],
      controllers: [ProbeController],
    })
    class AppModule {}

    const application = await createPlatformFactory(hostWith(["http"])).create(AppModule, {
      logger: false,
    });

    await application.close();
    expect(true).toBe(true);
  });

  test("rejects an unknown capability when it is declared", () => {
    expect(() =>
      providePlatformCapabilities({
        platform: "fake",
        capabilities: ["http", "telepathy" as PlatformCapability],
      }),
    ).toThrow(TypeError);
    expect(() =>
      requirePlatformCapabilities("widgets", ["telepathy" as PlatformCapability]),
    ).toThrow(TypeError);
    expect(() => requirePlatformCapabilities("  ", ["http"])).toThrow(TypeError);
  });
});

describe("neutral http policies", () => {
  test("answers before routing from onRequest and transforms the response from onResponse", async () => {
    const order: string[] = [];

    @Module({
      providers: [
        provideHttpPolicies(
          {
            name: "refuse-admin",
            onRequest(request) {
              order.push("refuse-admin");
              if (new URL(request.url).pathname === "/admin") {
                return new Response("no", { status: 403 });
              }
              return undefined;
            },
          },
          {
            name: "tag",
            onResponse: (request, response) => {
              order.push(`tag:${new URL(request.url).pathname}`);
              const headers = new Headers(response.headers);
              headers.set("x-tagged", "yes");
              return new Response(response.body, { status: response.status, headers });
            },
          },
        ),
      ],
      controllers: [ProbeController],
    })
    class AppModule {}

    const application = await createPlatformFactory(hostWith(["http"])).create(AppModule, {
      logger: false,
    });

    try {
      const refused = await application.handle(new Request("http://localhost/admin"));
      expect(refused.status).toBe(403);

      const answered = await application.handle(new Request("http://localhost/probe"));
      expect(answered.status).toBe(200);
      expect(answered.headers.get("x-tagged")).toBe("yes");
      // A short-circuit still runs the response policies, so the refusal carries
      // the same transforms the routed answer does.
      expect(order).toEqual(["refuse-admin", "tag:/admin", "refuse-admin", "tag:/probe"]);
    } finally {
      await application.close();
    }
  });

  test("rejects a policy with no name or no phase", () => {
    expect(() => provideHttpPolicies({ name: "", onRequest: () => undefined })).toThrow(TypeError);
    expect(() => provideHttpPolicies({ name: "empty" })).toThrow(TypeError);
  });
});

describe("neutral request lifecycle hooks", () => {
  test("short-circuits, observes the answer, and sees a failure before the filter", async () => {
    const seen: string[] = [];

    @Controller("broken")
    class BrokenController {
      @Get()
      read(): never {
        throw new Error("boom");
      }
    }

    @Module({
      providers: [
        provideRequestLifecycleHook({
          name: "replay",
          onRequest(request) {
            if (new URL(request.url).pathname === "/replay") {
              return new Response("replayed", { status: 200 });
            }
            return undefined;
          },
          onResponse(request, response) {
            seen.push(`response:${new URL(request.url).pathname}:${response.status}`);
          },
          onError(_request, error) {
            seen.push(`error:${error instanceof Error ? error.message : "unknown"}`);
          },
        }),
      ],
      controllers: [ProbeController, BrokenController],
    })
    class AppModule {}

    const application = await createPlatformFactory(hostWith(["http"])).create(AppModule, {
      logger: false,
    });

    try {
      expect((await application.handle(new Request("http://localhost/replay"))).status).toBe(200);
      expect((await application.handle(new Request("http://localhost/broken"))).status).toBe(500);
      expect(seen).toContain("response:/replay:200");
      expect(seen).toContain("error:boom");
    } finally {
      await application.close();
    }
  });

  test("rejects a hook with no name or no phase", () => {
    expect(() => provideRequestLifecycleHook({ name: "" })).toThrow(TypeError);
    expect(() => provideRequestLifecycleHook({ name: "empty" })).toThrow(TypeError);
  });
});

describe("matched route memory", () => {
  test("records the template a hook reads at the response boundary", async () => {
    const templates: (string | undefined)[] = [];

    @Controller("items")
    class ItemController {
      @Get(":id")
      read(): string {
        return "item";
      }
    }

    @Module({
      providers: [
        provideRequestLifecycleHook({
          name: "record",
          onResponse(request) {
            templates.push(matchedRouteOf(request));
          },
        }),
      ],
      controllers: [ItemController],
    })
    class AppModule {}

    const application = await createPlatformFactory(hostWith(["http"])).create(AppModule, {
      logger: false,
    });

    try {
      await application.handle(new Request("http://localhost/items/42"));
      expect(templates).toEqual(["/items/:id"]);
    } finally {
      await application.close();
    }
  });
});
