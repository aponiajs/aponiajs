import { Module, defineConfiguration, type ConfigurationToken } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import type { DynamicModule } from "@aponiajs/common";
import type { ElysiaOpenAPIConfig } from "@elysia/openapi";
import { z } from "zod";
import { OpenApiModule } from "../src/index.ts";
import type { OpenApiConfiguration, OpenApiInfo, OpenApiModuleOptions } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;

/**
 * The compile-time half of this lane: the contract a consumer writes against.
 *
 * The last assertion is the one this package cannot state about itself. The
 * metadata an application declares is handed to the wrapped plugin unchanged, so
 * `OpenApiInfo` has to stay assignable to the plugin's own `documentation.info`
 * — derived from the dependency rather than restated, which is what makes a
 * release that reshapes it fail `bun run check` instead of shipping a document
 * no one can parse. The rest pin this package's own published shape: the nested
 * `info` key is what leaves room for a later additive option, and the
 * registration's return type is the one an application's `imports` accepts.
 */
type OpenApiContractAssertions = [
  Expect<Equals<keyof OpenApiModuleOptions, "configuration" | "source" | "key" | "path">>,
  Expect<Equals<OpenApiModuleOptions["configuration"], ConfigurationToken<OpenApiConfiguration>>>,
  Expect<Equals<OpenApiModuleOptions["source"], Readonly<Record<string, unknown>> | undefined>>,
  Expect<Equals<OpenApiModuleOptions["key"], string | undefined>>,
  Expect<Equals<OpenApiModuleOptions["path"], string | undefined>>,
  Expect<Equals<OpenApiConfiguration["info"], OpenApiInfo>>,
  Expect<Equals<keyof OpenApiInfo, "title" | "version" | "description">>,
  Expect<Equals<OpenApiInfo["title"], string>>,
  Expect<Equals<OpenApiInfo["version"], string>>,
  Expect<Equals<OpenApiInfo["description"], string | undefined>>,
  Expect<Equals<ReturnType<typeof OpenApiModule.register>, DynamicModule>>,
  Expect<
    Equals<
      Extract<OpenApiInfo, NonNullable<ElysiaOpenAPIConfig["documentation"]>["info"]>,
      OpenApiInfo
    >
  >,
];

/** The barrel as a consumer's `import` sees it. */
type OpenApiBarrel = typeof import("../src/index.ts");

/**
 * The exports this package must keep, named so a renamed or dropped one fails
 * this lane rather than an application.
 */
type OpenApiBarrelAssertions = [
  Expect<Equals<Extract<keyof OpenApiBarrel, "OpenApiModule">, "OpenApiModule">>,
];

const assertion: OpenApiContractAssertions = Array.from(
  { length: 12 },
  () => true,
) as OpenApiContractAssertions;

function documentsConfig(name: string) {
  return defineConfiguration(
    z
      .object({
        OPENAPI_TITLE: z.string().min(1).default("Conformance document"),
        OPENAPI_VERSION: z.string().min(1).default("1.0.0"),
      })
      .transform(({ OPENAPI_TITLE, OPENAPI_VERSION }) => ({
        info: { title: OPENAPI_TITLE, version: OPENAPI_VERSION },
      })),
    `openapi.${name}`,
  );
}

test("keeps the contract assertions referenced", () => {
  expect(assertion).toHaveLength(12);
});

test("serves a document whose metadata came from the validated configuration", async () => {
  const OpenApiConfig = documentsConfig("conformance.served");

  @Module({
    imports: [OpenApiModule.register({ configuration: OpenApiConfig, source: {}, path: "/docs" })],
  })
  class ConformanceModule {}

  const application = await AponiaFactory.create(ConformanceModule, { logger: false });

  try {
    const response = await application.handle(new Request("http://localhost/docs/json"));

    expect(response.status).toBe(200);

    const document = (await response.json()) as { openapi: string; info: unknown };

    expect(document.openapi.startsWith("3.")).toBe(true);
    expect(document.info).toEqual({ title: "Conformance document", version: "1.0.0" });

    // The registration's own path is the mount point, so the plugin's default is
    // not mounted beside it.
    expect((await application.handle(new Request("http://localhost/openapi/json"))).status).toBe(
      404,
    );
  } finally {
    await application.close();
  }
});

test("refuses a boot whose configuration the declaration's schema rejects", async () => {
  const OpenApiConfig = defineConfiguration(
    z.object({ TITLE: z.string().min(1) }).transform(({ TITLE }) => ({
      info: { title: TITLE, version: "1.0.0" },
    })),
    "openapi.conformance.required",
  );

  @Module({ imports: [OpenApiModule.register({ configuration: OpenApiConfig, source: {} })] })
  class ConformanceModule {}

  let failure: unknown;

  try {
    await AponiaFactory.create(ConformanceModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  expect(failure).toMatchObject({
    code: "INVALID_CONFIGURATION_VALUE",
    details: { configuration: "openapi.conformance.required" },
  });
});

test("refuses a mount path that is not an absolute path while the registration runs", () => {
  const OpenApiConfig = documentsConfig("conformance.path");

  let failure: unknown;

  try {
    OpenApiModule.register({ configuration: OpenApiConfig, path: "docs" });
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(TypeError);
});

// A registration is a `DynamicModule`, which is the value an application's
// `imports` accepts. Held here so this lane compiles the shape without booting.
const registration = OpenApiModule.register({
  configuration: documentsConfig("conformance.registration"),
  source: {},
});

test("the registration is a module an application import accepts", () => {
  expect(registration.module).toBeDefined();
  expect(registration.providers?.length).toBeGreaterThan(0);

  const assertions: OpenApiBarrelAssertions = [true];
  expect(assertions).toHaveLength(1);
});
