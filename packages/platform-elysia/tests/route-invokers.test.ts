import { expect, test } from "bun:test";
import { Body, Controller, Get, Module, Post, type ClassToken } from "@aponiajs/common";
import { t } from "elysia";
import {
  AponiaFactory,
  type AponiaApplicationOptions,
  type AponiaControllerInvokerFactory,
  type AponiaRouteInvoker,
} from "../src/index.ts";

const createItemSchema = {
  body: t.Object({ name: t.String({ minLength: 2 }) }),
};

const symbolProperty = Symbol("symbol-route");

@Controller("invokers")
class InvokerController {
  @Get()
  ping(): string {
    return "compiled";
  }

  @Get("promise")
  readPromise(): Promise<string> {
    return Promise.resolve("resolved");
  }

  @Post("items", createItemSchema)
  createItem(@Body() body: { name: string }): { name: string } {
    return { name: body.name };
  }

  @Get("unmapped")
  readUnmapped(): string {
    return "compiled-unmapped";
  }

  @Get("symbol")
  [symbolProperty](): string {
    return "compiled-symbol";
  }
}

@Module({ controllers: [InvokerController] })
class InvokerModule {}

class UnrelatedService {}

/**
 * Mirrors what the platform compiles: every invoker delegates to the container
 * instance with the argument the parameter decorators select.
 */
const mirroringInvokers: AponiaControllerInvokerFactory = (instance: InvokerController) =>
  new Map<string | symbol, AponiaRouteInvoker>([
    ["ping", () => instance.ping()],
    ["promise", async () => instance.readPromise()],
    ["createItem", (context) => instance.createItem(context.body as { name: string })],
  ]);

function createInvokers(factory: AponiaControllerInvokerFactory): AponiaApplicationOptions {
  return {
    logger: false,
    invokers: new Map<ClassToken<unknown>, AponiaControllerInvokerFactory>([
      [InvokerController, factory],
    ]),
  };
}

function postItem(body: unknown): Request {
  return new Request("http://localhost/invokers/items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("answers identically to a compiled controller when invokers are supplied", async () => {
  const compiled = await AponiaFactory.create(InvokerModule, { logger: false });
  const supplied = await AponiaFactory.create(InvokerModule, createInvokers(mirroringInvokers));

  const compiledPing = await compiled.handle(new Request("http://localhost/invokers"));
  const suppliedPing = await supplied.handle(new Request("http://localhost/invokers"));
  expect(suppliedPing.status).toBe(compiledPing.status);
  expect(await suppliedPing.text()).toBe("compiled");

  const compiledItem = await compiled.handle(postItem({ name: "Ada" }));
  const suppliedItem = await supplied.handle(postItem({ name: "Ada" }));
  expect(suppliedItem.status).toBe(compiledItem.status);
  expect(await suppliedItem.json()).toEqual({ name: "Ada" });

  const compiledRejected = await compiled.handle(postItem({ name: "A" }));
  const suppliedRejected = await supplied.handle(postItem({ name: "A" }));
  expect(compiledRejected.status).toBe(422);
  expect(suppliedRejected.status).toBe(compiledRejected.status);
  expect(await suppliedRejected.text()).toBe(await compiledRejected.text());

  const compiledPromise = await compiled.handle(new Request("http://localhost/invokers/promise"));
  const suppliedPromise = await supplied.handle(new Request("http://localhost/invokers/promise"));
  expect(await suppliedPromise.text()).toBe(await compiledPromise.text());

  await compiled.close();
  await supplied.close();
});

test("observes a resolved Promise in onAfterHandle when the supplied invoker is async", async () => {
  let observedResponse: unknown;
  const application = await AponiaFactory.create(InvokerModule, {
    ...createInvokers(mirroringInvokers),
    configureNative: (nativeApplication) =>
      nativeApplication.onAfterHandle(({ response }) => {
        observedResponse = response;
      }),
  });
  const response = await application.handle(new Request("http://localhost/invokers/promise"));

  expect(await response.text()).toBe("resolved");
  expect(observedResponse).toBe("resolved");
  expect(observedResponse).not.toBeInstanceOf(Promise);
  await application.close();
});

