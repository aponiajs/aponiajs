import { Module, type DynamicModule } from "@aponiajs/common";
import type { AponiaGatewayInspection, AponiaModuleInspection } from "@aponiajs/platform-elysia";
import {
  DevtoolsModule,
  devtoolsContractVersion,
  type AponiaAotPayload,
  type AponiaFlowPayload,
  type AponiaFlowRoute,
  type AponiaGraphPayload,
  type AponiaLogsPayload,
  type AponiaMetaPayload,
  type AponiaMountedRoute,
  type AponiaRequestsPayload,
  type AponiaRoutesPayload,
  type DevtoolsCaptureOptions,
  type DevtoolsOptions,
  type LogEntry,
  type RequestRecord,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;

/**
 * The compile-time half of this lane: what a consumer reads off the wire.
 *
 * This lane opens no socket, because there is none to open: the surface is a
 * route the application mounts and the transport is asserted in `tests/*.test.ts`
 * over `application.handle`. Here
 * only the public contract is compiled, so a payload field that changes shape,
 * or a `contract` literal that stops matching the value the endpoint writes,
 * fails `bun run check` and `vp test` without any request being made.
 *
 * `contract` is the assertion that matters most: `devtoolsContractVersion` is
 * the number `/meta` publishes and `AponiaMetaPayload["contract"]` is the type
 * a client checks before it reads a field, so the two having one type is the
 * whole promise that a client can trust the shape it is reading.
 */
type DevtoolsContractAssertions = [
  Expect<Equals<AponiaMetaPayload["contract"], typeof devtoolsContractVersion>>,
  Expect<
    Equals<
      AponiaMetaPayload["artifacts"],
      { readonly invokers: string | null; readonly descriptors: string | null }
    >
  >,
  Expect<Equals<AponiaMetaPayload["elysia"], string | null>>,
  Expect<Equals<AponiaGraphPayload["modules"], readonly AponiaModuleInspection[]>>,
  Expect<Equals<AponiaGraphPayload["gateways"], readonly AponiaGatewayInspection[]>>,
  Expect<Equals<AponiaRoutesPayload["routes"], readonly AponiaMountedRoute[]>>,
  Expect<Equals<AponiaFlowPayload["routes"], readonly AponiaFlowRoute[]>>,
  Expect<Equals<AponiaLogsPayload["cursor"], AponiaRequestsPayload["cursor"]>>,
  Expect<Equals<AponiaLogsPayload["entries"], readonly LogEntry[]>>,
  Expect<Equals<AponiaLogsPayload["levels"], readonly string[]>>,
  Expect<Equals<AponiaRequestsPayload["entries"], readonly RequestRecord[]>>,
  Expect<Equals<AponiaRequestRecordFields, RequestRecord>>,
  Expect<Equals<AponiaAotPayload["graph"], "declared" | "decorated">>,
  Expect<Equals<AponiaAotPayload["invokers"]["accepted"], boolean>>,
  Expect<Equals<keyof DevtoolsOptions, "enabled" | "logger" | "capture">>,
  Expect<Equals<Extract<"startDevtoolsServer" | "DevtoolsServer", keyof DevtoolsBarrel>, never>>,
];

/**
 * The barrel as a consumer's `import` sees it, so the exports this release
 * deleted are asserted absent rather than only documented as absent.
 *
 * `DevtoolsServerOptions` is deliberately not in the assertion above: a
 * type-only export leaves no key here, so the two value exports the socket
 * carried are the only ones this form can hold. Its removal is stated by
 * `packages/devtools/AGENTS.md` and the README rather than pinned here, and
 * this comment is where that gap is admitted.
 */
type DevtoolsBarrel = typeof import("../src/index.ts");

/**
 * The request record as a client sees it, restated so the assertion above
 * compares the exported type with a second declaration rather than with itself.
 *
 * `status` and `durationMs` are nullable and `id` is present because a request
 * writes an entry at arrival, before an answer exists: the client that reads
 * `null` there is reading a request this record never saw answered, and the
 * client that groups by `id` is reading the two entries as one request's.
 */
interface AponiaRequestRecordFields {
  readonly id: number;
  readonly method: string;
  readonly path: string;
  readonly url: string;
  readonly status: number | null;
  readonly durationMs: number | null;
  readonly timestamp: string;
  readonly error?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

/**
 * Every option the registration documents, named once so a field that stops
 * being accepted fails here rather than in an application.
 */
const conformanceOptions: DevtoolsOptions = {
  enabled: true,
  logger: false,
  capture: {
    enabled: true,
    headers: true,
    body: true,
    bodyLimit: 1024,
    redact: ["authorization"],
  },
};

const conformanceCapture: DevtoolsCaptureOptions = {
  enabled: false,
  headers: false,
  body: false,
  bodyLimit: 0,
  redact: [],
};

// A disabled registration is what a production application mounts, and it is
// the value this lane can hold without starting anything: the register call
// returns a `DynamicModule`, which is the import slot an application fills.
const disabledRegistration: DynamicModule = DevtoolsModule.register({ enabled: false });

@Module({ imports: [disabledRegistration] })
class ConformanceApplicationModule {}

test("keeps the contract assertions referenced", () => {
  const assertions: DevtoolsContractAssertions = Array.from(
    { length: 16 },
    () => true,
  ) as DevtoolsContractAssertions;

  expect(assertions).toHaveLength(16);
});

test("the registration is a module an application import accepts", () => {
  expect(disabledRegistration.module).toBe(DevtoolsModule);
  expect(disabledRegistration.imports).toEqual([]);
  expect(disabledRegistration.providers).toEqual([]);
  expect(typeof ConformanceApplicationModule).toBe("function");
});

test("the options surface accepts the documented capture policy", () => {
  expect(conformanceOptions.capture).toEqual({
    enabled: true,
    headers: true,
    body: true,
    bodyLimit: 1024,
    redact: ["authorization"],
  });
  expect(conformanceCapture.enabled).toBe(false);
  expect(conformanceOptions.logger).toBe(false);
});

test("every endpoint payload is constructible from the published types", () => {
  const meta: AponiaMetaPayload = {
    contract: devtoolsContractVersion,
    framework: "0.0.0",
    elysia: null,
    artifacts: { invokers: null, descriptors: null },
    startedAt: "2026-01-01T00:00:00.000Z",
  };
  const graph: AponiaGraphPayload = { rootModule: "ConformanceModule", modules: [], gateways: [] };
  const routes: AponiaRoutesPayload = { routes: [] };
  const flow: AponiaFlowPayload = { routes: [] };
  const logs: AponiaLogsPayload = {
    cursor: 1,
    entries: [
      {
        level: "log",
        context: "Conformance",
        message: "hello",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    ],
    levels: ["log"],
  };
  const requests: AponiaRequestsPayload = {
    cursor: 1,
    entries: [
      {
        id: 1,
        method: "GET",
        path: "/",
        url: "/?page=1",
        status: null,
        durationMs: null,
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
  const aot: AponiaAotPayload = {
    graph: "decorated",
    invokers: { accepted: false, reason: "refused" },
    controllers: [{ controller: "ConformanceController", handlers: [] }],
  };

  expect(meta.contract).toBe(devtoolsContractVersion);
  expect(graph.rootModule).toBe("ConformanceModule");
  expect(routes.routes).toHaveLength(0);
  expect(flow.routes).toHaveLength(0);
  expect(logs.entries[0]?.context).toBe("Conformance");
  expect(logs.levels).toContain("log");
  expect(requests.entries[0]?.url).toBe("/?page=1");
  expect(aot.invokers.accepted).toBe(false);
});
