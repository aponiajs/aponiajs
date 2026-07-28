import { expect, test } from "bun:test";
import {
  Body,
  Controller,
  Cookie,
  Ctx,
  Get,
  Headers,
  Module,
  Param,
  Post,
  Query,
  Req,
  Res,
  type RouteContext,
  type RouteResponseSettings,
} from "@aponiajs/common";
import { AponiaFactory, compileRootModule } from "../src/index.ts";

const escapedBodyProperty = 'quoted"\\\n${value}`';

@Controller("dispatch")
class DispatchController {
  @Get()
  ping(): string {
    return "Hi";
  }

  @Get("items/:id")
  async readItem(
    @Param("id") id: string,
    _unused: unknown,
    @Query("name") name: string | undefined,
    @Res() response: RouteResponseSettings,
  ): Promise<{ id: string; name: string | undefined; unused: boolean }> {
    response.headers["x-powered-by"] = "dispatch";
    return { id, name, unused: _unused === undefined };
  }

  @Post("body")
  readBody(@Body(escapedBodyProperty) value: string): { value: string } {
    return { value };
  }

  @Get("default-context")
  readDefaultContext(context: RouteContext = { path: "fallback" } as RouteContext): {
    path: string;
  } {
    return { path: context.path };
  }

  @Get("arguments-context")
  readArgumentsContext(): { path: string } {
    const context = arguments[0] as RouteContext;
    return { path: context.path };
  }

  @Get("promise")
  readPromise(): Promise<string> {
    return Promise.resolve("resolved");
  }

  @Get("new-promise")
  readNewPromise(): Promise<string> {
    return new Promise((resolve) => resolve("new"));
  }

  @Get("sync-call")
  readSyncCall(): string {
    return "sync".toUpperCase();
  }

  @Get("headers")
  readHeader(@Headers("x-dispatch") value: string | undefined): string {
    return value ?? "";
  }

  @Get("cookie")
  readCookie(@Cookie("session") value: string | undefined): string {
    return value ?? "";
  }

  @Get("request")
  readRequest(@Req() request: Request): string {
    return request.method;
  }

  @Get("response")
  readResponse(@Res() response: RouteResponseSettings): string {
    response.headers["x-dispatch"] = "response";
    return "response";
  }

  @Get("context")
  readContext(@Ctx() context: RouteContext): string {
    return context.path;
  }

  @Get("rest-context")
  readRestContext(...contexts: [RouteContext]): string {
    return contexts[0].path;
  }

  @Get("comment-only")
  readCommentOnly(/* The word arguments must not imply a context parameter. */): string {
    return "comment";
  }

  @Get("arguments-literals")
  readArgumentsLiterals(): string {
    const pattern = /arguments/;
    return "arguments:" + pattern.source;
  }

  @Get("arguments-properties")
  readArgumentsProperties(): string {
    return { arguments: "property" }.arguments;
  }

  @Get("arguments-template")
  readArgumentsTemplate(): string {
    return `path:${(arguments[0] as RouteContext).path}`;
  }
}

@Module({ controllers: [DispatchController] })
class DispatchModule {}

@Controller("ambiguous-promise")
class AmbiguousPromiseController {
  @Get()
  read(): unknown {
    return Promise.resolve("resolved");
  }
}

@Module({ controllers: [AmbiguousPromiseController] })
class AmbiguousPromiseModule {}

class MetadataFreeController {
  readLiteral(): string {
    return "literal";
  }

  readAsyncLiteral(): unknown {
    return "async";
  }

  readContext(context: RouteContext): string {
    return context.path;
  }

  readPromise(): Promise<string> {
    return Promise.resolve("promise");
  }

  readDefaultContext(context: RouteContext = { path: "fallback" } as RouteContext): string {
    return context.path;
  }
}

