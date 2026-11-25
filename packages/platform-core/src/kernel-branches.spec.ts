import { describe, expect, test } from "bun:test";
import {
  AponiaError,
  Controller,
  Get,
  Injectable,
  Body,
  Context,
  Param,
  Post,
  Query,
  Render,
  Sse,
  type Interceptor,
  type PipeTransform,
  type RouteParameterMetadata,
} from "@aponiajs/common";
import { Type } from "typebox";
import {
  buildArguments,
  compileRoutes,
  createHttpKernel,
  readHeaders,
  readQuery,
  validateSlot,
} from "./index.ts";
import type { MountedRoute, PlatformRouteContext } from "./interfaces/kernel.interface.ts";
import { HttpError } from "./exceptions/http-error.ts";

function context(overrides: Partial<Record<string, unknown>> = {}): PlatformRouteContext {
  const request = new Request("http://user.example/widgets/7?page=2");
  return {
    body: { name: "widget" },
    query: readQuery(new URL(request.url)),
    params: { id: "7" },
    headers: readHeaders(request),
    cookie: { session: { value: "abc" } },
    request,
    path: "/widgets/:id",
    set: { headers: {} },
    store: { answer: 42 },
    host: "user.example",
    status: () => new Response(null, { status: 202 }),
    server: { requestIP: () => ({ address: "203.0.113.9" }) },
    ...overrides,
  } as unknown as PlatformRouteContext;
}

function parameter(partial: Partial<RouteParameterMetadata>): RouteParameterMetadata {
  return { index: 0, kind: "body", ...partial } as RouteParameterMetadata;
}

describe("buildArguments", () => {
  test("reads every request source a parameter decorator can name", async () => {
    const parameters: RouteParameterMetadata[] = [
      parameter({ index: 0, kind: "body", property: "name" }),
      parameter({ index: 1, kind: "query", property: "page" }),
      parameter({ index: 2, kind: "params", property: "id" }),
      parameter({ index: 3, kind: "headers" }),
      parameter({ index: 4, kind: "cookie", property: "session" }),
      parameter({ index: 5, kind: "ip" }),
      parameter({ index: 6, kind: "host" }),
      parameter({ index: 7, kind: "store", property: "answer" }),
      parameter({ index: 8, kind: "request" }),
      parameter({ index: 9, kind: "set" }),
      parameter({ index: 10, kind: "context" }),
      parameter({ index: 11, kind: "status" }),
    ];

    const current = context();
    const args = await buildArguments(parameters, current, parameters.length, 12, [], []);

    expect(args[0]).toBe("widget");
    expect(args[1]).toBe("2");
    expect(args[2]).toBe("7");
    expect(typeof args[3]).toBe("object");
    expect(args[4]).toBe("abc");
    expect(args[5]).toBe("203.0.113.9");
    expect(args[6]).toBe("user.example");
    expect(args[7]).toBe(42);
    expect(args[8]).toBeInstanceOf(Request);
    expect(args[9]).toHaveProperty("headers");
    expect(args[10]).toBe(current);
    expect(typeof args[11]).toBe("function");
  });

  test("calls a custom parameter factory with its data", async () => {
    const args = await buildArguments(
      [
        parameter({
          kind: "custom",
          factory: (data, current) => `${String(data)}:${current.params["id"]}`,
          data: "id",
        }),
      ],
      context(),
      1,
      1,
      [],
      [],
    );

    expect(args[0]).toBe("id:7");
  });

  test("runs a parameter pipe over the value it read", async () => {
    class UpperPipe implements PipeTransform {
      transform(value: unknown): unknown {
        return String(value).toUpperCase();
      }
    }

    const args = await buildArguments(
      [parameter({ kind: "query", property: "page", pipes: [UpperPipe] })],
      context(),
      1,
      1,
      [],
      [],
    );

    expect(args[0]).toBe("2");
  });

  test("reads the host's first label when the decorator names a property", async () => {
    const args = await buildArguments(
      [parameter({ kind: "host", property: "host" })],
      context(),
      1,
      1,
      [],
      [],
    );

    expect(args[0]).toBe("user");
  });

  test("answers undefined for a named property on a value that states none", async () => {
    const args = await buildArguments(
      [parameter({ kind: "ip", property: "address" })],
      context({ server: undefined }),
      1,
      1,
      [],
      [],
    );

    expect(args[0]).toBeUndefined();
  });

  test("names the argument kind each piped parameter pipe receives", async () => {
    const seen: string[] = [];
    const recorder = {
      instance: {
        transform(value: unknown, metadata?: { readonly type?: string }): unknown {
          seen.push(String(metadata?.type));
          return value;
        },
      },
    };
    const kinds = [
      ["body", "body"],
      ["query", "query"],
      ["params", "param"],
      ["headers", "headers"],
      ["cookie", "cookie"],
    ] as const;

    for (const [kind] of kinds) {
      await buildArguments(
        [parameter({ kind, property: kind === "cookie" ? "session" : undefined })],
        context(),
        1,
        1,
        [],
        [recorder],
      );
    }

    expect(seen).toEqual(kinds.map(([, argument]) => argument));
  });

  test("passes the whole context to a handler that takes one parameter", async () => {
    const current = context();
    expect(await buildArguments([], current, 1, 1, [], [])).toEqual([current]);
  });

  test("passes nothing to a handler that takes none", async () => {
    expect(await buildArguments([], context(), 0, 0, [], [])).toEqual([]);
  });

  test("answers no address when the host stated none", async () => {
    const args = await buildArguments(
      [parameter({ kind: "ip" }), parameter({ index: 1, kind: "host" })],
      context({ server: undefined }),
      2,
      2,
      [],
      [],
    );

    expect(args[0]).toBeUndefined();
    expect(args[1]).toBe("user.example");
  });
});