test("runs a supplied invoker instead of the compiled parameter binding", async () => {
  const application = await AponiaFactory.create(
    InvokerModule,
    createInvokers(
      (instance: InvokerController) =>
        new Map<string | symbol, AponiaRouteInvoker>([
          ["ping", () => `from-invoker:${instance.readUnmapped()}`],
        ]),
    ),
  );
  const response = await application.handle(new Request("http://localhost/invokers"));

  expect(await response.text()).toBe("from-invoker:compiled-unmapped");
  await application.close();
});

test("compiles handlers whose property key is missing from a supplied map", async () => {
  const application = await AponiaFactory.create(
    InvokerModule,
    createInvokers(
      () => new Map<string | symbol, AponiaRouteInvoker>([["ping", () => "from-invoker"]]),
    ),
  );
  const unmapped = await application.handle(new Request("http://localhost/invokers/unmapped"));
  const symbolRoute = await application.handle(new Request("http://localhost/invokers/symbol"));

  expect(await unmapped.text()).toBe("compiled-unmapped");
  expect(await symbolRoute.text()).toBe("compiled-symbol");
  await application.close();
});

test("compiles every route when the controller has no entry in the invokers map", async () => {
  const application = await AponiaFactory.create(InvokerModule, {
    logger: false,
    invokers: new Map(),
  });
  const response = await application.handle(new Request("http://localhost/invokers"));

  expect(await response.text()).toBe("compiled");
  await application.close();
});

test("ignores an invoker factory for a token that no controller uses", async () => {
  const application = await AponiaFactory.create(InvokerModule, {
    logger: false,
    invokers: new Map<ClassToken<unknown>, AponiaControllerInvokerFactory>([
      [UnrelatedService, () => new Map()],
    ]),
  });
  const response = await application.handle(new Request("http://localhost/invokers"));

  expect(await response.text()).toBe("compiled");
  await application.close();
});

test("does not mutate the supplied invokers option", async () => {
  const controllerInvokers = new Map<string | symbol, AponiaRouteInvoker>([
    ["ping", () => "mirrored"],
  ]);
  const invokers = new Map<ClassToken<unknown>, AponiaControllerInvokerFactory>([
    [InvokerController, () => controllerInvokers],
  ]);
  const options: AponiaApplicationOptions = { logger: false, invokers };
  const application = await AponiaFactory.create(InvokerModule, options);
  const response = await application.handle(new Request("http://localhost/invokers"));

  expect(await response.text()).toBe("mirrored");
  expect([...invokers.keys()]).toEqual([InvokerController]);
  expect([...controllerInvokers.keys()]).toEqual(["ping"]);
  expect(Object.keys(options)).toEqual(["logger", "invokers"]);
  await application.close();
});

@Controller("class-handler")
class ClassHandlerController {
  routeHandler = class RouteHandler {
    read(): string {
      return "never reached";
    }
  };
}

/**
 * TypeScript rejects a method decorator on a property, but the runtime applies
 * one anyway, which is how a class value reaches a route handler. Recording the
 * metadata directly reproduces that state without the rejected decorator.
 */
const recordRouteOnProperty: (target: object, propertyKey: string | symbol) => void =
  Get() as unknown as (target: object, propertyKey: string | symbol) => void;

recordRouteOnProperty(ClassHandlerController.prototype, "routeHandler");

@Module({ controllers: [ClassHandlerController] })
class ClassHandlerModule {}

test("rejects a class-valued route handler during bootstrap", async () => {
  const error = await AponiaFactory.create(ClassHandlerModule, { logger: false }).then(
    () => undefined,
    (reason: unknown) => reason,
  );

  expect(error).toEqual(
    expect.objectContaining({
      code: "INVALID_CONTROLLER",
      details: { controller: "ClassHandlerController", handler: "routeHandler" },
    }),
  );
});

test("rejects a class-valued route handler even when an invoker is supplied for it", async () => {
  const error = await AponiaFactory.create(ClassHandlerModule, {
    logger: false,
    invokers: new Map<ClassToken<unknown>, AponiaControllerInvokerFactory>([
      [
        ClassHandlerController,
        () => new Map<string | symbol, AponiaRouteInvoker>([["routeHandler", () => "invoked"]]),
      ],
    ]),
  }).then(
    () => undefined,
    (reason: unknown) => reason,
  );

  expect(error).toEqual(
    expect.objectContaining({
      code: "INVALID_CONTROLLER",
      details: { controller: "ClassHandlerController", handler: "routeHandler" },
    }),
  );
});
