import { describe, expect, test } from "bun:test";
import {
  Controller,
  Injectable,
  Module,
  createToken,
  type AponiaMiddleware,
  type MiddlewareConsumer,
  type RouteContext,
} from "@aponiajs/common";
import { type RequestContext, type RequestContextRegistration } from "@aponiajs/common";
import {
  RequestContextModule,
  collectModuleMiddleware,
  isMiddlewareRouteExcluded,
  matchesMiddlewarePath,
  matchesMiddlewareTarget,
  resolveMiddlewareInstance,
  runMiddlewareChain,
} from "@aponiajs/core";
import type { ShutdownSignalTarget } from "@aponiajs/common";
import { installShutdownSignalHandlers } from "@aponiajs/common";

@Injectable()
class TraceMiddleware implements AponiaMiddleware {
  static readonly calls: string[] = [];

  use(context: RouteContext, next: () => Promise<unknown>): Promise<unknown> {
    TraceMiddleware.calls.push(context.path);
    return next();
  }
}

@Injectable()
class DependentMiddleware implements AponiaMiddleware {
  constructor(private readonly dependency: { readonly name: string }) {}

  use(_context: RouteContext, next: () => Promise<unknown>): Promise<unknown> {
    void this.dependency;
    return next();
  }
}

const DEPENDENCY = createToken<{ readonly name: string }>("Dependency");

@Module({})
class ConfiguredModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TraceMiddleware).forRoutes("/widgets");
  }
}

describe("middleware path matching", () => {
  test("matches literal, parameter, wildcard, and base paths", () => {
    expect(matchesMiddlewarePath("/widgets", "/widgets")).toBe(true);
    expect(matchesMiddlewarePath("/widgets/*", "/widgets/7")).toBe(true);
    expect(matchesMiddlewarePath("/widgets/*", "/widgets")).toBe(true);
    expect(matchesMiddlewarePath("/widgets/:id", "/widgets/7")).toBe(true);
    expect(matchesMiddlewarePath("/widgets/:id", "/widgets")).toBe(false);
    expect(matchesMiddlewarePath("*", "/anything")).toBe(true);
    expect(matchesMiddlewarePath("/other", "/widgets")).toBe(false);
    expect(matchesMiddlewarePath("/widgets/", "/widgets")).toBe(true);
    expect(matchesMiddlewarePath("widgets", "/widgets")).toBe(true);
    expect(matchesMiddlewarePath("", "/")).toBe(true);
  });

  test("matches a controller class and a route descriptor", () => {
    @Controller("widgets")
    class WidgetController {}

    @Controller()
    class PathlessController {}

    expect(matchesMiddlewareTarget(WidgetController, "/widgets/7", "GET")).toBe(true);
    expect(matchesMiddlewareTarget(PathlessController, "/users/1", "GET")).toBe(true);
    expect(matchesMiddlewareTarget({ path: "/widgets", method: "POST" }, "/widgets", "GET")).toBe(
      false,
    );
    expect(matchesMiddlewareTarget({ path: "/widgets", method: "GET" }, "/widgets", "GET")).toBe(
      true,
    );
    expect(matchesMiddlewareTarget({} as never, "/widgets", "GET")).toBe(false);

    class Undecorated {}
    expect(matchesMiddlewareTarget(Undecorated, "/widgets", "GET")).toBe(false);
  });

  test("honours exclusions by path and method", () => {
    expect(isMiddlewareRouteExcluded(["/health"], "/health", "GET")).toBe(true);
    expect(
      isMiddlewareRouteExcluded([{ path: "/widgets", method: "POST" }], "/widgets", "GET"),
    ).toBe(false);
    expect(
      isMiddlewareRouteExcluded([{ path: "/widgets", method: "POST" }], "/widgets", "POST"),
    ).toBe(true);
  });
});