describe("validateSlot", () => {
  const standard = (accept: boolean) => ({
    "~standard": {
      version: 1 as const,
      vendor: "test",
      validate: (value: unknown) =>
        accept
          ? { value: `${String(value)}!` }
          : { issues: [{ message: "refused", path: ["field"] }] },
    },
  });

  test("returns the value of an open slot", async () => {
    expect(await validateSlot(undefined, "kept", "body", false)).toBe("kept");
  });

  test("runs a Standard Schema validator through its hook", async () => {
    expect(await validateSlot(standard(true), "kept", "body", false)).toBe("kept!");
  });

  test("refuses what a Standard Schema validator rejects", async () => {
    try {
      await validateSlot(standard(false), "kept", "query", true);
      throw new Error("Expected the slot to be refused.");
    } catch (error) {
      const failure = error as { code?: string; problem?: { errors?: readonly unknown[] } };
      expect(failure.code).toBe("VALIDATION_ERROR");
      expect(failure.problem?.errors).toHaveLength(1);
    }
  });

  test("parses a native validator, converting string input when asked", async () => {
    expect(await validateSlot(Type.Number(), "5", "query", true)).toBe(5);
  });

  test("refuses what a native validator rejects", async () => {
    try {
      await validateSlot(Type.Number(), "five", "query", true);
      throw new Error("Expected the slot to be refused.");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("VALIDATION_ERROR");
    }
  });
});

const beforeOrder: string[] = [];

@Injectable()
class RecordingBeforeInterceptor implements Interceptor {
  interceptBefore(): void {
    beforeOrder.push("before");
  }
}

@Controller("views")
class ViewController {
  @Get("rendered")
  @Render("widgets.show")
  show(): { readonly name: string } {
    return { name: "widget" };
  }
}

const viewRoutes = compileRoutes(ViewController, "/views");

