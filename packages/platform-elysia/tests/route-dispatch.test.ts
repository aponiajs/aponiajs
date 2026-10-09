import { expect, test } from "bun:test";
import {
  Body,
  Controller,
  Cookie,
  Context,
  Get,
  Headers,
  Module,
  Param,
  Post,
  Query,
  Req,
  ResponseSettings,
  type RouteContext,
  type ResponseSettingsState,
} from "@aponiajs/common";
import { AponiaFactory, compileRootModule } from "../src/index.ts";

const escapedBodyProperty = 'quoted"\\\n${value}`';

/**
 * The two shapes Elysia 2's generated route body takes around the handler's
 * result. A handler whose return it cannot prove synchronous is awaited
 * unconditionally; one it can prove is called directly and awaited only when
 * the result turns out to be a thenable, which is the guard below.
 */
const AWAITED_HANDLER_MARKER = "_r=await _r";
const CONDITIONAL_HANDLER_AWAIT_MARKER = "if(typeof _r?.then==='function')";

/** The assignments Elysia 2's generated body makes for the fields it parses itself. */
const COOKIE_MATERIALIZED_MARKER = "c.cookie=";
const QUERY_MATERIALIZED_MARKER = "c.query=";

/**
 * The body Elysia generates for each mounted route, keyed by path.
 *
 * Elysia 2 no longer carries `PublicRoute.compile()` at runtime although its
 * own types still declare it, so the generated body is read from the
 * application's compiled-route list instead. That list is in route order, the
 * same order `routes` reports, which is what pairs the two.
 */
function compiledRouteSources(application: {
  getNativeApplication(): { readonly routes: readonly { readonly path: string }[] };
}): ReadonlyMap<string, string> {
  const nativeApplication = application.getNativeApplication() as unknown as {
    readonly routes: readonly { readonly path: string }[];
    readonly compiled?: readonly unknown[];
    compile(): unknown;
  };
  nativeApplication.compile();
  const sources = (nativeApplication.compiled ?? []).map((source) =>
    typeof source === "function" ? source.toString() : "",
  );

  return new Map(
    nativeApplication.routes.map((route, index) => [route.path, sources[index] ?? ""]),
  );
}

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
    @ResponseSettings() response: ResponseSettingsState,
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
  readResponse(@ResponseSettings() response: ResponseSettingsState): string {
    response.headers["x-dispatch"] = "response";
    return "response";
  }

  @Get("context")
  readContext(@Context() context: RouteContext): string {
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

interface CachedValue {
  readonly value: string;
}

@Controller("cached")
class CachedController {
  readonly pendingLookup: Promise<string> = Promise.resolve("deferred");

  @Get()
  readCached(): string | Promise<string> | undefined {
    return this.pendingLookup;
  }

  @Get("interface")
  readInterface(): CachedValue {
    return { value: "interface" };
  }
}

@Module({ controllers: [CachedController] })
class CachedModule {}

@Controller("async-handler")
class AsyncHandlerController {
  @Get()
  async read(): Promise<string> {
    return "async-handler";
  }
}

// TypeScript always emits Promise for an `async` handler, so the misleading
// design:returntype is written explicitly. It pins the signal order: the
// handler's own function kind is read before any declared return kind.
Reflect.defineMetadata("design:returntype", String, AsyncHandlerController.prototype, "read");

@Module({ controllers: [AsyncHandlerController] })
class AsyncHandlerModule {}

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
  const compiledRoutes = compiledRouteSources(application);
  const ping = compiledRoutes.get("/dispatch");
  const promised = compiledRoutes.get("/dispatch/promise");
  const newPromise = compiledRoutes.get("/dispatch/new-promise");
  const syncCall = compiledRoutes.get("/dispatch/sync-call");

  expect(ping).toBeDefined();
  expect(ping).not.toStartWith("async function");
  expect(ping).toContain(CONDITIONAL_HANDLER_AWAIT_MARKER);
  expect(ping).not.toContain(AWAITED_HANDLER_MARKER);
  expect(promised).toStartWith("async function");
  expect(promised).toContain(AWAITED_HANDLER_MARKER);
  expect(newPromise).toStartWith("async function");
  expect(newPromise).toContain(AWAITED_HANDLER_MARKER);
  expect(syncCall).not.toStartWith("async function");
  expect(syncCall).toContain(CONDITIONAL_HANDLER_AWAIT_MARKER);
  expect(syncCall).not.toContain(AWAITED_HANDLER_MARKER);

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
      nativeApplication.afterHandle(({ responseValue }) => {
        observedResponse = responseValue;
      }),
  });
  const compiledRoute = compiledRouteSources(application).get("/ambiguous-promise");
  const response = await application.handle(new Request("http://localhost/ambiguous-promise"));

  expect(await response.text()).toBe("resolved");
  expect(observedResponse).toBe("resolved");
  expect(observedResponse).not.toBeInstanceOf(Promise);
  expect(compiledRoute).toContain(AWAITED_HANDLER_MARKER);
  await application.close();
});

