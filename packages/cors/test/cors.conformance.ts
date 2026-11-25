import { Module, defineConfiguration, type ConfigurationToken } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import type { DynamicModule } from "@aponiajs/common";
import { z } from "zod";
import { CorsModule } from "../src/index.ts";
import type { CorsConfiguration, CorsModuleOptions } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;

/**
 * The compile-time half of this lane: the contract a consumer writes against.
 *
 * The policy type is the one this package's adapter claim is actually made of.
 * `keyof CorsConfiguration` is pinned field by field because the type is
 * deliberately narrower than the wrapped plugin's own `CORSConfig` — it carries
 * data only, so an origin that is a `RegExp` or a function has no field here.
 * A release of this package that widened the type to match the plugin would make
 * the README's stated boundary false, and this lane is where that fails.
 *
 * `CorsConfiguration["credentials"]` is pinned because the default is this
 * package's own: the wrapped plugin defaults it to `true`, and the optional
 * `boolean | undefined` is what lets this adapter state `false` instead.
 *
 * The rest pin the published shape: the registration's options and its return
 * type, which is the value an application's `imports` accepts.
 */
type CorsContractAssertions = [
  Expect<Equals<keyof CorsModuleOptions, "configuration" | "source" | "key">>,
  Expect<Equals<CorsModuleOptions["configuration"], ConfigurationToken<CorsConfiguration>>>,
  Expect<Equals<CorsModuleOptions["source"], Readonly<Record<string, unknown>> | undefined>>,
  Expect<Equals<CorsModuleOptions["key"], string | undefined>>,
  Expect<
    Equals<
      keyof CorsConfiguration,
      | "origins"
      | "methods"
      | "allowedHeaders"
      | "exposeHeaders"
      | "credentials"
      | "maxAge"
      | "preflight"
    >
  >,
  Expect<Equals<CorsConfiguration["origins"], readonly string[]>>,
  Expect<Equals<CorsConfiguration["methods"], readonly string[] | undefined>>,
  Expect<Equals<CorsConfiguration["allowedHeaders"], readonly string[] | undefined>>,
  Expect<Equals<CorsConfiguration["exposeHeaders"], readonly string[] | undefined>>,
  Expect<Equals<CorsConfiguration["credentials"], boolean | undefined>>,
  Expect<Equals<CorsConfiguration["maxAge"], number | undefined>>,
  Expect<Equals<CorsConfiguration["preflight"], boolean | undefined>>,
  Expect<Equals<ReturnType<typeof CorsModule.register>, DynamicModule>>,
];

/** The barrel as a consumer's `import` sees it. */
type CorsBarrel = typeof import("../src/index.ts");

/**
 * The exports this package must keep, named so a renamed or dropped one fails
 * this lane rather than an application.
 *
 * Only the value export is named here: `keyof typeof import(...)` holds the
 * values a consumer can import, and the two contracts are type-only exports. A
 * renamed or dropped type fails this file instead — its own `import type` at the
 * top is what would stop compiling.
 */
type CorsBarrelAssertions = [Expect<Equals<Extract<keyof CorsBarrel, "CorsModule">, "CorsModule">>];

const assertion: CorsContractAssertions = Array.from(
  { length: 13 },
  () => true,
) as CorsContractAssertions;

function policyOf(name: string) {
  return defineConfiguration(
    z
      .object({
        CORS_ORIGINS: z.string().min(1).default("https://app.example"),
        CORS_CREDENTIALS: z.enum(["true", "false"]).default("false"),
      })
      .transform(({ CORS_ORIGINS, CORS_CREDENTIALS }) => ({
        origins: CORS_ORIGINS.split(",").map((origin) => origin.trim()),
        credentials: CORS_CREDENTIALS === "true",
      })),
    `cors.${name}`,
  );
}

test("keeps the contract assertions referenced", () => {
  expect(assertion).toHaveLength(13);
});