describe("middleware resolution", () => {
  test("resolves an instance, a class, and a graph-provided class", () => {
    const instance = new TraceMiddleware();
    expect(resolveMiddlewareInstance(instance)).toBe(instance);
    expect(resolveMiddlewareInstance(TraceMiddleware)).toBeInstanceOf(TraceMiddleware);

    const container = {
      get: (token: unknown) =>
        token === DependentMiddleware ? new DependentMiddleware({ name: "value" }) : undefined,
    } as never;
    expect(resolveMiddlewareInstance(DependentMiddleware, container)).toBeInstanceOf(
      DependentMiddleware,
    );
  });

  test("refuses a class the graph cannot construct", () => {
    expect(() => resolveMiddlewareInstance(DependentMiddleware)).toThrow();
    expect(() => resolveMiddlewareInstance({} as never)).toThrow();

    const throwing = {
      get: () => {
        throw new Error("unavailable");
      },
    } as never;
    expect(resolveMiddlewareInstance(TraceMiddleware, throwing)).toBeInstanceOf(TraceMiddleware);

    class Broken {
      constructor() {
        throw new Error("cannot construct");
      }
    }
    expect(() => resolveMiddlewareInstance(Broken as never)).toThrow();
  });

  test("runs the matching chain in order and continues when none match", async () => {
    TraceMiddleware.calls.length = 0;
    const configs = [
      { middleware: [new TraceMiddleware()], targets: ["/widgets"], excluded: [] },
      { middleware: [new TraceMiddleware()], targets: ["/other"], excluded: [] },
    ] as never;

    const order: string[] = [];
    await runMiddlewareChain(
      configs,
      { path: "/widgets" } as never,
      "/widgets",
      "GET",
      async () => {
        order.push("next");
        return undefined;
      },
    );
    expect(order).toEqual(["next"]);
    expect(TraceMiddleware.calls).toEqual(["/widgets"]);

    order.length = 0;
    await runMiddlewareChain(configs, { path: "/none" } as never, "/none", "GET", async () => {
      order.push("next");
      return undefined;
    });
    expect(order).toEqual(["next"]);
  });

  test("collects module middleware through the module class", () => {
    const applications: string[] = [];
    const consumer = {
      apply: (...middleware: unknown[]) => ({
        forRoutes: () => {
          applications.push(String(middleware.length));
          return consumer;
        },
        exclude: () => consumer,
      }),
    } as never;
    const container = { get: () => new ConfiguredModule() } as never;

    collectModuleMiddleware(
      [{ id: "ConfiguredModule", moduleClass: ConfiguredModule }],
      container,
      consumer,
    );
    expect(applications).toEqual(["1"]);

    const fallback = {
      get: () => {
        throw new Error("not a provider");
      },
    } as never;
    collectModuleMiddleware(
      [{ id: "ConfiguredModule", moduleClass: ConfiguredModule }],
      fallback,
      consumer,
    );
    expect(applications).toEqual(["1", "1"]);

    const functional = {
      id: "FunctionalModule",
      configure: (target: MiddlewareConsumer) => {
        target.apply(TraceMiddleware).forRoutes("/functional");
      },
    };
    collectModuleMiddleware([functional], container, consumer);
    collectModuleMiddleware([{ id: "NoClass" }], container, consumer);
    expect(applications).toEqual(["1", "1", "1"]);
  });
});

describe("request context", () => {
  const header = "x-test-request-id";

  function registration(headerName = header, generate?: () => string): RequestContextRegistration {
    const module = RequestContextModule.forRoot({
      header: headerName,
      ...(generate === undefined ? {} : { generate }),
    });
    const found = (module.providers ?? []).find((entry) => {
      if (!("kind" in entry) || entry.kind !== "value") {
        return false;
      }
      const value = (entry as { useValue?: unknown }).useValue;
      return typeof value === "object" && value !== null && "enter" in value;
    }) as { useValue: RequestContextRegistration };
    return found.useValue;
  }

  test("caches one registration per header and echoes the request ID", async () => {
    const first = RequestContextModule.forRoot({ header });
    const second = RequestContextModule.forRoot({ header });
    expect(first).toBe(second);

    const current = registration();
    let echoed: string | undefined;
    let seen: RequestContext | undefined;
    await current.run(
      new Request("http://localhost/x", { headers: { [header]: "abc" } }),
      (_name, value) => {
        echoed = value;
      },
      async () => {
        seen = current.service.current() as RequestContext | undefined;
        return undefined;
      },
    );

    expect(echoed).toBe("abc");
    expect(seen).toBeDefined();
    expect(seen?.requestId).toBe("abc");
    expect(seen?.get(DEPENDENCY)).toBeUndefined();
    seen?.set(DEPENDENCY, { name: "stored" });
    expect(seen?.get(DEPENDENCY)).toEqual({ name: "stored" });
  });

  test("generates an ID and can enter the context without wrapping", () => {
    const current = registration("x-generated-test-id", () => "generated");
    let echoed: string | undefined;
    current.enter(new Request("http://localhost/x"), (_name, value) => {
      echoed = value;
    });
    expect(echoed).toBe("generated");
    expect(current.service.current()).toBeDefined();
  });
});

describe("shutdown signal installer", () => {
  function probe() {
    const listeners = new Map<string, Set<() => void>>([
      ["SIGTERM", new Set()],
      ["SIGINT", new Set()],
    ]);
    const kills: { readonly pid: number; readonly signal: string }[] = [];
    const target: ShutdownSignalTarget = {
      pid: 42,
      on(signal, listener) {
        listeners.get(signal)?.add(listener);
      },
      off(signal, listener) {
        listeners.get(signal)?.delete(listener);
      },
      kill(pid, signal) {
        kills.push({ pid, signal });
      },
    };
    return {
      target,
      kills,
      count(signal: string): number {
        return listeners.get(signal)?.size ?? 0;
      },
      emit(signal: string): void {
        for (const listener of listeners.get(signal) ?? []) {
          listener();
        }
      },
    };
  }

  test("installs both signals, runs the teardown once, and re-raises", async () => {
    const state = probe();
    let calls = 0;
    installShutdownSignalHandlers(
      async () => {
        calls += 1;
      },
      undefined,
      state.target,
    );

    expect(state.count("SIGTERM")).toBe(1);
    expect(state.count("SIGINT")).toBe(1);

    state.emit("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toBe(1);
    expect(state.count("SIGTERM")).toBe(0);
    expect(state.kills).toEqual([{ pid: 42, signal: "SIGTERM" }]);
  });

  test("reports a refusing logger and still re-raises", async () => {
    const state = probe();
    const logger = {
      error() {
        throw new Error("refused");
      },
    };
    installShutdownSignalHandlers(
      async () => {
        throw new Error("teardown failed");
      },
      logger as never,
      state.target,
    );

    state.emit("SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.kills).toEqual([{ pid: 42, signal: "SIGINT" }]);
  });
});
