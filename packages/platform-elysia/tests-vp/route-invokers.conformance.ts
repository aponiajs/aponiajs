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
  type ControllerHandlerFactory,
  type AponiaInvokerArtifact,
  type RouteHandler,
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
  Equals<InvokersOption["invokers"], ReadonlyMap<ClassToken<unknown>, ControllerHandlerFactory>>
>;
type RouteInvokerAssertion = Expect<Equals<RouteHandler, (context: never) => unknown>>;

/**
 * The shape `aponia build` emits: each invoker's parameter is built from the
 * application's own parameter annotations, so it names the fields that route
 * reads and is assignable to `RouteHandler` without a cast. This is what
 * the artifact's whole purpose rests on, so it is asserted rather than assumed.
 */
type GeneratedRouteInvoker = (context: { readonly body: { readonly name: string } }) => unknown;
type GeneratedRouteInvokerAssertion = Expect<
  GeneratedRouteInvoker extends RouteHandler ? true : false
>;

/**
 * Declares the factory with a concrete instance type. The option type accepts
 * it without a cast because the factory parameter is `never`.
 *
 * The invoker's parameter is annotated, because `never` accepts every function
 * shape and therefore offers no context to infer one from. A hand-written
 * invoker that reads the context names it, exactly as a generated one is
 * written against its own route's annotations.
 */
const conformanceInvokers: ControllerHandlerFactory = (instance: ConformanceInvokerController) =>
  new Map<string | symbol, RouteHandler>([
    ["ping", () => instance.ping()],
    ["readPromise", async () => instance.readPromise()],
    [
      "createItem",
      (context: RouteContext) => instance.createItem(context.body as { name: string }),
    ],
  ]);

function conformanceArtifact(
  invokers: ReadonlyMap<ClassToken<unknown>, ControllerHandlerFactory>,
  framework: string = aponiaVersion,
): AponiaInvokerArtifact {
  return Object.freeze({ framework, elysia: "1.4.30", invokers });
}

const conformanceOptions: AponiaApplicationOptions = {
  logger: false,
  invokers: conformanceArtifact(
    new Map<ClassToken<unknown>, ControllerHandlerFactory>([
      [ConformanceInvokerController, conformanceInvokers],
    ]),
  ),
};

/**
 * The artifact shape the platform README documents: a map literal with no
 * explicit type arguments, which is what a reader copies. It has to be accepted
 * exactly as written, and it has to be the invoker that answers.
 */
const documentedOptions: AponiaApplicationOptions = {
  logger: false,
  invokers: Object.freeze({
    framework: aponiaVersion,
    elysia: "1.4.30",
    invokers: new Map([
      [
        ConformanceInvokerController,
        (instance: ConformanceInvokerController) =>
          new Map<string | symbol, RouteHandler>([["ping", () => `${instance.ping()}-documented`]]),
      ],
    ]),
  }),
};

test("the Vite+ lane types the invokers option and its invoker contracts", () => {
  const optionAssertion: InvokersOptionAssertion = true;
  const invokerMapAssertion: InvokerMapAssertion = true;
  const routeInvokerAssertion: RouteInvokerAssertion = true;
  const generatedRouteInvokerAssertion: GeneratedRouteInvokerAssertion = true;

  expect(optionAssertion).toBe(true);
  expect(invokerMapAssertion).toBe(true);
  expect(routeInvokerAssertion).toBe(true);
  expect(generatedRouteInvokerAssertion).toBe(true);
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

test("the Vite+ lane accepts the artifact shape the README documents", async () => {
  const application = await AponiaFactory.create(ConformanceInvokerModule, documentedOptions);
  const response = await application.handle(new Request("http://localhost/conformance-invokers"));

  expect(await response.text()).toBe("compiled-documented");
  await application.close();
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
      new Map<ClassToken<unknown>, ControllerHandlerFactory>([
        [
          ConformanceInvokerController,
          () => new Map<string | symbol, RouteHandler>([["ping", () => "from-another-release"]]),
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
