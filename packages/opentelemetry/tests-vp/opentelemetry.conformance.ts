import { Module, defineConfiguration, type ConfigurationToken } from "@aponiajs/common";
import type { DynamicModule } from "@aponiajs/common";
import { Controller, Get, Injectable, UseGuards, type CanActivate } from "@aponiajs/common";
import { AponiaFactory, httpErrors } from "@aponiajs/platform-elysia";
import { getCurrentSpan } from "@elysia/opentelemetry";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { z } from "zod";
import { OpentelemetryModule } from "../src/index.ts";
import type { OpentelemetryConfiguration, OpentelemetryModuleOptions } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;

/**
 * The compile-time half of this lane: the contract a consumer writes against.
 *
 * The split between the configuration and the runtime options is the whole of
 * this package's adapter claim, so it is what is pinned. `keyof
 * OpentelemetryConfiguration` is listed field by field because the type is
 * deliberately the data-only subset of the wrapped plugin's own options — a span
 * processor, an instrumentation, a context manager, and a predicate have no
 * field here — and the four names it does have are exactly the four the runtime
 * options must not also carry, which the `never` assertions below state.
 *
 * A release that widened the configuration to match `ElysiaOpenTelemetryOptions`
 * would make the README's stated boundary false, and this lane is where that
 * fails.
 */
type OpentelemetryContractAssertions = [
  Expect<
    Equals<
      keyof OpentelemetryConfiguration,
      "serviceName" | "recordBody" | "headersToSpanAttributes" | "spanUrlRedaction"
    >
  >,
  Expect<Equals<OpentelemetryConfiguration["serviceName"], string>>,
  Expect<
    Equals<
      OpentelemetryConfiguration["recordBody"],
      boolean | { readonly request?: boolean; readonly response?: boolean } | undefined
    >
  >,
  Expect<
    Equals<
      OpentelemetryConfiguration["headersToSpanAttributes"],
      { readonly request?: readonly string[]; readonly response?: readonly string[] } | undefined
    >
  >,
  Expect<
    Equals<
      OpentelemetryModuleOptions["configuration"],
      ConfigurationToken<OpentelemetryConfiguration>
    >
  >,
  Expect<
    Equals<OpentelemetryModuleOptions["source"], Readonly<Record<string, unknown>> | undefined>
  >,
  Expect<Equals<OpentelemetryModuleOptions["key"], string | undefined>>,
  // The runtime options cannot set a field the configuration owns: a caller that
  // wants a service name writes it where it is validated.
  Expect<Equals<Extract<keyof OpentelemetryModuleOptions, "serviceName">, never>>,
  Expect<Equals<Extract<keyof OpentelemetryModuleOptions, "recordBody">, never>>,
  Expect<Equals<Extract<keyof OpentelemetryModuleOptions, "headersToSpanAttributes">, never>>,
  Expect<Equals<Extract<keyof OpentelemetryModuleOptions, "spanUrlRedaction">, never>>,
  // The objects a configuration cannot carry do have a home in the options.
  Expect<Equals<Extract<keyof OpentelemetryModuleOptions, "spanProcessors">, "spanProcessors">>,
  Expect<Equals<Extract<keyof OpentelemetryModuleOptions, "instrumentations">, "instrumentations">>,
  Expect<Equals<ReturnType<typeof OpentelemetryModule.register>, DynamicModule>>,
];

/** The barrel as a consumer's `import` sees it. */
type OpentelemetryBarrel = typeof import("../src/index.ts");

/**
 * The exports this package must keep.
 *
 * Only the value export is named: `keyof typeof import(...)` holds the values a
 * consumer can import, and the two contracts are type-only exports. A renamed or
 * dropped type fails this file instead — its own `import type` at the top is what
 * would stop compiling.
 */
type OpentelemetryBarrelAssertions = [
  Expect<Equals<Extract<keyof OpentelemetryBarrel, "OpentelemetryModule">, "OpentelemetryModule">>,
];

const assertions: OpentelemetryContractAssertions = Array.from(
  { length: 14 },
  () => true,
) as OpentelemetryContractAssertions;

const barrelAssertions: OpentelemetryBarrelAssertions = [true];

function configOf(name: string) {
  return defineConfiguration(
    z
      .object({
        OTEL_SERVICE_NAME: z.string().min(1).default("aponia-conformance"),
        OTEL_RECORD_BODY: z.enum(["true", "false"]).default("false"),
      })
      .transform(({ OTEL_SERVICE_NAME, OTEL_RECORD_BODY }) => ({
        serviceName: OTEL_SERVICE_NAME,
        recordBody: OTEL_RECORD_BODY === "true",
      })),
    `opentelemetry.${name}`,
  );
}

const exporter = new InMemorySpanExporter();
const processor = new SimpleSpanProcessor(exporter);

const observed: string[] = [];

function spanPresence(stage: string): void {
  observed.push(`${stage}:${getCurrentSpan()?.spanContext().spanId ? "yes" : "no"}`);
}

@Injectable()
class ConformanceService {
  read(): string {
    spanPresence("service");
    return "conformance-value";
  }
}

@Injectable()
class ConformanceGuard implements CanActivate {
  canActivate(): boolean {
    spanPresence("guard");
    return true;
  }
}

@Injectable()
class RefusingGuard implements CanActivate {
  canActivate(): boolean {
    spanPresence("refusing-guard");
    throw httpErrors.forbidden("A guard refused this request.");
  }
}

@Controller("conformance")
class ConformanceController {
  constructor(private readonly service: ConformanceService) {}

