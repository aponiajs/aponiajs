import {
  Body,
  Controller,
  Get,
  Module,
  Post,
  type ClassToken,
  type RouteContext,
} from "@aponiajs/common";
import { z } from "zod";
import {
  AponiaFactory,
  type AponiaApplicationOptions,
  type AponiaControllerInvokerFactory,
  type AponiaInvokerArtifact,
  type AponiaRouteInvoker,
} from "../src/index.ts";
import { aponiaVersion } from "../src/version.ts";

type VitePlusTest = typeof import("vite-plus/test");
type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

const conformanceCreateItemSchema = {
  body: z.object({ name: z.string().min(2) }),
};

@Controller("conformance-invokers")
class ConformanceInvokerController {
  @Get()
  ping(): string {
    return "compiled";
  }

  @Get("promise")
  readPromise(): Promise<string> {
    return Promise.resolve("resolved");
  }

  @Post("items", conformanceCreateItemSchema)
  createItem(@Body() body: { name: string }): { name: string } {
    return { name: body.name };
  }
}

@Module({ controllers: [ConformanceInvokerController] })
class ConformanceInvokerModule {}

type InvokersOption = NonNullable<AponiaApplicationOptions["invokers"]>;
type InvokersOptionAssertion = Expect<Equals<InvokersOption, AponiaInvokerArtifact>>;
type InvokerMapAssertion = Expect<
  Equals<
    InvokersOption["invokers"],
    ReadonlyMap<ClassToken<unknown>, AponiaControllerInvokerFactory>
  >
>;
type RouteInvokerAssertion = Expect<Equals<AponiaRouteInvoker, (context: RouteContext) => unknown>>;

/**
 * Declares the factory with a concrete instance type. The option type accepts
 * it without a cast because the factory parameter is `never`.
 */
const conformanceInvokers: AponiaControllerInvokerFactory = (
  instance: ConformanceInvokerController,
) =>
  new Map<string | symbol, AponiaRouteInvoker>([
    ["ping", () => instance.ping()],
    ["readPromise", async () => instance.readPromise()],
    ["createItem", (context) => instance.createItem(context.body as { name: string })],
  ]);

function conformanceArtifact(
  invokers: ReadonlyMap<ClassToken<unknown>, AponiaControllerInvokerFactory>,
  framework: string = aponiaVersion,
): AponiaInvokerArtifact {
  return Object.freeze({ framework, elysia: "1.4.30", invokers });
}

const conformanceOptions: AponiaApplicationOptions = {
  logger: false,
  invokers: conformanceArtifact(
    new Map<ClassToken<unknown>, AponiaControllerInvokerFactory>([
      [ConformanceInvokerController, conformanceInvokers],
    ]),
  ),
};

test("the Vite+ lane types the invokers option and its invoker contracts", () => {
  const optionAssertion: InvokersOptionAssertion = true;
  const invokerMapAssertion: InvokerMapAssertion = true;
  const routeInvokerAssertion: RouteInvokerAssertion = true;

  expect(optionAssertion).toBe(true);
  expect(invokerMapAssertion).toBe(true);
  expect(routeInvokerAssertion).toBe(true);
});

test("the Vite+ lane answers identically when generated invokers are supplied", async () => {
  const compiled = await AponiaFactory.create(ConformanceInvokerModule, { logger: false });
  const supplied = await AponiaFactory.create(ConformanceInvokerModule, conformanceOptions);

  const compiledPing = await compiled.handle(new Request("http://localhost/conformance-invokers"));
  const suppliedPing = await supplied.handle(new Request("http://localhost/conformance-invokers"));
  expect(await compiledPing.text()).toBe("compiled");
  expect(await suppliedPing.text()).toBe("compiled");

  const accepted = await supplied.handle(
    new Request("http://localhost/conformance-invokers/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada" }),
    }),
  );
  expect(await accepted.json()).toEqual({ name: "Ada" });

  const rejected = await supplied.handle(
    new Request("http://localhost/conformance-invokers/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "A" }),
    }),
  );
  expect(rejected.status).toBe(422);

  const promise = await supplied.handle(
    new Request("http://localhost/conformance-invokers/promise"),
  );
  expect(await promise.text()).toBe("resolved");

  await compiled.close();
  await supplied.close();
});

test("the Vite+ lane compiles a handler whose property key has no invoker", async () => {
  const application = await AponiaFactory.create(ConformanceInvokerModule, {
    logger: false,
    invokers: conformanceArtifact(new Map()),
  });
  const response = await application.handle(new Request("http://localhost/conformance-invokers"));

  expect(await response.text()).toBe("compiled");
  await application.close();
});

test("the Vite+ lane refuses an artifact from another framework release", async () => {
  const application = await AponiaFactory.create(ConformanceInvokerModule, {
    logger: false,
    invokers: conformanceArtifact(
      new Map<ClassToken<unknown>, AponiaControllerInvokerFactory>([
        [
          ConformanceInvokerController,
          () =>
            new Map<string | symbol, AponiaRouteInvoker>([["ping", () => "from-another-release"]]),
        ],
      ]),
      "0.0.0",
    ),
  });
  const response = await application.handle(new Request("http://localhost/conformance-invokers"));

  expect(await response.text()).toBe("compiled");
  await application.close();
});

@Controller("conformance-class-handler")
class ConformanceClassHandlerController {
  routeHandler = class RouteHandler {};
}

/**
 * TypeScript rejects a method decorator on a property, so the conformance lane
 * records the same metadata the runtime would receive from a JavaScript
 * application.
 */
const recordConformanceRouteOnProperty: (target: object, propertyKey: string | symbol) => void =
  Get() as unknown as (target: object, propertyKey: string | symbol) => void;

recordConformanceRouteOnProperty(ConformanceClassHandlerController.prototype, "routeHandler");

@Module({ controllers: [ConformanceClassHandlerController] })
class ConformanceClassHandlerModule {}

test("the Vite+ lane rejects a class-valued route handler at mount time", async () => {
  const error = await AponiaFactory.create(ConformanceClassHandlerModule, {
    logger: false,
  }).then(
    () => undefined,
    (reason: unknown) => reason,
  );

  expect(error).toEqual(
    expect.objectContaining({
      code: "INVALID_CONTROLLER",
      details: { controller: "ConformanceClassHandlerController", handler: "routeHandler" },
    }),
  );
});