describe("the kernel's remaining branches", () => {
  test("runs the middleware chain and answers what next produced", async () => {
    const routes: MountedRoute[] = [
      {
        route: compileRoutes(ViewController, "/views")[0]!,
        controller: ViewController,
        instance: new ViewController(),
        guards: [],
        interceptors: [],
        filters: [],
        pipes: [],
      },
    ];
    const kernel = createHttpKernel({
      routes,
      middleware: async (_context, next) => next(),
      renderView: (template, data) =>
        `<main data-template="${template}">${JSON.stringify(data)}</main>`,
    });

    const response = await kernel.handle(new Request("http://localhost/views/rendered"));

    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain('data-template="widgets.show"');
  });

  test("answers a view route with an error when no renderer was mounted", async () => {
    const kernel = createHttpKernel({
      routes: [
        {
          route: viewRoutes[0]!,
          controller: ViewController,
          instance: new ViewController(),
          guards: [],
          interceptors: [],
          filters: [],
          pipes: [],
        },
      ],
    });

    const response = await kernel.handle(new Request("http://localhost/views/rendered"));
    expect(response.status).toBe(500);
  });

  test("runs an interceptor's before half ahead of the handler", async () => {
    beforeOrder.length = 0;
    @Controller("ordered")
    class OrderedController {
      @Get()
      run(): string {
        beforeOrder.push("handler");
        return "ordered";
      }
    }
    const [route] = compileRoutes(OrderedController, "/ordered");
    const response = await createHttpKernel({
      routes: [
        {
          route: route!,
          controller: OrderedController,
          instance: new OrderedController(),
          guards: [],
          interceptors: [new RecordingBeforeInterceptor()],
          filters: [],
          pipes: [],
        },
      ],
    }).handle(new Request("http://localhost/ordered"));

    expect(await response.text()).toBe("ordered");
    expect(beforeOrder).toEqual(["before", "handler"]);
  });

  test("answers an AponiaError as a 500 problem document", async () => {
    @Controller("faults")
    class FaultController {
      @Get()
      run(): string {
        throw new AponiaError("MISSING_PROVIDER", "gone", {});
      }
    }
    const [route] = compileRoutes(FaultController, "/faults");
    const response = await createHttpKernel({
      routes: [
        {
          route: route!,
          controller: FaultController,
          instance: new FaultController(),
          guards: [],
          interceptors: [],
          filters: [],
          pipes: [],
        },
      ],
    }).handle(new Request("http://localhost/faults"));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: "MISSING_PROVIDER" });
  });

  test("reports a failure a logger refused to report without losing the answer", async () => {
    @Controller("faults")
    class FaultController {
      @Get()
      run(): string {
        throw new Error("boom");
      }
    }
    const [route] = compileRoutes(FaultController, "/faults");
    const response = await createHttpKernel({
      routes: [
        {
          route: route!,
          controller: FaultController,
          instance: new FaultController(),
          guards: [],
          interceptors: [],
          filters: [],
          pipes: [],
        },
      ],
      logger: {
        log: () => undefined,
        error: () => {
          throw new Error("logger refused");
        },
        warn: () => undefined,
        debug: () => undefined,
        verbose: () => undefined,
        fatal: () => undefined,
      },
    }).handle(new Request("http://localhost/faults"));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  test("declines a filter that answers nothing and falls through to the next one", async () => {
    @Controller("faults")
    class FaultController {
      @Get()
      run(): string {
        throw new Error("boom");
      }
    }
    const [route] = compileRoutes(FaultController, "/faults");
    const order: string[] = [];
    const response = await createHttpKernel({
      routes: [
        {
          route: route!,
          controller: FaultController,
          instance: new FaultController(),
          guards: [],
          interceptors: [],
          filters: [
            {
              instance: {
                catch: () => {
                  order.push("first");
                  return undefined;
                },
              },
              exceptions: [],
            },
            {
              instance: {
                catch: () => {
                  order.push("second");
                  return new Response("answered", { status: 409 });
                },
              },
              exceptions: [],
            },
          ],
          pipes: [],
        },
      ],
    }).handle(new Request("http://localhost/faults"));

    expect(order).toEqual(["first", "second"]);
    expect(response.status).toBe(409);
  });

  test("answers a filter's own failure without retrying the failure", async () => {
    @Controller("faults")
    class FaultController {
      @Get()
      run(): string {
        throw new Error("boom");
      }
    }
    const [route] = compileRoutes(FaultController, "/faults");
    const response = await createHttpKernel({
      routes: [
        {
          route: route!,
          controller: FaultController,
          instance: new FaultController(),
          guards: [],
          interceptors: [],
          filters: [
            {
              instance: {
                catch: () => {
                  throw new Error("filter failed");
                },
              },
              exceptions: [],
            },
          ],
          pipes: [],
        },
      ],
    }).handle(new Request("http://localhost/faults"));

    expect(response.status).toBe(500);
  });

  test("answers a non-iterable value on an SSE route as a normal response", async () => {
    @Controller("events")
    class EventController {
      @Get()
      @Sse()
      run(): string {
        return "not a stream";
      }
    }
    const [route] = compileRoutes(EventController, "/events");
    const response = await createHttpKernel({
      routes: [
        {
          route: route!,
          controller: EventController,
          instance: new EventController(),
          guards: [],
          interceptors: [],
          filters: [],
          pipes: [],
        },
      ],
    }).handle(new Request("http://localhost/events"));

    expect(await response.text()).toBe("not a stream");
  });

  test("builds the response a middleware chain returned", async () => {
    @Controller("plain")
    class PlainController {
      @Get()
      run(): string {
        return "handler";
      }
    }
    const [route] = compileRoutes(PlainController, "/plain");
    const response = await createHttpKernel({
      routes: [
        {
          route: route!,
          controller: PlainController,
          instance: new PlainController(),
          guards: [],
          interceptors: [],
          filters: [],
          pipes: [],
        },
      ],
      middleware: async () => ({ from: "middleware" }),
    }).handle(new Request("http://localhost/plain"));

    expect(await response.json()).toEqual({ from: "middleware" });
  });

  test("forwards the host's own request object and peer address to the handler", async () => {
    @Controller("native")
    class NativeController {
      @Get()
      run(@Context() current: { readonly native?: unknown }): unknown {
        return { native: current.native };
      }
    }
    const [route] = compileRoutes(NativeController, "/native");
    const response = await createHttpKernel({
      routes: [
        {
          route: route!,
          controller: NativeController,
          instance: new NativeController(),
          guards: [],
          interceptors: [],
          filters: [],
          pipes: [],
        },
      ],
    }).handle(new Request("http://localhost/native"), { native: { host: "h" }, ip: "1.2.3.4" });

    expect(await response.json()).toEqual({ native: { host: "h" } });
  });

  test("validates every declared slot", async () => {
    @Controller("slots")
    class SlotsController {
      @Get(":id", {
        params: Type.Object({ id: Type.Number() }),
        headers: Type.Object({ "x-key": Type.String() }),
        cookie: Type.Object({ session: Type.String() }),
        query: Type.Object({ page: Type.Number() }),
      })
      run(@Param("id") id: number, @Query("page") page: number): unknown {
        return { id, page };
      }
    }
    const [route] = compileRoutes(SlotsController, "/slots");
    const response = await createHttpKernel({
      routes: [
        {
          route: route!,
          controller: SlotsController,
          instance: new SlotsController(),
          guards: [],
          interceptors: [],
          filters: [],
          pipes: [],
        },
      ],
    }).handle(
      new Request("http://localhost/slots/9?page=4", {
        headers: { "x-key": "yes", cookie: "session=s1" },
      }),
    );

    expect(await response.json()).toEqual({ id: 9, page: 4 });
  });

  test("offers a failure only to a filter whose catch list matches", async () => {
    @Controller("faults")
    class FaultController {
      @Get()
      run(): string {
        throw new TypeError("boom");
      }
    }
    const [route] = compileRoutes(FaultController, "/faults");
    const response = await createHttpKernel({
      routes: [
        {
          route: route!,
          controller: FaultController,
          instance: new FaultController(),
          guards: [],
          interceptors: [],
          filters: [
            { instance: { catch: () => new Response("caught") }, exceptions: [RangeError] },
          ],
          pipes: [],
        },
      ],
    }).handle(new Request("http://localhost/faults"));

    expect(response.status).toBe(500);
  });

  test("builds the response a matching filter returned", async () => {
    @Controller("faults")
    class FaultController {
      @Get()
      run(): string {
        throw new Error("boom");
      }
    }
    const [route] = compileRoutes(FaultController, "/faults");
    const response = await createHttpKernel({
      routes: [
        {
          route: route!,
          controller: FaultController,
          instance: new FaultController(),
          guards: [],
          interceptors: [],
          filters: [
            {
              instance: { catch: () => ({ handled: true }) },
              exceptions: [Error],
            },
          ],
          pipes: [],
        },
      ],
    }).handle(new Request("http://localhost/faults"));

    expect(await response.json()).toEqual({ handled: true });
  });

  test("declines a filter that threw and answers the original failure", async () => {
    @Controller("faults")
    class FaultController {
      @Get()
      run(): string {
        throw new Error("boom");
      }
    }
    const [route] = compileRoutes(FaultController, "/faults");
    const response = await createHttpKernel({
      routes: [
        {
          route: route!,
          controller: FaultController,
          instance: new FaultController(),
          guards: [],
          interceptors: [],
          filters: [
            {
              instance: {
                catch: () => {
                  throw new HttpError("Bad Gateway", { detail: "upstream" });
                },
              },
              exceptions: [],
            },
          ],
          pipes: [],
        },
      ],
    }).handle(new Request("http://localhost/faults"));

    expect(response.status).toBe(500);
  });

  test("closes an event stream the reader cancels", async () => {
    let returned = false;
    @Controller("events")
    class EventController {
      @Get()
      @Sse()
      stream(): AsyncIterable<unknown> {
        return {
          [Symbol.asyncIterator]() {
            return {
              next: () => new Promise(() => undefined),
              return: async () => {
                returned = true;
                return { done: true, value: undefined };
              },
            };
          },
        };
      }
    }
    const [route] = compileRoutes(EventController, "/events");
    const response = await createHttpKernel({
      routes: [
        {
          route: route!,
          controller: EventController,
          instance: new EventController(),
          guards: [],
          interceptors: [],
          filters: [],
          pipes: [],
        },
      ],
    }).handle(new Request("http://localhost/events"));

    await response.body?.cancel();
    expect(returned).toBe(true);
  });

  test("answers through the status helper a handler calls", async () => {
    @Controller("helpers")
    class HelperController {
      @Get()
      run(@Context() current: PlatformRouteContext): Response {
        return current.status("Accepted", { ok: true });
      }
    }
    const [route] = compileRoutes(HelperController, "/helpers");
    const response = await createHttpKernel({
      routes: [
        {
          route: route!,
          controller: HelperController,
          instance: new HelperController(),
          guards: [],
          interceptors: [],
          filters: [],
          pipes: [],
        },
      ],
    }).handle(new Request("http://localhost/helpers"));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("validates a body slot", async () => {
    @Controller("bodies")
    class BodyController {
      @Post({ body: Type.Object({ name: Type.String() }) })
      run(@Body() body: { readonly name: string }): unknown {
        return body;
      }
    }
    const [route] = compileRoutes(BodyController, "/bodies");
    const kernel = createHttpKernel({
      routes: [
        {
          route: route!,
          controller: BodyController,
          instance: new BodyController(),
          guards: [],
          interceptors: [],
          filters: [],
          pipes: [],
        },
      ],
    });

    const accepted = await kernel.handle(
      new Request("http://localhost/bodies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "widget" }),
      }),
    );
    expect(await accepted.json()).toEqual({ name: "widget" });

    const refused = await kernel.handle(
      new Request("http://localhost/bodies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: 1 }),
      }),
    );
    expect(refused.status).toBe(422);
  });

  test("keeps a cookie slot's value when the validator answers a non-object", async () => {
    @Controller("cookies")
    class CookieController {
      @Get(":id", {
        cookie: {
          "~standard": {
            version: 1 as const,
            vendor: "test",
            validate: () => ({ value: "replaced" }),
          },
        },
      })
      run(@Param("id") id: string): unknown {
        return { id };
      }
    }
    const [route] = compileRoutes(CookieController, "/cookies");
    const response = await createHttpKernel({
      routes: [
        {
          route: route!,
          controller: CookieController,
          instance: new CookieController(),
          guards: [],
          interceptors: [],
          filters: [],
          pipes: [],
        },
      ],
    }).handle(new Request("http://localhost/cookies/1", { headers: { cookie: "a=1" } }));

    expect(await response.json()).toEqual({ id: "1" });
  });

  test("lets a guard that allows continue to the handler", async () => {
    @Controller("allowed")
    class AllowedController {
      @Get()
      run(): string {
        return "open";
      }
    }
    const [route] = compileRoutes(AllowedController, "/allowed");
    const response = await createHttpKernel({
      routes: [
        {
          route: route!,
          controller: AllowedController,
          instance: new AllowedController(),
          guards: [{ canActivate: () => true }],
          interceptors: [],
          filters: [],
          pipes: [],
        },
      ],
    }).handle(new Request("http://localhost/allowed"));

    expect(await response.text()).toBe("open");
  });
});
