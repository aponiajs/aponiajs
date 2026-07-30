import { treaty, type Treaty } from "@elysia/eden";
import { defineModule } from "@aponiajs/common";
import { Elysia, t } from "elysia";
import {
  AponiaFactory,
  defineElysiaController,
  defineElysiaPlugin,
  elysiaController,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;

class EdenConformanceController {
  read(id: number): { id: number; source: "aponia" } {
    return { id, source: "aponia" };
  }
}

const edenConformanceController = defineElysiaController(EdenConformanceController, {
  inject: [] as const,
  buildPlugin: (controller) =>
    new Elysia({ name: "aponia-eden-conformance" }).get(
      "/eden-conformance/:id",
      ({ params }) => controller.read(params.id),
      {
        params: t.Object({ id: t.Number() }),
        response: t.Object({
          id: t.Number(),
          source: t.Literal("aponia"),
        }),
      },
    ),
});

class RegisteredConformanceController {
  read(id: number): { id: number; source: "registered" } {
    return { id, source: "registered" };
  }
}

const registeredConformanceController = elysiaController(
  RegisteredConformanceController,
  (application, controller) =>
    application.get("/registered-conformance/:id", ({ params }) => controller.read(params.id), {
      params: t.Object({ id: t.Number() }),
      response: t.Object({
        id: t.Number(),
        source: t.Literal("registered"),
      }),
    }),
);
const edenConformancePlugin = defineElysiaPlugin(
  new Elysia({ name: "aponia-eden-native-conformance" }).get(
    "/native-conformance",
    () => ({ source: "native" as const }),
    {
      response: t.Object({ source: t.Literal("native") }),
    },
  ),
  { key: "eden-native-conformance" },
);
const nativeCombinedApplication = new Elysia()
  .use(edenConformancePlugin.plugin)
  .use(edenConformanceController.buildPlugin(new EdenConformanceController()))
  .use(registeredConformanceController.buildPlugin(new RegisteredConformanceController()));
const edenConformanceModule = defineModule({
  id: "EdenConformanceModule",
  imports: [edenConformancePlugin],
  controllers: [edenConformanceController],
});
const registeredConformanceModule = defineModule({
  id: "RegisteredConformanceModule",
  controllers: [registeredConformanceController],
});
const combinedConformanceModule = defineModule({
  id: "CombinedConformanceModule",
  imports: [edenConformancePlugin],
  controllers: [edenConformanceController, registeredConformanceController],
});

function createEdenConformanceApplication() {
  return AponiaFactory.createNative(edenConformanceModule, {
    logger: false,
  });
}

function createRegisteredConformanceApplication() {
  return AponiaFactory.createNative(registeredConformanceModule, {
    logger: false,
  });
}

function createCombinedConformanceApplication() {
  return AponiaFactory.createNative(combinedConformanceModule, {
    logger: false,
  });
}

type EdenConformanceApplication = Awaited<ReturnType<typeof createEdenConformanceApplication>>;
type EdenConformanceClient = Treaty.Create<EdenConformanceApplication>;
type EdenConformancePath = ReturnType<EdenConformanceClient["eden-conformance"]>;
type ConformanceData = Treaty.Data<EdenConformancePath["get"]>;
type NativeConformanceData = Treaty.Data<EdenConformanceClient["native-conformance"]["get"]>;
type ConformanceTypeAssertions = [
  Expect<Equals<ConformanceData, { id: number; source: "aponia" }>>,
  Expect<Equals<NativeConformanceData, { source: "native" }>>,
];
type RegisteredConformanceApplication = Awaited<
  ReturnType<typeof createRegisteredConformanceApplication>
>;
type RegisteredConformanceClient = Treaty.Create<RegisteredConformanceApplication>;
type RegisteredConformancePath = ReturnType<RegisteredConformanceClient["registered-conformance"]>;
type RegisteredConformanceTypeAssertions = [
  Expect<
    Equals<Treaty.Data<RegisteredConformancePath["get"]>, { id: number; source: "registered" }>
  >,
];
type CombinedConformanceApplication = Awaited<
  ReturnType<typeof createCombinedConformanceApplication>
>;
type CombinedConformanceClient = Treaty.Create<CombinedConformanceApplication>;
type NativeCombinedClient = Treaty.Create<typeof nativeCombinedApplication>;
type NativeCombinedEdenPath = ReturnType<NativeCombinedClient["eden-conformance"]>;
type NativeCombinedRegisteredPath = ReturnType<NativeCombinedClient["registered-conformance"]>;
type CombinedEdenPath = ReturnType<CombinedConformanceClient["eden-conformance"]>;
type CombinedRegisteredPath = ReturnType<CombinedConformanceClient["registered-conformance"]>;
type CombinedConformanceTypeAssertions = [
  Expect<Equals<Treaty.Data<NativeCombinedEdenPath["get"]>, { id: number; source: "aponia" }>>,
  Expect<
    Equals<Treaty.Data<NativeCombinedRegisteredPath["get"]>, { id: number; source: "registered" }>
  >,
  Expect<Equals<Treaty.Data<CombinedEdenPath["get"]>, { id: number; source: "aponia" }>>,
  Expect<Equals<Treaty.Data<CombinedRegisteredPath["get"]>, { id: number; source: "registered" }>>,
  Expect<
    Equals<
      Treaty.Data<CombinedConformanceClient["native-conformance"]["get"]>,
      { source: "native" }
    >
  >,
];

test("the Vite+ lane preserves an Aponia controller contract through Eden Treaty", async () => {
  const assertions: ConformanceTypeAssertions = [true, true];
  const application = await createEdenConformanceApplication();
  const edenConformanceClient = treaty(application);
  const [result, nativeResult] = await Promise.all([
    edenConformanceClient["eden-conformance"]({ id: 42 }).get(),
    edenConformanceClient["native-conformance"].get(),
  ]);

  expect(assertions).toHaveLength(2);
  expect(result.error).toBeNull();
  expect(result.data).toEqual({ id: 42, source: "aponia" });
  expect(nativeResult.data).toEqual({ source: "native" });
});

test("the Vite+ lane preserves direct registration through Eden Treaty", async () => {
  const assertions: RegisteredConformanceTypeAssertions = [true];
  const application = await createRegisteredConformanceApplication();
  const client = treaty(application);
  const result = await client["registered-conformance"]({ id: 7 }).get();

  expect(assertions).toEqual([true]);
  expect(result.error).toBeNull();
  expect(result.data).toEqual({ id: 7, source: "registered" });
});

test("the Vite+ lane composes multiple controller styles and a native plugin", async () => {
  const assertions: CombinedConformanceTypeAssertions = [true, true, true, true, true];
  const application = await createCombinedConformanceApplication();
  const client = treaty(application);
  const [pluginResult, registeredResult, nativeResult] = await Promise.all([
    client["eden-conformance"]({ id: 11 }).get(),
    client["registered-conformance"]({ id: 12 }).get(),
    client["native-conformance"].get(),
  ]);

  expect(assertions).toHaveLength(5);
  expect(pluginResult.data).toEqual({ id: 11, source: "aponia" });
  expect(registeredResult.data).toEqual({ id: 12, source: "registered" });
  expect(nativeResult.data).toEqual({ source: "native" });
});