Controller("metadata-free")(MetadataFreeController);
for (const [method, path] of [
  ["readLiteral", "literal"],
  ["readAsyncLiteral", "async-literal"],
  ["readContext", "required-context"],
  ["readPromise", "promise"],
  ["readDefaultContext", "context"],
] as const) {
  Get(path)(
    MetadataFreeController.prototype,
    method,
    Object.getOwnPropertyDescriptor(
      MetadataFreeController.prototype,
      method,
    ) as TypedPropertyDescriptor<(...parameters: never[]) => unknown>,
  );
}

class MetadataFreeModule {}
Module({ controllers: [MetadataFreeController] })(MetadataFreeModule);

@Controller("invalid-route")
class InvalidRouteController {
  constructor() {
    Object.defineProperty(this, "read", { value: "not callable" });
  }

  @Get()
  read(): string {
    return "unreachable";
  }
}

@Module({ controllers: [InvalidRouteController] })
class InvalidRouteModule {}

test("precompiles parameter binding while preserving sparse, async, and escaped inputs", async () => {
  const application = await AponiaFactory.create(DispatchModule, { logger: false });
  const item = await application.handle(new Request("http://localhost/dispatch/items/42?name=Ada"));
  const body = await application.handle(
    new Request("http://localhost/dispatch/body", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [escapedBodyProperty]: "value" }),
    }),
  );

  expect(item.headers.get("x-powered-by")).toBe("dispatch");
  expect(await item.json()).toEqual({ id: "42", name: "Ada", unused: true });
  expect(await body.json()).toEqual({ value: "value" });
  await application.close();
});

test("keeps implicit context compatibility for zero-length JavaScript handlers", async () => {
  const application = await AponiaFactory.create(DispatchModule, { logger: false });
  const defaultContext = await application.handle(
    new Request("http://localhost/dispatch/default-context"),
  );
  const argumentsContext = await application.handle(
    new Request("http://localhost/dispatch/arguments-context"),
  );
  const restContext = await application.handle(
    new Request("http://localhost/dispatch/rest-context"),
  );
  const argumentsLiterals = await application.handle(
    new Request("http://localhost/dispatch/arguments-literals"),
  );
  const argumentsProperties = await application.handle(
    new Request("http://localhost/dispatch/arguments-properties"),
  );
  const argumentsTemplate = await application.handle(
    new Request("http://localhost/dispatch/arguments-template"),
  );

  expect(await defaultContext.json()).toEqual({ path: "/dispatch/default-context" });
  expect(await argumentsContext.json()).toEqual({ path: "/dispatch/arguments-context" });
  expect(await restContext.text()).toBe("/dispatch/rest-context");
  expect(await argumentsLiterals.text()).toBe("arguments:arguments");
  expect(await argumentsProperties.text()).toBe("property");
  expect(await argumentsTemplate.text()).toBe("path:/dispatch/arguments-template");
  await application.close();
});

test("keeps synchronous routes synchronous without breaking Promise-returning handlers", async () => {
  const application = await AponiaFactory.create(DispatchModule, { logger: false });
  const nativeApplication = application.getNativeApplication().compile();
  const compiledRoutes = new Map(
    nativeApplication.router.history.map((route) => [route.path, route.compile().toString()]),
  );
  const ping = compiledRoutes.get("/dispatch");
  const promised = compiledRoutes.get("/dispatch/promise");
  const newPromise = compiledRoutes.get("/dispatch/new-promise");
  const syncCall = compiledRoutes.get("/dispatch/sync-call");

  expect(ping).toBeDefined();
  expect(ping).not.toStartWith("async function");
  expect(ping).not.toContain("await handler(c)");
  expect(promised).toStartWith("async function");
  expect(promised).toContain("await handler(c)");
  expect(newPromise).toStartWith("async function");
  expect(newPromise).toContain("await handler(c)");
  expect(syncCall).not.toStartWith("async function");
  expect(syncCall).not.toContain("await handler(c)");

  const promisedResponse = await application.handle(
    new Request("http://localhost/dispatch/promise"),
  );
  const newPromiseResponse = await application.handle(
    new Request("http://localhost/dispatch/new-promise"),
  );
  expect(await promisedResponse.text()).toBe("resolved");
  expect(await newPromiseResponse.text()).toBe("new");
  await application.close();
});

