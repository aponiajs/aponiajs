import { describe, expect, test } from "bun:test";
import {
  Catch,
  Controller,
  Get,
  Header,
  HttpCode,
  Injectable,
  Ip,
  Param,
  Post,
  Query,
  Serialize,
  Sse,
  UseFilters,
  UseGuards,
  UseInterceptors,
  type CanActivate,
  type ExceptionFilter,
  type ExecutionContext,
  type Interceptor,
} from "@aponiajs/common";
import { Type } from "typebox";
import { compileRoutes, createHttpKernel } from "../src/index.ts";
import type { MountedRoute, ResolvedFilter } from "../src/kernel/kernel.types.ts";

@Injectable()
class DenyGuard implements CanActivate {
  canActivate(): boolean {
    return false;
  }
}

@Injectable()
class TagInterceptor implements Interceptor {
  interceptBefore(): void {}
  interceptAfter(_context: ExecutionContext, value: unknown): unknown {
    return { wrapped: value };
  }
}

@Catch()
@Injectable()
class RecordingFilter implements ExceptionFilter {
  readonly caught: unknown[] = [];
  catch(error: unknown): unknown {
    this.caught.push(error);
    return new Response("filtered", { status: 418 });
  }
}

const serialize = (value: unknown): unknown => ({ serialized: value });

@Controller("widgets")
class WidgetController {
  @Get(":id")
  find(@Param("id") id: string): { readonly id: string } {
    return { id };
  }

  @Post()
  create(@Param() _unused: unknown): string {
    return "created";
  }

  @Get("validated", { query: Type.Object({ page: Type.Number() }) })
  validated(@Query("page") page: number): { readonly page: number } {
    return { page };
  }

  @Get("guarded")
  @UseGuards(DenyGuard)
  guarded(): string {
    return "secret";
  }

  @Get("wrapped")
  @UseInterceptors(TagInterceptor)
  wrapped(): string {
    return "value";
  }

  @Get("serialized")
  @Serialize(serialize)
  serialized(): number {
    return 7;
  }

  @Get("declared")
  @Header("x-declared", "yes")
  @HttpCode(201)
  declared(): string {
    return "declared";
  }

  @Get("events")
  @Sse()
  async *events(): AsyncGenerator<{ readonly tick: number }> {
    yield { tick: 1 };
    yield { tick: 2 };
  }

  @Get("ip")
  address(@Ip() address: string | undefined): { readonly address?: string } {
    return { address };
  }

  @Get("boom")
  @UseFilters(RecordingFilter)
  boom(): string {
    throw new Error("exploded");
  }
}

const controller = new WidgetController();
const filter = new RecordingFilter();
const routes = compileRoutes(WidgetController, "/widgets");
const byRoute = new Map(routes.map((route) => [`${route.method} ${route.path}`, route]));

function mount(key: string, extra: Partial<MountedRoute> = {}): MountedRoute {
  const route = byRoute.get(key);
  if (route === undefined) {
    throw new Error(`The controller declares no route "${key}".`);
  }
  return {
    route,
    controller: WidgetController,
    instance: controller,
    guards: [],
    interceptors: [],
    filters: [],
    pipes: [],
    ...extra,
  };
}

const guarded = mount("GET /widgets/guarded", { guards: [new DenyGuard()] });
const wrapped = mount("GET /widgets/wrapped", { interceptors: [new TagInterceptor()] });
const boom = mount("GET /widgets/boom", {
  filters: [{ instance: filter, exceptions: [] } satisfies ResolvedFilter],
});

const k = createHttpKernel({
  routes: [
    mount("GET /widgets/:id"),
    mount("POST /widgets"),
    mount("GET /widgets/validated"),
    guarded,
    wrapped,
    mount("GET /widgets/serialized"),
    mount("GET /widgets/declared"),
    mount("GET /widgets/events"),
    mount("GET /widgets/ip"),
    boom,
  ],
});

describe("the HTTP kernel", () => {
  test("matches a parameter route and calls the handler", async () => {
    const response = await k.handle(new Request("http://localhost/widgets/42"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "42" });
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  test("answers 404 with a problem document when nothing matches", async () => {
    const response = await k.handle(new Request("http://localhost/none"));

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  test("coerces a query value against the declared schema", async () => {
    const response = await k.handle(new Request("http://localhost/widgets/validated?page=3"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ page: 3 });
  });

  test("refuses a value the schema rejects with 422 and an issue list", async () => {
    const response = await k.handle(
      new Request("http://localhost/widgets/validated?page=not-a-number"),
    );

    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      readonly code: string;
      readonly errors: readonly { readonly slot: string }[];
    };
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.errors[0]?.slot).toBe("query");
  });

  test("refuses the request a guard refuses, without calling the handler", async () => {
    const response = await k.handle(new Request("http://localhost/widgets/guarded"));

    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  test("lets an interceptor replace the handler's value", async () => {
    const response = await k.handle(new Request("http://localhost/widgets/wrapped"));

    expect(await response.json()).toEqual({ wrapped: "value" });
  });

  test("runs the serializer before answering", async () => {
    const response = await k.handle(new Request("http://localhost/widgets/serialized"));

    expect(await response.json()).toEqual({ serialized: 7 });
  });

  test("applies the declared status and headers", async () => {
    const response = await k.handle(new Request("http://localhost/widgets/declared"));

    expect(response.status).toBe(201);
    expect(response.headers.get("x-declared")).toBe("yes");
  });

  test("streams an SSE route as an event stream", async () => {
    const response = await k.handle(new Request("http://localhost/widgets/events"));

    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const text = await response.text();
    expect(text).toContain('data: {"tick":1}');
    expect(text).toContain('data: {"tick":2}');
  });

  test("answers the peer address the host stated", async () => {
    const response = await k.handle(new Request("http://localhost/widgets/ip"), {
      ip: "203.0.113.9",
    });

    expect(await response.json()).toEqual({ address: "203.0.113.9" });
  });

  test("offers a failure to the route's filter first", async () => {
    const response = await k.handle(new Request("http://localhost/widgets/boom"));

    expect(response.status).toBe(418);
    expect(await response.text()).toBe("filtered");
    expect(filter.caught).toHaveLength(1);
  });

  test("answers an unhandled failure as a 500 problem document and hides the cause", async () => {
    const failing = createHttpKernel({
      routes: [
        mount("GET /widgets/declared", {
          route: {
            ...routes.find((candidate) => candidate.path === "/widgets/declared")!,
            propertyKey: "missing",
          },
        }),
      ],
    });
    const response = await failing.handle(new Request("http://localhost/widgets/declared"));

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("exploded");
  });

  test("lets middleware answer before the route runs", async () => {
    const middlewareKernel = createHttpKernel({
      routes: [mount("GET /widgets/:id")],
      middleware: async () => new Response("middleware", { status: 202 }),
    });
    const response = await middlewareKernel.handle(new Request("http://localhost/widgets/1"));

    expect(response.status).toBe(202);
    expect(await response.text()).toBe("middleware");
  });

  test("tryHandle declines a request no route answers", async () => {
    expect(await k.tryHandle(new Request("http://localhost/none"))).toBeUndefined();
  });
});