test("emits fixed route handlers with only their declared context capabilities", async () => {
  const application = await AponiaFactory.create(DispatchModule, { logger: false });
  const nativeApplication = application.getNativeApplication().compile();
  const handlers = new Map(
    nativeApplication.routes.map((route) => [route.path, route.handler.toString()]),
  );
  const compiledRoutes = compiledRouteSources(application);

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

  // Elysia materializes a context field only when the invoker it was handed
  // reads it, and its generated body assigns the two it must parse itself.
  const ping = compiledRoutes.get("/dispatch");
  expect(ping).toBeDefined();
  expect(ping).not.toContain(QUERY_MATERIALIZED_MARKER);
  expect(ping).not.toContain(COOKIE_MATERIALIZED_MARKER);

  const item = compiledRoutes.get("/dispatch/items/:id");
  expect(item).toContain(QUERY_MATERIALIZED_MARKER);
  expect(item).not.toContain(COOKIE_MATERIALIZED_MARKER);

  const body = compiledRoutes.get("/dispatch/body");
  expect(body).not.toContain(QUERY_MATERIALIZED_MARKER);
  expect(body).not.toContain(COOKIE_MATERIALIZED_MARKER);

  expect(compiledRoutes.get("/dispatch/cookie")).toContain(COOKIE_MATERIALIZED_MARKER);
  expect(compiledRoutes.get("/dispatch/request")).not.toContain(COOKIE_MATERIALIZED_MARKER);
  expect(compiledRoutes.get("/dispatch/request")).not.toContain(QUERY_MATERIALIZED_MARKER);
  expect(compiledRoutes.get("/dispatch/context")).toContain(COOKIE_MATERIALIZED_MARKER);
  expect(compiledRoutes.get("/dispatch/arguments-literals")).not.toContain(
    COOKIE_MATERIALIZED_MARKER,
  );
  expect(compiledRoutes.get("/dispatch/arguments-literals")).not.toContain(
    QUERY_MATERIALIZED_MARKER,
  );
  expect(compiledRoutes.get("/dispatch/arguments-properties")).not.toContain(
    COOKIE_MATERIALIZED_MARKER,
  );
  expect(compiledRoutes.get("/dispatch/arguments-properties")).not.toContain(
    QUERY_MATERIALIZED_MARKER,
  );
  expect(compiledRoutes.get("/dispatch/arguments-template")).toContain(COOKIE_MATERIALIZED_MARKER);
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

test("compiles a route Promise-capable when decorator metadata cannot prove a synchronous handler", async () => {
  const application = await AponiaFactory.create(MetadataFreeModule, {
    logger: false,
  });
  const compiledRoutes = compiledRouteSources(application);
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
  // Manually applied decorators record no design:returntype, and none of these
  // handlers is an async function, so nothing proves a synchronous return.
  expect(compiledRoutes.get("/metadata-free/literal")).toContain(AWAITED_HANDLER_MARKER);
  expect(compiledRoutes.get("/metadata-free/async-literal")).toContain(AWAITED_HANDLER_MARKER);
  expect(compiledRoutes.get("/metadata-free/promise")).toContain(AWAITED_HANDLER_MARKER);
  await application.close();
});

test("awaits a Promise returned without a call expression before after-handle hooks observe it", async () => {
  let observedResponse: unknown;
  const application = await AponiaFactory.create(CachedModule, {
    logger: false,
    configureNative: (nativeApplication) =>
      nativeApplication.afterHandle(({ responseValue }) => {
        observedResponse = responseValue;
      }),
  });
  const compiledRoute = compiledRouteSources(application).get("/cached");
  const response = await application.handle(new Request("http://localhost/cached"));

  expect(await response.text()).toBe("deferred");
  expect(observedResponse).toBe("deferred");
  expect(observedResponse).not.toBeInstanceOf(Promise);
  expect(compiledRoute).toContain(AWAITED_HANDLER_MARKER);
  await application.close();
});

test("compiles interface and union return types as Promise-capable", async () => {
  const application = await AponiaFactory.create(CachedModule, { logger: false });
  const compiledRoutes = compiledRouteSources(application);
  const cached = await application.handle(new Request("http://localhost/cached"));
  const interfaceResponse = await application.handle(
    new Request("http://localhost/cached/interface"),
  );

  expect(await cached.text()).toBe("deferred");
  expect(await interfaceResponse.json()).toEqual({ value: "interface" });
  expect(compiledRoutes.get("/cached")).toContain(AWAITED_HANDLER_MARKER);
  expect(compiledRoutes.get("/cached/interface")).toContain(AWAITED_HANDLER_MARKER);
  await application.close();
});

test("treats an async handler as Promise-capable when its design metadata names a synchronous type", async () => {
  let observedResponse: unknown;
  const definition = compileRootModule(AsyncHandlerModule);
  const controller = definition.controllers[0] as (typeof definition.controllers)[number] & {
    readonly compiledRoutes?: readonly { readonly declaredReturnKind?: string }[];
  };
  const application = await AponiaFactory.create(AsyncHandlerModule, {
    logger: false,
    configureNative: (nativeApplication) =>
      nativeApplication.afterHandle(({ responseValue }) => {
        observedResponse = responseValue;
      }),
  });
  const compiledRoute = compiledRouteSources(application).get("/async-handler");
  const response = await application.handle(new Request("http://localhost/async-handler"));

  // The misleading metadata really is in place, so the Promise-capable
  // classification can only come from the handler's own function kind.
  expect(controller.compiledRoutes?.[0]?.declaredReturnKind).toBe("synchronous");
  expect(await response.text()).toBe("async-handler");
  expect(observedResponse).toBe("async-handler");
  expect(observedResponse).not.toBeInstanceOf(Promise);
  expect(compiledRoute).toContain(AWAITED_HANDLER_MARKER);
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
