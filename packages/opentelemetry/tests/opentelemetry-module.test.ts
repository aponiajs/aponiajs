import { afterAll, afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  Controller,
  Get,
  Injectable,
  Module,
  UseGuards,
  defineConfiguration,
  type CanActivate,
} from "@aponiajs/common";
import {
  AponiaFactory,
  httpErrors,
  type AponiaApplicationOptions,
  type AponiaModuleDescriptorArtifact,
} from "@aponiajs/platform-elysia";
import {
  analyzeControllerRoutes,
  analyzeModuleDescriptors,
  collectSourceImports,
  emitModuleDescriptors,
  type DeclinedDescriptor,
  type DescriptorSourceFile,
} from "@aponiajs/cli";
import { getCurrentSpan } from "@elysia/opentelemetry";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { z } from "zod";
import { OpentelemetryModule } from "../src/index.ts";
import type { OpentelemetryConfiguration } from "../src/index.ts";

/**
 * What the adapter promises, measured through the wrapped plugin.
 *
 * The wrapped plugin's `NodeSDK` is process-global and the first registration in
 * a process owns it, so the module-level application below holds the one
 * registration that owns this process and every span assertion reads from its
 * one exporter. A case that boots a second application is measuring that fact
 * rather than fighting it. The generated-descriptor cases live in this same
 * file for the same reason: they boot registrations too, and a file that ran
 * first would steal the SDK this file's exporter depends on.
 */
const exporter = new InMemorySpanExporter();
const processor = new SimpleSpanProcessor(exporter);

const OpentelemetryConfig = defineConfiguration(
  z
    .object({
      OTEL_SERVICE_NAME: z.string().min(1),
      OTEL_RECORD_BODY: z.enum(["true", "false"]).default("false"),
      OTEL_HEADER_NAMES: z.string().default(""),
    })
    .transform(({ OTEL_SERVICE_NAME, OTEL_RECORD_BODY, OTEL_HEADER_NAMES }) => ({
      serviceName: OTEL_SERVICE_NAME,
      recordBody: OTEL_RECORD_BODY === "true",
      headersToSpanAttributes: {
        request: OTEL_HEADER_NAMES.split(",")
          .map((name) => name.trim())
          .filter((name) => name.length > 0),
      },
    })),
  "opentelemetry.test.main",
);

/** What a probe of the current span saw, per stage. */
const observed: string[] = [];

function spanPresence(stage: string): void {
  observed.push(`${stage}:${getCurrentSpan()?.spanContext().spanId ? "yes" : "no"}`);
}

@Injectable()
class ReportingService {
  read(): string {
    spanPresence("service");
    return "service-value";
  }
}

@Injectable()
class AllowingGuard implements CanActivate {
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

@Controller("probe")
class ProbeController {
  constructor(private readonly service: ReportingService) {}

  @Get("/ok")
  @UseGuards(AllowingGuard)
  ok(): string {
    spanPresence("handler");
    return this.service.read();
  }

  @Get("/refused")
  @UseGuards(RefusingGuard)
  refused(): string {
    return this.service.read();
  }

