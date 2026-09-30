import { expect, test } from "bun:test";
import {
  Body,
  Controller,
  Get,
  Module,
  Post,
  type ClassToken,
  type LoggerService,
  type RouteContext,
} from "@aponiajs/common";
import { t } from "elysia";
import {
  AponiaFactory,
  type AponiaApplicationOptions,
  type AponiaControllerInvokerFactory,
  type AponiaInvokerArtifact,
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
    [
      "createItem",
      // The parameter is annotated because `AponiaRouteInvoker` declares it as
      // `never`: the type accepts every invoker shape, so it offers none to
      // infer from. A generated invoker is written the same way, against the
      // fields its own route reads.
      (context: RouteContext) => instance.createItem(context.body as { name: string }),
    ],
  ]);

/**
 * The version the running platform reports, read from the manifest it ships
 * rather than imported from the module under test, so a case that has to be
 * refused cannot accidentally agree with a broken implementation.
 */
const frameworkVersion = (
  (await Bun.file(new URL("../package.json", import.meta.url)).json()) as { version: string }
).version;

class RecordingLogger implements LoggerService {
  readonly records: { readonly context: string; readonly message: string }[] = [];

  log(message: unknown, context?: unknown): void {
    this.records.push({
      context: typeof context === "string" ? context : "",
      message: String(message),
    });
  }

  fatal(): void {}

  error(): void {}

  warn(): void {}
}

/**
 * An artifact shaped the way `aponia build` writes one. The overrides exist so a
 * case can state provenance the running platform will not accept.
 */
function artifact(
  invokers: ReadonlyMap<ClassToken<unknown>, AponiaControllerInvokerFactory>,
  overrides: Partial<Pick<AponiaInvokerArtifact, "framework" | "elysia">> = {},
): AponiaInvokerArtifact {
  return Object.freeze({ framework: frameworkVersion, elysia: "1.4.30", invokers, ...overrides });
}

function createInvokers(factory: AponiaControllerInvokerFactory): AponiaApplicationOptions {
  return {
    logger: false,
    invokers: artifact(
      new Map<ClassToken<unknown>, AponiaControllerInvokerFactory>([[InvokerController, factory]]),
    ),
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

test("observes a resolved Promise in afterHandle when the supplied invoker is async", async () => {
  let observedResponse: unknown;
  const application = await AponiaFactory.create(InvokerModule, {
    ...createInvokers(mirroringInvokers),
    configureNative: (nativeApplication) =>
      nativeApplication.afterHandle(({ responseValue }) => {
        observedResponse = responseValue;
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
    invokers: artifact(new Map()),
  });
  const response = await application.handle(new Request("http://localhost/invokers"));

  expect(await response.text()).toBe("compiled");
  await application.close();
});

test("ignores an invoker factory for a token that no controller uses", async () => {
  const application = await AponiaFactory.create(InvokerModule, {
    logger: false,
    invokers: artifact(
      new Map<ClassToken<unknown>, AponiaControllerInvokerFactory>([
        [UnrelatedService, () => new Map()],
      ]),
    ),
  });
  const response = await application.handle(new Request("http://localhost/invokers"));

  expect(await response.text()).toBe("compiled");
  await application.close();
});

test("does not mutate the supplied invoker artifact", async () => {
  const controllerInvokers = new Map<string | symbol, AponiaRouteInvoker>([
    ["ping", () => "mirrored"],
  ]);
  const invokers = new Map<ClassToken<unknown>, AponiaControllerInvokerFactory>([
    [InvokerController, () => controllerInvokers],
  ]);
  const options: AponiaApplicationOptions = { logger: false, invokers: artifact(invokers) };
  const application = await AponiaFactory.create(InvokerModule, options);
  const response = await application.handle(new Request("http://localhost/invokers"));

  expect(await response.text()).toBe("mirrored");
  expect([...invokers.keys()]).toEqual([InvokerController]);
  expect([...controllerInvokers.keys()]).toEqual(["ping"]);
  expect(Object.keys(options)).toEqual(["logger", "invokers"]);
  await application.close();
});

test("refuses an artifact from another framework release and compiles its routes", async () => {
  const logger = new RecordingLogger();
  const application = await AponiaFactory.create(InvokerModule, {
    logger,
    invokers: artifact(
      new Map<ClassToken<unknown>, AponiaControllerInvokerFactory>([
        [
          InvokerController,
          () =>
            new Map<string | symbol, AponiaRouteInvoker>([["ping", () => "from-another-release"]]),
        ],
      ]),
      { framework: "0.0.0", elysia: "1.0.0" },
    ),
  });

  const response = await application.handle(new Request("http://localhost/invokers"));

  expect(await response.text()).toBe("compiled");
  const refusal = logger.records.find((record) => record.context === "RoutesResolver");
  expect(refusal?.message).toContain("0.0.0");
  expect(refusal?.message).toContain("1.0.0");
  expect(refusal?.message).toContain(frameworkVersion);
  await application.close();
});

test("reports an unresolved Elysia version when it refuses an artifact", async () => {
  const logger = new RecordingLogger();
  const application = await AponiaFactory.create(InvokerModule, {
    logger,
    invokers: artifact(new Map(), { framework: "0.0.0", elysia: null }),
  });
  await application.handle(new Request("http://localhost/invokers"));

  const refusal = logger.records.find((record) => record.context === "RoutesResolver");
  expect(refusal?.message).toContain("an unresolved version");
  await application.close();
});

test("refuses an artifact that carries no invoker map", async () => {
  const logger = new RecordingLogger();
  // A JavaScript caller has no type checker, which is the state this states.
  const malformed = {
    framework: frameworkVersion,
    elysia: null,
    invokers: undefined,
  } as unknown as AponiaInvokerArtifact;
  const application = await AponiaFactory.create(InvokerModule, { logger, invokers: malformed });

  const response = await application.handle(new Request("http://localhost/invokers"));

  expect(await response.text()).toBe("compiled");
  const refusal = logger.records.find((record) => record.context === "RoutesResolver");
  expect(refusal?.message).toContain("no invoker map");
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
    invokers: artifact(
      new Map<ClassToken<unknown>, AponiaControllerInvokerFactory>([
        [
          ClassHandlerController,
          () => new Map<string | symbol, AponiaRouteInvoker>([["routeHandler", () => "invoked"]]),
        ],
      ]),
    ),
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