test("answers with the policy the validated configuration declared", async () => {
  const CorsConfig = policyOf("conformance.served");

  @Module({ imports: [CorsModule.register({ configuration: CorsConfig, source: {} })] })
  class ConformanceModule {}

  const application = await AponiaFactory.create(ConformanceModule, { logger: false });

  try {
    // `handle` rather than `listen`: this lane runs on Node, where Elysia 2 has
    // no adapter and a listen throws. A request never opens a port, and the
    // policy is a hook over the response either way, so what this package
    // promises is fully observable here.
    const allowed = await application.handle(
      new Request("http://localhost/anything", { headers: { Origin: "https://app.example" } }),
    );

    expect(allowed.status).toBe(404);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://app.example");
    expect(allowed.headers.get("vary")).toBe("Origin");

    // The default this adapter changed: the wrapped plugin would have stated
    // `Access-Control-Allow-Credentials: true` here, and this package states it
    // only when the application asked for it.
    expect(allowed.headers.get("access-control-allow-credentials")).toBeNull();

    const denied = await application.handle(
      new Request("http://localhost/anything", { headers: { Origin: "https://evil.example" } }),
    );

    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  } finally {
    await application.close();
  }
});

test("answers a preflight without a route to reach", async () => {
  const CorsConfig = policyOf("conformance.preflight");

  @Module({ imports: [CorsModule.register({ configuration: CorsConfig, source: {} })] })
  class ConformanceModule {}

  const application = await AponiaFactory.create(ConformanceModule, { logger: false });

  try {
    const preflight = await application.handle(
      new Request("http://localhost/anything", {
        method: "OPTIONS",
        headers: {
          Origin: "https://app.example",
          "Access-Control-Request-Method": "POST",
        },
      }),
    );

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://app.example");
    expect(preflight.headers.get("access-control-allow-methods")).toBe("POST");
    expect(preflight.headers.get("access-control-max-age")).toBe("5");
  } finally {
    await application.close();
  }
});

test("refuses a boot whose declaration's schema rejects it", async () => {
  const CorsConfig = defineConfiguration(
    z.object({ CORS_ORIGINS: z.string().min(1) }).transform(({ CORS_ORIGINS }) => ({
      origins: [CORS_ORIGINS],
    })),
    "cors.conformance.required",
  );

  @Module({ imports: [CorsModule.register({ configuration: CorsConfig, source: {} })] })
  class ConformanceModule {}

  let failure: unknown;

  try {
    await AponiaFactory.create(ConformanceModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  expect(failure).toMatchObject({
    code: "INVALID_CONFIGURATION_VALUE",
    details: { configuration: "cors.conformance.required" },
  });
});

test("refuses a wildcard origin beside credentialed requests", async () => {
  const CorsConfig = defineConfiguration(
    z
      .object({})
      .transform(() => ({ origins: ["*"], credentials: true }) as unknown as CorsConfiguration),
    "cors.conformance.wildcard",
  );

  @Module({ imports: [CorsModule.register({ configuration: CorsConfig, source: {} })] })
  class ConformanceModule {}

  let failure: unknown;

  try {
    await AponiaFactory.create(ConformanceModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  expect(failure).toMatchObject({
    code: "INVALID_CONFIGURATION_VALUE",
    details: {
      configuration: "cors.conformance.wildcard",
      issues: [
        '"credentials" cannot be true while "origins" contains "*": a browser rejects that response',
      ],
    },
  });
});

// A registration is a `DynamicModule`, which is the value an application's
// `imports` accepts. Held here so this lane compiles the shape without booting.
const registration = CorsModule.register({
  configuration: policyOf("conformance.registration"),
  source: {},
});

test("the registration is a module an application import accepts", () => {
  expect(registration.module).toBeDefined();
  expect(registration.providers?.length).toBeGreaterThan(0);

  const assertions: CorsBarrelAssertions = [true];
  expect(assertions).toHaveLength(1);
});