  @Get("/boom")
  boom(): never {
    spanPresence("failing-handler");
    throw new Error("a handler failed on purpose");
  }
}

@Module({
  imports: [
    OpentelemetryModule.register({
      configuration: OpentelemetryConfig,
      source: { OTEL_SERVICE_NAME: "aponia-first" },
      spanProcessors: [processor],
    }),
  ],
  controllers: [ProbeController],
  providers: [ReportingService, AllowingGuard, RefusingGuard],
})
class AppModule {}

const application = await AponiaFactory.create(AppModule, { logger: false });

/** The spans one request produced, drained before they are read. */
async function spansFor(request: Request): Promise<{
  readonly response: Response;
  readonly spans: ReturnType<InMemorySpanExporter["getFinishedSpans"]>;
}> {
  const before = exporter.getFinishedSpans().length;
  const response = await application.handle(request);
  await processor.forceFlush();
  return { response, spans: exporter.getFinishedSpans().slice(before) };
}

afterAll(async () => {
  await application.close();
});

test("records a span for the request, the handler, the service, and a guard", async () => {
  observed.length = 0;

  const { response, spans } = await spansFor(new Request("http://localhost/probe/ok"));

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("service-value");

  // The claim this package's README makes about the plugin's context: the
  // request's span is active in the handler, in a provider the handler calls,
  // and in a guard that runs before it. Asserted from inside each of them
  // rather than inferred from the span list.
  expect(observed).toEqual(["guard:yes", "handler:yes", "service:yes"]);

  const names = spans.map((span) => span.name);
  expect(names).toContain("GET /probe/ok");

  // The resource attribute is the one the validated configuration declared, not
  // the wrapped plugin's `"Elysia"` default.
  const root = spans.find((span) => span.name === "GET /probe/ok");
  expect(root?.resource.attributes["service.name"]).toBe("aponia-first");
});

test("records the refusal without marking the root span failed", async () => {
  observed.length = 0;

  const { response, spans } = await spansFor(new Request("http://localhost/probe/refused"));

  // The response is the platform's own Problem Details answer, not the plugin's.
  expect(response.status).toBe(403);
  expect(response.headers.get("content-type")).toContain("application/problem+json");
  expect(await response.json()).toMatchObject({ status: 403, code: "FORBIDDEN" });

  // The guard runs with the request's span active, so a policy that reads the
  // span in a guard is reading the request's own trace.
  expect(observed).toEqual(["refusing-guard:yes"]);

  // What the plugin records: the root span for the route, plus a child `Error`
  // span for the refusal. The root span's status is left UNSET — the plugin does
  // not mark a refused request as a failed one — which is the measured fact the
  // README states.
  const names = spans.map((span) => span.name);
  expect(names).toContain("GET /probe/refused");
  expect(names).toContain("Error");

  const root = spans.find((span) => span.name === "GET /probe/refused");
  expect(root?.status.code).toBe(0);
});

test("marks the root span as failed when a handler throws and answers a Problem Details 500", async () => {
  observed.length = 0;

  const { response, spans } = await spansFor(new Request("http://localhost/probe/boom"));

  expect(response.status).toBe(500);
  const body = (await response.json()) as Record<string, unknown>;
  expect(body).toMatchObject({ status: 500, code: "INTERNAL_SERVER_ERROR" });

  // The failure is reported through the system logger and never serialized: no
  // field of the answer carries the thrown message or a stack.
  expect(JSON.stringify(body)).not.toContain("a handler failed on purpose");
  expect(JSON.stringify(body)).not.toContain("at ");

  expect(observed).toEqual(["failing-handler:yes"]);

  // An unhandled failure is the case the plugin does mark: the root span is
  // ERROR and carries the exception as a span event.
  const root = spans.find((span) => span.name === "GET /probe/boom");
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
          headersToSpanAttributes: { request: [1, ""] },
          spanUrlRedaction: { stripCredentials: "no" },
        }) as unknown as OpentelemetryConfiguration,
    ),
    "opentelemetry.test.broken",
  );

  @Module({ imports: [OpentelemetryModule.register({ configuration: Broken, source: {} })] })
  class BrokenModule {}

  let failure: unknown;
  try {
    await AponiaFactory.create(BrokenModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  // One boot, every field, rather than one field per boot.
  expect(failure).toMatchObject({
    code: "INVALID_CONFIGURATION_VALUE",
    details: {
      configuration: "opentelemetry.test.broken",
      issues: [
        '"serviceName" must be a non-empty string',
        '"recordBody" must be a boolean or an object of booleans when it is present',
        '"headersToSpanAttributes" must be an object whose "request" and "response" are lists of non-empty header names when it is present',
        '"spanUrlRedaction" must be false or an object of redaction settings when it is present',
      ],
    },
  });
});

test("refuses a request body recorded beside a credential-bearing request header", async () => {
  const Leaky = defineConfiguration(
    z.object({}).transform(
      () =>
        ({
          serviceName: "leaky",
          recordBody: { request: true },
          headersToSpanAttributes: { request: ["Authorization"] },
        }) as unknown as OpentelemetryConfiguration,
    ),
    "opentelemetry.test.leaky",
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
      configuration: "opentelemetry.test.leaky",
      issues: [
        '"recordBody" cannot record the request while "headersToSpanAttributes.request" captures "Authorization": both are recorded on the exported span',
      ],
    },
  });
});