test("awaits an ambiguous Promise result before running native after-handle hooks", async () => {
  let observedResponse: unknown;
  const application = await AponiaFactory.create(AmbiguousPromiseModule, {
    logger: false,
    configureNative: (nativeApplication) =>
      nativeApplication.onAfterHandle(({ response }) => {
        observedResponse = response;
      }),
  });
  const nativeApplication = application.getNativeApplication().compile();
  const compiledRoute = nativeApplication.router.history
    .find((route) => route.path === "/ambiguous-promise")
    ?.compile()
    .toString();
  const response = await application.handle(new Request("http://localhost/ambiguous-promise"));

  expect(await response.text()).toBe("resolved");
  expect(observedResponse).toBe("resolved");
  expect(observedResponse).not.toBeInstanceOf(Promise);
  expect(compiledRoute).toContain("await handler(c)");
  await application.close();
});

test("emits fixed route handlers with only their declared context capabilities", async () => {
  const application = await AponiaFactory.create(DispatchModule, { logger: false });
  const nativeApplication = application.getNativeApplication().compile();
  const handlers = new Map(
    nativeApplication.router.history.map((route) => [route.path, route.handler.toString()]),
  );
  const compiledRoutes = new Map(
    nativeApplication.router.history.map((route) => [route.path, route.compile().toString()]),
  );

  expect(handlers.get("/dispatch")).toContain("handler.call(instance)");
  expect(handlers.get("/dispatch")).toStartWith("()=>");
  expect(handlers.get("/dispatch")).not.toContain("handler.call(instance,context)");
  expect(handlers.get("/dispatch/items/:id")).toContain("context.params");
  expect(handlers.get("/dispatch/items/:id")).toContain("context.query");
  expect(handlers.get("/dispatch/items/:id")).toContain("context.set");
  expect(handlers.get("/dispatch/body")).toContain("context.body");
  expect(handlers.get("/dispatch/headers")).toContain("context.headers");
  expect(handlers.get("/dispatch/cookie")).toContain("context.cookie");
  expect(handlers.get("/dispatch/request")).toContain("context.request");
  expect(handlers.get("/dispatch/response")).toContain("context.set");
  expect(handlers.get("/dispatch/context")).toContain("handler.call(instance,context)");
  expect(handlers.get("/dispatch/rest-context")).toContain("handler.call(instance,context)");
  expect(handlers.get("/dispatch/comment-only")).not.toContain("handler.call(instance,context)");
  expect(handlers.get("/dispatch/arguments-literals")).not.toContain(
    "handler.call(instance,context)",
  );
  expect(handlers.get("/dispatch/arguments-properties")).not.toContain(
    "handler.call(instance,context)",
  );
  expect(handlers.get("/dispatch/arguments-template")).toContain("handler.call(instance,context)");

  for (const source of handlers.values()) {
    expect(source).not.toContain("Array.from");
    expect(source).not.toContain(".map(");
    expect(source).not.toContain("Math.max");
    expect(source).not.toContain("Reflect.apply");
  }

  const ping = compiledRoutes.get("/dispatch");
  expect(ping).toBeDefined();
  expect(ping).not.toContain("parseQueryFromURL");
  expect(ping).not.toContain("parseCookie");
  expect(ping).not.toContain("getServer");

  const item = compiledRoutes.get("/dispatch/items/:id");
  expect(item).toContain("parseQueryFromURL");
  expect(item).not.toContain("parseCookie");
  expect(item).not.toContain("getServer");

  const body = compiledRoutes.get("/dispatch/body");
  expect(body).not.toContain("parseQueryFromURL");
  expect(body).not.toContain("parseCookie");
  expect(body).not.toContain("getServer");

  expect(compiledRoutes.get("/dispatch/cookie")).toContain("parseCookie");
  expect(compiledRoutes.get("/dispatch/request")).not.toContain("parseCookie");
  expect(compiledRoutes.get("/dispatch/request")).not.toContain("parseQueryFromURL");
  expect(compiledRoutes.get("/dispatch/context")).toContain("parseCookie");
  expect(compiledRoutes.get("/dispatch/arguments-literals")).not.toContain("parseCookie");
  expect(compiledRoutes.get("/dispatch/arguments-literals")).not.toContain("parseQueryFromURL");
  expect(compiledRoutes.get("/dispatch/arguments-properties")).not.toContain("parseCookie");
  expect(compiledRoutes.get("/dispatch/arguments-properties")).not.toContain("parseQueryFromURL");
  expect(compiledRoutes.get("/dispatch/arguments-template")).toContain("parseCookie");
  await application.close();
});

