import { defineModule } from "@aponiajs/common";
import {
  AponiaFactory,
  type AponiaApplication,
  type AponiaApplicationOptions,
  type AponiaHealthOptions,
  type AponiaHealthResponse,
  type AponiaHealthStatus,
  type AponiaListenOptions,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");
type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

/**
 * The four contracts the probes and the stop signals are stated with, pinned
 * exactly: a field added, removed, or made required fails `bun run check` here
 * rather than in an application that read the previous shape.
 */
type HealthOptionsAssertion = Expect<
  Equals<
    AponiaHealthOptions,
    {
      readonly livenessPath?: string;
      readonly readinessPath?: string;
    }
  >
>;
type HealthStatusAssertion = Expect<Equals<AponiaHealthStatus, "pass" | "fail">>;
type HealthResponseAssertion = Expect<
  Equals<AponiaHealthResponse, { readonly status: AponiaHealthStatus }>
>;
type HealthOptionAssertion = Expect<
  Equals<AponiaApplicationOptions["health"], boolean | AponiaHealthOptions | undefined>
>;
type ListenOptionsAssertion = Expect<
  Equals<AponiaListenOptions, { readonly shutdownSignals?: boolean }>
>;
/**
 * The option is only worth a contract if `listen` accepts it, so the second
 * parameter is pinned too: a signature that stopped carrying it would make the
 * type above an orphan a reader could keep importing and never use.
 */
type ListenSignatureAssertion = Expect<
  Equals<Parameters<AponiaApplication["listen"]>[1], AponiaListenOptions | undefined>
>;

test("the Vite+ lane types the probe and stop-signal contracts", () => {
  const healthOptionsAssertion: HealthOptionsAssertion = true;
  const healthStatusAssertion: HealthStatusAssertion = true;
  const healthResponseAssertion: HealthResponseAssertion = true;
  const healthOptionAssertion: HealthOptionAssertion = true;
  const listenOptionsAssertion: ListenOptionsAssertion = true;

  expect(healthOptionsAssertion).toBe(true);
  expect(healthStatusAssertion).toBe(true);
  expect(healthResponseAssertion).toBe(true);
  expect(healthOptionAssertion).toBe(true);
  expect(listenOptionsAssertion).toBe(true);
});

test("the Vite+ lane answers the probe pair this release mounts by default", async () => {
  const application = await AponiaFactory.create(defineModule({ id: "ConformanceProbes" }), {
    logger: false,
    health: true,
  });

  const live = await application.handle(new Request("http://localhost/health/live"));
  expect(live.status).toBe(200);
  expect(live.headers.get("content-type")).toBe("application/health+json");
  expect(await live.json()).toEqual({ status: "pass" });

  const ready = await application.handle(new Request("http://localhost/health/ready"));
  expect(ready.status).toBe(200);

  await application.close();
});

test("the Vite+ lane stops reporting ready as soon as the application does", async () => {
  const application = await AponiaFactory.create(defineModule({ id: "ConformanceStopping" }), {
    logger: false,
    health: true,
  });

  expect((await application.handle(new Request("http://localhost/health/ready"))).status).toBe(200);
  await application.close();

  const stopped = await application.handle(new Request("http://localhost/health/ready"));
  expect(stopped.status).toBe(503);
  expect(await stopped.json()).toEqual({ status: "fail" });
  // Liveness is about the process, not about the application's readiness: an
  // orchestrator that restarted a draining replica here would make a graceful
  // stop impossible.
  expect((await application.handle(new Request("http://localhost/health/live"))).status).toBe(200);
});

test("the Vite+ lane refuses two probes that would answer one path", async () => {
  const application = await AponiaFactory.create(defineModule({ id: "ConformanceSharedPath" }), {
    logger: false,
    health: { livenessPath: "/conformance/ready", readinessPath: "/conformance/ready" },
  }).catch((error: unknown) => error);

  // Refused rather than left with one answer an application chose by mount
  // order, which is the reason the two paths are checked at all.
  expect(application).toHaveProperty("code", "DUPLICATE_ROUTE");
});

test("the Vite+ lane binds the stop-signal option into listen's public signature", () => {
  // Compile-time, because this lane runs on Node rather than Bun: Elysia's
  // `listen()` refuses there without an adapter, so the option this asserts is
  // part of `listen`'s signature without a port ever being bound. What the
  // option *does* — the listeners, the idempotence, the re-raised signal and its
  // exit status — is `tests/graceful-shutdown.test.ts`'s, which runs where a
  // process can be bound and where a spawned fixture can die of the signal it
  // was sent.
  const listenAssertion: ListenSignatureAssertion = true;

  expect(listenAssertion).toBe(true);
});