test("accepts a response-only capture beside a recorded request body", async () => {
  const Safe = defineConfiguration(
    z.object({}).transform(
      () =>
        ({
          serviceName: "response-only",
          recordBody: { request: true },
          headersToSpanAttributes: { response: ["content-type"] },
        }) as unknown as OpentelemetryConfiguration,
    ),
    "opentelemetry.test.response-only",
  );

  // The rule is narrow: the two sides it names are what it refuses, and the
  // configuration that trips neither boots. This registration's SDK never starts
  // — the first one in this process owns it — so this case asserts the refusal
  // boundary rather than a second tracer.
  @Module({ imports: [OpentelemetryModule.register({ configuration: Safe, source: {} })] })
  class SafeModule {}

  const safe = await AponiaFactory.create(SafeModule, { logger: false });
  await safe.close();
});

test("accepts a minimal policy, a raw-URL policy, and a service name alone", async () => {
  // The omissions each take a different branch of the guard into the plugin's
  // own defaults, and `spanUrlRedaction: false` is the one setting the README
  // states as accepted-but-unsafe — a guard that refused it would contradict
  // that paragraph.
  const Minimal = defineConfiguration(
    z.object({}).transform(
      () =>
        ({
          serviceName: "aponia-minimal",
          spanUrlRedaction: false,
        }) as unknown as OpentelemetryConfiguration,
    ),
    "opentelemetry.test.minimal",
  );

  @Module({ imports: [OpentelemetryModule.register({ configuration: Minimal, source: {} })] })
  class MinimalModule {}

  const minimal = await AponiaFactory.create(MinimalModule, { logger: false });
  await minimal.close();

  const Bare = defineConfiguration(
    z
      .object({})
      .transform(() => ({ serviceName: "aponia-bare" }) as unknown as OpentelemetryConfiguration),
    "opentelemetry.test.bare",
  );

  @Module({ imports: [OpentelemetryModule.register({ configuration: Bare, source: {} })] })
  class BareModule {}

  const bare = await AponiaFactory.create(BareModule, { logger: false });
  await bare.close();
});

