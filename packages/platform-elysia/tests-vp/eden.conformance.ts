import { treaty, type Treaty } from "@elysia/eden";
import { defineModule } from "@aponiajs/common";
import { Elysia, t } from "elysia";
import { AponiaFactory, defineElysiaController, defineElysiaPlugin } from "../src/index.ts";

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
const edenConformanceModule = defineModule({
  id: "EdenConformanceModule",
  imports: [edenConformancePlugin],
  controllers: [edenConformanceController],
});

function createEdenConformanceApplication() {
  return AponiaFactory.createNative(edenConformanceModule, {
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
