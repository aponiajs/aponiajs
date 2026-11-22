import { describe, expect, test } from "bun:test";
import { Controller, Get, Injectable, Module, type InjectionToken } from "@aponiajs/common";
import { AponiaApplication } from "@aponiajs/platform-elysia";
import {
  RequestContextModule,
  RequestContextService,
  type RequestContext,
} from "@aponiajs/platform-core";
import { AponiaFactory as ElysiaFactory } from "@aponiajs/platform-elysia";
import { AponiaFactory as H3Factory } from "@aponiajs/platform-h3";
import { AponiaFactory as HonoFactory } from "@aponiajs/platform-hono";
import type { Scoped } from "../src/index.ts";

const captured: Scoped<RequestContext>[] = [];

@Injectable()
class Probe {
  constructor(private readonly context: RequestContextService) {}

  capture(): string {
    const handle = this.context.scoped();
    captured.push(handle);
    return handle.get().requestId;
  }
}

@Controller("lifetime")
class LifetimeController {
  constructor(private readonly probe: Probe) {}

  @Get()
  read(): { readonly requestId: string } {
    return { requestId: this.probe.capture() };
  }
}

@Module({
  imports: [RequestContextModule.forRoot({ header: "x-request-id" })],
  controllers: [LifetimeController],
  providers: [Probe],
})
class LifetimeModule {}

function request(id: string): Request {
  return new Request("http://localhost/lifetime", { headers: { "x-request-id": id } });
}

function expectLastHandleStale(): void {
  const handle = captured.at(-1);
  expect(handle).toBeDefined();
  expect(() => handle?.get()).toThrow(expect.objectContaining({ code: "STALE_LIFETIME" }));
}

describe("request lifetimes on Elysia", () => {
  test("revokes the scope at the response boundary", async () => {
    const application = await ElysiaFactory.create(LifetimeModule, { logger: false });

    const response = await application.handle(request("elysia-one"));
    expect(await response.json()).toEqual({ requestId: "elysia-one" });
    expectLastHandleStale();

    await application.close();
  });

  test("concurrent requests keep independent scopes", async () => {
    const application = await ElysiaFactory.create(LifetimeModule, { logger: false });
    const [left, right] = await Promise.all([
      application.handle(request("elysia-left")),
      application.handle(request("elysia-right")),
    ]);

    expect(await left.json()).toEqual({ requestId: "elysia-left" });
    expect(await right.json()).toEqual({ requestId: "elysia-right" });
    expectLastHandleStale();

    await application.close();
  });
});

describe("request lifetimes on Hono", () => {
  test("revokes the scope at the response boundary", async () => {
    const application = await HonoFactory.create(LifetimeModule, { logger: false });

    const response = await application.handle(request("hono-one"));
    expect(await response.json()).toEqual({ requestId: "hono-one" });
    expectLastHandleStale();

    await application.close();
  });
});

describe("request lifetimes on H3", () => {
  test("revokes the scope at the response boundary", async () => {
    const application = await H3Factory.create(LifetimeModule, { logger: false });

    const response = await application.handle(request("h3-one"));
    expect(await response.json()).toEqual({ requestId: "h3-one" });
    expectLastHandleStale();

    await application.close();
  });
});

describe("RequestContextService", () => {
  test("refuses scoped() outside a request", () => {
    const service = new RequestContextService();

    expect(() => service.scoped()).toThrow(
      expect.objectContaining({ code: "MISSING_REQUEST_CONTEXT" }),
    );
  });

  test("opens lazily and releases by context", () => {
    const service = new RequestContextService();
    const context = fakeContext("lazy");

    service.run(context, () => {
      expect(service.current()).toBe(context);
      expect(service.isActive(context)).toBe(true);
      const handle = service.scoped();
      service.open(context);

      expect(handle.get()).toBe(context);
      service.release();
      expect(service.isActive(context)).toBe(false);
      expect(() => handle.get()).toThrow(expect.objectContaining({ code: "STALE_LIFETIME" }));
      service.release();
    });

    service.release();
    service.release(context.request);
    expect(service.isActive({})).toBe(true);
  });

  test("releases by request", () => {
    const service = new RequestContextService();
    const context = fakeContext("by-request");
    service.run(context, () => {
      const handle = service.scoped();
      service.release(context.request);
      expect(() => handle.get()).toThrow(expect.objectContaining({ code: "STALE_LIFETIME" }));
    });
  });
});

describe("AponiaApplication release", () => {
  test("releases after a synchronous handle result", () => {
    const released: Request[] = [];
    const application = new AponiaApplication(
      { handle: () => new Response("ok") } as never,
      undefined,
      (served) => {
        released.push(served);
      },
    );
    const incoming = request("sync");

    const response = application.handle(incoming);

    expect(response).toBeInstanceOf(Response);
    expect(released).toEqual([incoming]);
  });

  test("releases after an asynchronous handle result", async () => {
    const released: Request[] = [];
    const application = new AponiaApplication(
      { handle: async () => new Response("ok") } as never,
      undefined,
      (served) => {
        released.push(served);
      },
    );
    const incoming = request("async");

    const response = await application.handle(incoming);

    expect(response).toBeInstanceOf(Response);
    expect(released).toEqual([incoming]);
  });
});

function fakeContext(requestId: string): RequestContext {
  const store = new Map<symbol, unknown>();
  return {
    request: request(requestId),
    requestId,
    get<T>(key: InjectionToken<T>): T | undefined {
      return store.get(key.id) as T | undefined;
    },
    set<T>(key: InjectionToken<T>, value: T): void {
      store.set(key.id, value);
    },
  };
}