test("refuses a configuration value that is not an object", async () => {
  // A `defineConfiguration` transform is arbitrary JavaScript, so the guard
  // cannot assume the schema answered with an object at all.
  const NotAnObject = defineConfiguration(
    z.object({}).transform(() => "aponia" as unknown as OpentelemetryConfiguration),
    "opentelemetry.test.not-an-object",
  );

  @Module({ imports: [OpentelemetryModule.register({ configuration: NotAnObject, source: {} })] })
  class NotAnObjectModule {}

  let failure: unknown;
  try {
    await AponiaFactory.create(NotAnObjectModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  expect(failure).toMatchObject({
    code: "INVALID_CONFIGURATION_VALUE",
    details: {
      configuration: "opentelemetry.test.not-an-object",
      issues: ['"serviceName" must be a non-empty string, and the value must be an object'],
    },
  });
});

test("refuses a wildcard capture and steps past an entry that is not a name", async () => {
  const Wildcard = defineConfiguration(
    z.object({}).transform(
      () =>
        ({
          serviceName: "wildcard",
          recordBody: true,
          headersToSpanAttributes: { request: ["*"] },
        }) as unknown as OpentelemetryConfiguration,
    ),
    "opentelemetry.test.wildcard",
  );

  @Module({ imports: [OpentelemetryModule.register({ configuration: Wildcard, source: {} })] })
  class WildcardModule {}

  let wildcardFailure: unknown;
  try {
    await AponiaFactory.create(WildcardModule, { logger: false });
  } catch (error) {
    wildcardFailure = error;
  }

  // `"*"` is the whole header set, so it captures every credential name without
  // naming one, and it is reported as itself rather than expanded.
  expect(wildcardFailure).toMatchObject({
    code: "INVALID_CONFIGURATION_VALUE",
    details: {
      configuration: "opentelemetry.test.wildcard",
      issues: [
        '"recordBody" cannot record the request while "headersToSpanAttributes.request" captures "*": both are recorded on the exported span',
      ],
    },
  });

  // An entry that is not a header name is a shape issue, and the leak rule steps
  // past it rather than reporting it as a credential. One boot still names the
  // field that is actually wrong.
  const Malformed = defineConfiguration(
    z.object({}).transform(
      () =>
        ({
          serviceName: "malformed",
          recordBody: { request: true },
          headersToSpanAttributes: { request: [7] },
        }) as unknown as OpentelemetryConfiguration,
    ),
    "opentelemetry.test.malformed-headers",
  );

  @Module({ imports: [OpentelemetryModule.register({ configuration: Malformed, source: {} })] })
  class MalformedModule {}

  let malformedFailure: unknown;
  try {
    await AponiaFactory.create(MalformedModule, { logger: false });
  } catch (error) {
    malformedFailure = error;
  }

  expect(malformedFailure).toMatchObject({
    code: "INVALID_CONFIGURATION_VALUE",
    details: {
      configuration: "opentelemetry.test.malformed-headers",
      issues: [
        '"headersToSpanAttributes" must be an object whose "request" and "response" are lists of non-empty header names when it is present',
      ],
    },
  });
});

test("accepts a populated redaction and header policy, and refuses a field that is no shape at all", async () => {
  // The successful path with every field present, so the guard's normalization
  // of the two object-shaped fields is exercised rather than skipped: a config
  // that omits them returns before reaching it.
  const Full = defineConfiguration(
    z.object({}).transform(
      () =>
        ({
          serviceName: "aponia-full",
          recordBody: { request: true, response: true },
          headersToSpanAttributes: {
            request: ["accept", "x-request-id"],
            response: ["content-type", "etag"],
          },
          spanUrlRedaction: { stripCredentials: false, sensitiveQueryParams: ["token", "key"] },
        }) as unknown as OpentelemetryConfiguration,
    ),
    "opentelemetry.test.full",
  );

  @Module({ imports: [OpentelemetryModule.register({ configuration: Full, source: {} })] })
  class FullModule {}

  const full = await AponiaFactory.create(FullModule, { logger: false });
  await full.close();

  // A field whose shape is neither the accepted one nor `false`.
  const WrongShape = defineConfiguration(
    z.object({}).transform(
      () =>
        ({
          serviceName: "wrong-shape",
          headersToSpanAttributes: "all",
          spanUrlRedaction: "raw",
        }) as unknown as OpentelemetryConfiguration,
    ),
    "opentelemetry.test.wrong-shape",
  );

  @Module({ imports: [OpentelemetryModule.register({ configuration: WrongShape, source: {} })] })
  class WrongShapeModule {}

  let failure: unknown;
  try {
    await AponiaFactory.create(WrongShapeModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  expect(failure).toMatchObject({
    code: "INVALID_CONFIGURATION_VALUE",
    details: {
      configuration: "opentelemetry.test.wrong-shape",
      issues: [
        '"headersToSpanAttributes" must be an object whose "request" and "response" are lists of non-empty header names when it is present',
        '"spanUrlRedaction" must be false or an object of redaction settings when it is present',
      ],
    },
  });
});

test("a second registration is inert: the first one owns the process", async () => {
  const secondExporter = new InMemorySpanExporter();
  const secondProcessor = new SimpleSpanProcessor(secondExporter);

  const Second = defineConfiguration(
    z.object({}).transform(
      () =>
        ({
          serviceName: "aponia-second",
        }) as unknown as OpentelemetryConfiguration,
    ),
    "opentelemetry.test.second",
  );

  @Controller("second")
  class SecondController {
    @Get("/")
    read(): string {
      return "second";
    }
  }

  @Module({
    imports: [
      OpentelemetryModule.register({
        configuration: Second,
        source: {},
        spanProcessors: [secondProcessor],
      }),
    ],
    controllers: [SecondController],
  })
  class SecondModule {}

  const second = await AponiaFactory.create(SecondModule, { logger: false });

  const sharedBefore = exporter.getFinishedSpans().length;
  const response = await second.handle(new Request("http://localhost/second"));
  await processor.forceFlush();
  await secondProcessor.forceFlush();

  expect(response.status).toBe(200);

  // The first registration's exporter saw the second application's request...
  const recorded = exporter.getFinishedSpans().slice(sharedBefore);
  expect(recorded.map((span) => span.name)).toContain("GET /second");

  // ...with the first registration's service name, because the second
  // registration's `NodeSDK` never started...
  expect(recorded[0]?.resource.attributes["service.name"]).toBe("aponia-first");

  // ...and the second registration's own processor saw nothing at all.
  expect(secondExporter.getFinishedSpans()).toEqual([]);

  await second.close();

  // Closing an application does not stop the SDK either: the plugin keeps its
  // `NodeSDK` in a closure no lifecycle hook reaches, so an application booted
  // after a close is still traced through the first registration.
  @Controller("third")
  class ThirdController {
    @Get("/")
    read(): string {
      return "third";
    }
  }

  @Module({
    imports: [OpentelemetryModule.register({ configuration: Second, source: {} })],
    controllers: [ThirdController],
  })
  class ThirdModule {}

  const third = await AponiaFactory.create(ThirdModule, { logger: false });
  const thirdBefore = exporter.getFinishedSpans().length;
  const thirdResponse = await third.handle(new Request("http://localhost/third"));
  await processor.forceFlush();

  expect(thirdResponse.status).toBe(200);
  expect(
    exporter
      .getFinishedSpans()
      .slice(thirdBefore)
      .map((span) => span.name),
  ).toContain("GET /third");

  await third.close();
});

test("shuts the declared span processors down when the application closes", async () => {
  const stops: string[] = [];
  // A real `SpanProcessor`, so the shape handed to `register` is the shape the
  // wrapped plugin declares: `shutdown` and `forceFlush` answer promises.
  const stub = {
    onStart(): void {},
    onEnd(): void {},
    async shutdown(): Promise<void> {
      stops.push("shutdown");
    },
    async forceFlush(): Promise<void> {},
  };

  const Stub = defineConfiguration(
    z
      .object({})
      .transform(() => ({ serviceName: "third" }) as unknown as OpentelemetryConfiguration),
    "opentelemetry.test.third",
  );

  @Module({
    imports: [
      OpentelemetryModule.register({
        configuration: Stub,
        source: {},
        spanProcessors: [stub],
      }),
    ],
  })
  class ThirdModule {}

  const third = await AponiaFactory.create(ThirdModule, { logger: false });

  // The wrapped plugin keeps its `NodeSDK` to itself, so nothing the platform
  // runs reaches it. What the module graph can still stop is the processors the
  // application declared, and this is the hook that stops them.
  expect(stops).toEqual([]);
  await third.close();
  expect(stops).toEqual(["shutdown"]);

  // Idempotent: a second close stops nothing a second time.
  await third.close();
  expect(stops).toEqual(["shutdown"]);
});

test("refuses two registrations that share a key", async () => {
  const Shared = defineConfiguration(
    z
      .object({})
      .transform(() => ({ serviceName: "shared" }) as unknown as OpentelemetryConfiguration),
    "opentelemetry.test.shared",
  );

  // Two registrations under one key are one module identity, and the graph
  // refuses a duplicate rather than mounting one and dropping the other. The
  // refusal is the graph's `DUPLICATE_MODULE` and it happens at boot, not at
  // `register`.
  @Module({
    imports: [
      OpentelemetryModule.register({ configuration: Shared, source: {}, key: "same" }),
      OpentelemetryModule.register({ configuration: Shared, source: {}, key: "same" }),
    ],
  })
  class DuplicateModule {}

  let failure: unknown;
  try {
    await AponiaFactory.create(DuplicateModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  expect(failure).toMatchObject({ code: "DUPLICATE_MODULE" });
});

test("answers over a real socket, which is where a server actually runs", async () => {
  // `handle` covers everything this package promises, and this case exists
  // because the lane it can only run in is this one: the Vite+ lane is Node,
  // where Elysia 2 has no adapter and a listen throws.
  //
  // It boots its own application rather than listening on the shared one,
  // because a listen is the only thing here that would take the rest of this
  // file's cases down with it. The spans still land in the first registration's
  // exporter, which is the fact the multi-boot case above measures.
  const SocketConfig = defineConfiguration(
    z
      .object({})
      .transform(() => ({ serviceName: "aponia-socket" }) as unknown as OpentelemetryConfiguration),
    "opentelemetry.test.socket",
  );

  @Controller("socket")
  class SocketController {
    @Get("/")
    read(): string {
      return "socket-value";
    }
  }

  @Module({
    imports: [OpentelemetryModule.register({ configuration: SocketConfig, source: {} })],
    controllers: [SocketController],
  })
  class SocketModule {}

  const socketApplication = await AponiaFactory.create(SocketModule, { logger: false });
  const before = exporter.getFinishedSpans().length;

  await socketApplication.listen(0);

  try {
    const response = await fetch(`${socketApplication.getUrl()}/socket`);
    await processor.forceFlush();

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("socket-value");
    expect(
      exporter
        .getFinishedSpans()
        .slice(before)
        .map((span) => span.name),
    ).toContain("GET /socket");
  } finally {
    await socketApplication.close();
  }
});

test("ships no exporter and no backend of its own", async () => {
  // The README's opening boundary, as an assertion: the barrel carries the
  // module and two types, and nothing that could be mistaken for an exporter, a
  // backend, or a span processor.
  const barrel = await import("../src/index.ts");

  expect(Object.keys(barrel).sort()).toEqual(["OpentelemetryModule"]);
  expect(typeof barrel.OpentelemetryModule.register).toBe("function");
});

/**
 * What `aponia build` reads versus what a boot serves.
 *
 * A registration is a `DynamicModule` — a runtime value rather than a
 * declaration read from the project's own source — so `aponia build` cannot
 * lower the module that names one. The question these cases answer is what that
 * costs: the module is declined, the artifact holds nothing for it, and the
 * application still boots and still traces, because the platform lowers a root
 * the artifact does not carry from its decorators instead.
 *
 * The emitter is `@aponiajs/cli`'s and the descriptor authoring surface it emits
 * calls is `@aponiajs/platform-elysia`'s, so this is the only place the two
 * halves meet with a registration on top. That is why this package carries the
 * CLI as a development dependency; its `tsconfig.json` maps the package name at
 * the source, because the artifact has to be read from source rather than from a
 * build this lane does not run.
 *
 * These cases live in this file rather than one of their own because they boot
 * registrations too: the module-level application above owns this process's
 * `NodeSDK`, so a separate file running first would steal the SDK this file's
 * exporter depends on. What the fixture asserts about tracing is the one claim
 * that survives that: `getCurrentSpan()` inside the handler, not the exporter.
 */

/**
 * The version the running platform reports, read from the manifest it ships
 * rather than imported from the module under test, so the artifact this file
 * generates cannot accidentally agree with a broken platform.
 */
const frameworkVersion = (
  (await Bun.file(new URL("../../platform-elysia/package.json", import.meta.url)).json()) as {
    version: string;
  }
).version;

/**
 * The provenance the artifact is generated with. The Elysia field is recorded
 * rather than compared — the platform only names it when it refuses an artifact
 * from another release — so a stated value keeps this file from depending on what
 * the machine happened to install.
 */
const provenance = Object.freeze({ framework: frameworkVersion, elysia: "2.0.0-beta.19" });

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

/**
 * A project two ways at once.
 *
 * `PingModule` is a module whose `imports` hold nothing but a controller, so
 * `aponia build` lowers it and the artifact carries its declaration. `AppModule`
 * is the shape this package is consumed in — a module whose `imports` hold the
 * registration — and the contrast between the two is the whole point of the
 * cases below.
 *
 * The fixture reaches the package through a relative path rather than through
 * its published name, because it is written inside this package's own
 * `node_modules` and a self-reference is not a name the workspace resolves.
 */
const sources: Readonly<Record<string, string>> = {
  "ping.controller.ts": `import { Controller, Get } from "@aponiajs/common";
import { getCurrentSpan } from "@elysia/opentelemetry";

@Controller("ping")
export class PingController {
  @Get("/")
  ping(): string {
    const seen = (globalThis as unknown as { __otelSpans: string[] }).__otelSpans;
    seen.push(getCurrentSpan()?.spanContext().spanId ? "traced" : "untraced");
    return "pong";
  }
}
`,
  "ping.module.ts": `import { Module } from "@aponiajs/common";
import { PingController } from "./ping.controller.ts";

@Module({ controllers: [PingController] })
export class PingModule {}
`,
  "tracing.ts": `import { defineConfiguration } from "@aponiajs/common";
import { z } from "zod";
import { OpentelemetryModule } from "../../src/index.ts";

const TracingConfig = defineConfiguration(
  z
    .object({ OTEL_SERVICE_NAME: z.string().min(1).default("aponia-generated") })
    .transform(({ OTEL_SERVICE_NAME }) => ({ serviceName: OTEL_SERVICE_NAME })),
  "opentelemetry.generated",
);

export const tracing = OpentelemetryModule.register({
  configuration: TracingConfig,
  source: {},
});
`,
  "app.module.ts": `import { Module } from "@aponiajs/common";
import { PingController } from "./ping.controller.ts";
import { tracing } from "./tracing.ts";

@Module({ imports: [tracing], controllers: [PingController] })
export class AppModule {}
`,
};

interface GeneratedFixture {
  readonly PingModule: unknown;
  readonly AppModule: unknown;
  readonly moduleDescriptorArtifact: AponiaModuleDescriptorArtifact;
  readonly declined: readonly DeclinedDescriptor[];
}

/**
 * Writes the fixture and the module a build would generate beside it.
 *
 * Written inside this package's `node_modules` so the generated module and the
 * fixture resolve the workspace from the same place an application would, and
 * removed again after every case that reads it.
 */
async function generateFixture(): Promise<GeneratedFixture> {
  const directory = await mkdtemp(join(import.meta.dir, "..", "node_modules", ".aponia-otel-"));
  temporaryDirectories.push(directory);

  const files: DescriptorSourceFile[] = [];

  for (const [name, source] of Object.entries(sources)) {
    const path = join(directory, name);
    await Bun.write(path, source);
    files.push({
      file: path,
      imports: collectSourceImports(source, path),
      descriptors: analyzeModuleDescriptors(source, path),
      controllers: analyzeControllerRoutes(source, path),
    });
  }

  const generatedPath = join(directory, "descriptors.generated.ts");
  const emitted = emitModuleDescriptors(files, generatedPath, provenance);

  if (emitted.source === undefined) {
    throw new Error(`The emitter declined every module: ${JSON.stringify(emitted.declined)}`);
  }

  await Bun.write(generatedPath, emitted.source);

  const [ping, app, generated] = await Promise.all([
    import(join(directory, "ping.module.ts")) as Promise<{ PingModule: unknown }>,
    import(join(directory, "app.module.ts")) as Promise<{ AppModule: unknown }>,
    import(generatedPath) as Promise<{ moduleDescriptorArtifact: AponiaModuleDescriptorArtifact }>,
  ]);

  return {
    PingModule: ping.PingModule,
    AppModule: app.AppModule,
    moduleDescriptorArtifact: generated.moduleDescriptorArtifact,
    declined: emitted.declined,
  };
}

/**
 * One boot of a root module, optionally handed the artifact a build would write,
 * answering with what the handler saw of the request's span.
 *
 * The handler reads `getCurrentSpan()` rather than the exporter, because the
 * wrapped plugin's `NodeSDK` is process-global and whether this boot's own
 * processors are the ones that started is a fact about the whole process rather
 * than about this fixture. What the context carries is this boot's own.
 */
async function tracedThrough(
  rootModule: unknown,
  options: AponiaApplicationOptions = {},
): Promise<{ readonly status: number; readonly seen: readonly string[] }> {
  const store = globalThis as unknown as { __otelSpans: string[] };
  store.__otelSpans = [];

  const application = await AponiaFactory.create(rootModule as never, {
    logger: false,
    ...options,
  });

  try {
    const response = await application.handle(new Request("http://localhost/ping"));

    return { status: response.status, seen: [...store.__otelSpans] };
  } finally {
    await application.close();
    store.__otelSpans = [];
  }
}

test("carries only the modules a build can lower into the generated artifact", async (): Promise<void> => {
  const fixture = await generateFixture();

  // The module whose `imports` hold controllers is lowered; the module whose
  // `imports` hold a registration is not, and the artifact says so by holding
  // nothing for it.
  expect(Object.keys(fixture.moduleDescriptorArtifact.modules)).toEqual(["PingModule"]);
  expect(fixture.declined).toHaveLength(1);
  expect(fixture.declined[0]?.module).toBe("AppModule");
  expect(fixture.declined[0]?.reason).toContain('"tracing"');
  expect(fixture.declined[0]?.reason).toContain('"imports"');
});

test("traces a module the build declined, by lowering it from its decorators", async (): Promise<void> => {
  const fixture = await generateFixture();

  // `AppModule` imports the registration, so `aponia build` declines it and the
  // artifact holds no declaration for the module the application names. The
  // platform lowers the root from its decorators instead, so the application is
  // whole and the request is still inside a span. What the decline costs is the
  // lowering, not the tracing.
  const compiled = await tracedThrough(fixture.AppModule);
  const adopted = await tracedThrough(fixture.AppModule, {
    descriptors: fixture.moduleDescriptorArtifact,
  });

  expect(adopted).toEqual(compiled);
  expect(compiled.status).toBe(200);
  expect(compiled.seen).toEqual(["traced"]);
});

test("lowers a module whose imports name no registration", async (): Promise<void> => {
  const fixture = await generateFixture();

  // The other half of the contrast: `PingModule` is lowerable, so its own boot
  // is unaffected by anything this package does — which is what makes the
  // declined module's cost attributable to the registration rather than to the
  // fixture.
  const lowered = await tracedThrough(fixture.PingModule);

  expect(lowered.status).toBe(200);
  expect(lowered.seen).toEqual(["untraced"]);
});