  @Get("/ok")
  @UseGuards(ConformanceGuard)
  ok(): string {
    spanPresence("handler");
    return this.service.read();
  }

  @Get("/refused")
  @UseGuards(RefusingGuard)
  refused(): string {
    return "never";
  }

  @Get("/boom")
  boom(): never {
    throw new Error("a conformance handler failed on purpose");
  }
}

const ConformanceConfig = configOf("conformance.main");

@Module({
  imports: [
    OpentelemetryModule.register({
      configuration: ConformanceConfig,
      source: { OTEL_SERVICE_NAME: "aponia-conformance" },
      spanProcessors: [processor],
    }),
  ],
  controllers: [ConformanceController],
  providers: [ConformanceService, ConformanceGuard, RefusingGuard],
})
class ConformanceModule {}

const application = await AponiaFactory.create(ConformanceModule, { logger: false });

async function spansFor(request: Request) {
  const before = exporter.getFinishedSpans().length;
  const response = await application.handle(request);
  await processor.forceFlush();
  return { response, spans: exporter.getFinishedSpans().slice(before) };
}

test("keeps the contract assertions referenced", () => {
  expect(assertions).toHaveLength(14);
  expect(barrelAssertions).toHaveLength(1);
});

test("records a span the handler, a guard, and an injected service can all see", async () => {
  observed.length = 0;

  // `handle` rather than `listen`: this lane runs on Node, where Elysia 2 has no
  // adapter and a listen throws. A request never opens a port here, and what the
  // plugin records is the same either way, so what this package promises is
  // fully observable.
  const { response, spans } = await spansFor(new Request("http://localhost/conformance/ok"));

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("conformance-value");
  expect(observed).toEqual(["guard:yes", "handler:yes", "service:yes"]);
  expect(spans.map((span) => span.name)).toContain("GET /conformance/ok");

  const root = spans.find((span) => span.name === "GET /conformance/ok");
  expect(root?.resource.attributes["service.name"]).toBe("aponia-conformance");
});

test("answers a refusal with Problem Details and keeps the guard's span active", async () => {
  observed.length = 0;

  const { response, spans } = await spansFor(new Request("http://localhost/conformance/refused"));

  expect(response.status).toBe(403);
  expect(response.headers.get("content-type")).toContain("application/problem+json");
  expect(await response.json()).toMatchObject({ status: 403, code: "FORBIDDEN" });
  expect(observed).toEqual(["refusing-guard:yes"]);

  const names = spans.map((span) => span.name);
  expect(names).toContain("GET /conformance/refused");
  expect(names).toContain("Error");
  expect(spans.find((span) => span.name === "GET /conformance/refused")?.status.code).toBe(0);
});

test("marks the root span failed when a handler throws, and answers 500", async () => {
  const { response, spans } = await spansFor(new Request("http://localhost/conformance/boom"));

  expect(response.status).toBe(500);
  const body = (await response.json()) as Record<string, unknown>;
  expect(body).toMatchObject({ status: 500, code: "INTERNAL_SERVER_ERROR" });
  expect(JSON.stringify(body)).not.toContain("a conformance handler failed on purpose");

  const root = spans.find((span) => span.name === "GET /conformance/boom");
  expect(root?.status.code).toBe(2);
  expect(root?.events.map((event) => event.name)).toContain("exception");
});

test("refuses a value whose fields are wrong, naming every one of them", async () => {
  const Broken = defineConfiguration(
    z.object({}).transform(
      () =>
        ({
          serviceName: "",
          recordBody: "yes",
          spanUrlRedaction: { stripCredentials: "no" },
        }) as unknown as OpentelemetryConfiguration,
    ),
    "opentelemetry.conformance.broken",
  );

  @Module({ imports: [OpentelemetryModule.register({ configuration: Broken, source: {} })] })
  class BrokenModule {}

  let failure: unknown;
  try {
    await AponiaFactory.create(BrokenModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  expect(failure).toMatchObject({
    code: "INVALID_CONFIGURATION_VALUE",
    details: {
      configuration: "opentelemetry.conformance.broken",
      issues: [
        '"serviceName" must be a non-empty string',
        '"recordBody" must be a boolean or an object of booleans when it is present',
        '"spanUrlRedaction" must be false or an object of redaction settings when it is present',
      ],
    },
  });
});

test("refuses a request body recorded beside a wildcard request-header capture", async () => {
  const Leaky = defineConfiguration(
    z.object({}).transform(
      () =>
        ({
          serviceName: "conformance-leaky",
          recordBody: { request: true },
          headersToSpanAttributes: { request: ["*"] },
        }) as unknown as OpentelemetryConfiguration,
    ),
    "opentelemetry.conformance.leaky",
  );

  @Module({ imports: [OpentelemetryModule.register({ configuration: Leaky, source: {} })] })
  class LeakyModule {}

  let failure: unknown;
  try {
    await AponiaFactory.create(LeakyModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  expect(failure).toMatchObject({
    code: "INVALID_CONFIGURATION_VALUE",
    details: {
      configuration: "opentelemetry.conformance.leaky",
      issues: [
        '"recordBody" cannot record the request while "headersToSpanAttributes.request" captures "*": both are recorded on the exported span',
      ],
    },
  });
});

// A registration is a `DynamicModule`, which is the value an application's
// `imports` accepts. Held here so this lane compiles the shape without booting.
const registration = OpentelemetryModule.register({
  configuration: configOf("conformance.registration"),
  source: {},
});

test("the registration is a module an application import accepts", async () => {
  expect(registration.module).toBeDefined();
  expect(registration.providers?.length).toBeGreaterThan(0);

  await application.close();
});