test("freezes deterministic route plans before controller registration", () => {
  const definition = compileRootModule(DispatchModule);
  const controller = definition.controllers[0] as (typeof definition.controllers)[number] & {
    readonly compiledRoutes?: readonly {
      readonly path: string;
      readonly capabilities: readonly string[];
    }[];
    readonly registerRoutes?: unknown;
  };
  const routes = controller.compiledRoutes;

  expect(typeof controller.registerRoutes).toBe("function");
  expect(routes).toBeDefined();
  expect(Object.isFrozen(routes)).toBe(true);
  expect(routes?.every(Object.isFrozen)).toBe(true);
  expect(routes?.find((route) => route.path === "/dispatch/items/:id")?.capabilities).toEqual([
    "params",
    "query",
    "set",
  ]);
  expect(routes?.find((route) => route.path === "/dispatch")?.capabilities).toEqual([]);
  expect(routes?.find((route) => route.path === "/dispatch/default-context")?.capabilities).toEqual(
    ["context"],
  );
  expect(
    routes?.find((route) => route.path === "/dispatch/arguments-literals")?.capabilities,
  ).toEqual([]);
  expect(
    routes?.find((route) => route.path === "/dispatch/arguments-properties")?.capabilities,
  ).toEqual([]);
  expect(
    routes?.find((route) => route.path === "/dispatch/arguments-template")?.capabilities,
  ).toEqual(["context"]);
  expect(
    Object.isFrozen(routes?.find((route) => route.path === "/dispatch/items/:id")?.capabilities),
  ).toBe(true);
});

test("falls back to function source when decorator design metadata is absent", async () => {
  const application = await AponiaFactory.create(MetadataFreeModule, {
    logger: false,
  });
  const nativeApplication = application.getNativeApplication().compile();
  const compiledRoutes = new Map(
    nativeApplication.router.history.map((route) => [route.path, route.compile().toString()]),
  );
  const literal = await application.handle(new Request("http://localhost/metadata-free/literal"));
  const asyncLiteral = await application.handle(
    new Request("http://localhost/metadata-free/async-literal"),
  );
  const promised = await application.handle(new Request("http://localhost/metadata-free/promise"));
  const requiredContext = await application.handle(
    new Request("http://localhost/metadata-free/required-context"),
  );
  const context = await application.handle(new Request("http://localhost/metadata-free/context"));

  expect(await literal.text()).toBe("literal");
  expect(await asyncLiteral.text()).toBe("async");
  expect(await promised.text()).toBe("promise");
  expect(await requiredContext.text()).toBe("/metadata-free/required-context");
  expect(await context.text()).toBe("/metadata-free/context");
  expect(compiledRoutes.get("/metadata-free/literal")).not.toContain("await handler(c)");
  expect(compiledRoutes.get("/metadata-free/async-literal")).not.toContain("await handler(c)");
  expect(compiledRoutes.get("/metadata-free/promise")).toContain("await handler(c)");
  await application.close();
});

test("rejects an instance that replaces a decorated route with a non-function", async () => {
  const error = await AponiaFactory.create(InvalidRouteModule, {
    logger: false,
  }).then(
    () => undefined,
    (reason: unknown) => reason,
  );

  expect(error).toEqual(
    expect.objectContaining({
      code: "INVALID_CONTROLLER",
      details: {
        controller: "InvalidRouteController",
        handler: "read",
      },
    }),
  );
});
