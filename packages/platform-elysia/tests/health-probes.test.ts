import { describe, expect, test } from "bun:test";
import { AponiaError, defineModule, provideClass, type RouteContext } from "@aponiajs/common";
import {
  AponiaFactory,
  defineControllerRoutes,
  type AponiaApplication,
  type AponiaApplicationOptions,
  type AponiaRootModule,
} from "../src/index.ts";

function probeRequest(path: string): Request {
  return new Request(`http://localhost${path}`);
}

/**
 * The failure a boot raised, so a case can assert the code the platform
 * promises rather than the sentence it happened to write.
 */
async function captureCreateFailure(
  rootModule: AponiaRootModule,
  options: AponiaApplicationOptions,
): Promise<unknown> {
  try {
    await AponiaFactory.create(rootModule, options);
  } catch (error) {
    return error;
  }

  return undefined;
}

/**
 * The application a hook under test reads its own probes through.
 *
 * The hooks are constructed before the application exists, so the reference has
 * to be late-bound: a definite-assignment assertion would be a claim the test
 * makes and no reader can check.
 */
interface ApplicationHolder {
  application?: AponiaApplication;
}

function requireApplication(holder: ApplicationHolder): AponiaApplication {
  if (!holder.application) {
    throw new Error("The case never built its application.");
  }

  return holder.application;
}

describe("an application that asks for probes", () => {
  test("mounts none unless the option asks", async () => {
    const application = await AponiaFactory.create(defineModule({ id: "NoProbesModule" }), {
      logger: false,
    });

    expect((await application.handle(probeRequest("/health/live"))).status).toBe(404);
    expect((await application.handle(probeRequest("/health/ready"))).status).toBe(404);
    await application.close();
  });

  test("mounts none when the option is false", async () => {
    const application = await AponiaFactory.create(defineModule({ id: "RefusedProbesModule" }), {
      logger: false,
      health: false,
    });

    expect((await application.handle(probeRequest("/health/live"))).status).toBe(404);
    await application.close();
  });

  test("answers the conventional pair with the health-check media type", async () => {
    const application = await AponiaFactory.create(defineModule({ id: "ProbesModule" }), {
      logger: false,
      health: true,
    });

    const live = await application.handle(probeRequest("/health/live"));
    expect(live.status).toBe(200);
    expect(live.headers.get("content-type")).toBe("application/health+json");
    // Stated rather than left to a default: a cached probe answer is a stale
    // one, and a replayed `pass` is the request the readiness flip exists to
    // stop.
    expect(live.headers.get("cache-control")).toBe("no-store");
    expect(await live.json()).toEqual({ status: "pass" });

    const ready = await application.handle(probeRequest("/health/ready"));
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: "pass" });

    await application.close();
  });

  test("answers the paths the application moved them to", async () => {
    const application = await AponiaFactory.create(defineModule({ id: "MovedProbesModule" }), {
      logger: false,
      health: { livenessPath: "/probe/alive", readinessPath: "/probe/ready" },
    });

    expect((await application.handle(probeRequest("/probe/alive"))).status).toBe(200);
    expect((await application.handle(probeRequest("/probe/ready"))).status).toBe(200);
    expect((await application.handle(probeRequest("/health/live"))).status).toBe(404);

    await application.close();
  });

  test("flips readiness before the first shutdown hook and leaves liveness alone", async () => {
    const holder: ApplicationHolder = {};
    const observed: { readonly live: number; readonly ready: number }[] = [];

    class ShutdownObserver {
      async beforeApplicationShutdown(): Promise<void> {
        const application = requireApplication(holder);
        observed.push({
          live: (await application.handle(probeRequest("/health/live"))).status,
          ready: (await application.handle(probeRequest("/health/ready"))).status,
        });
      }
    }

    const module = defineModule({
      id: "ReadinessFlipModule",
      providers: [provideClass(ShutdownObserver, [])],
    });
    holder.application = await AponiaFactory.create(module, { logger: false, health: true });

    const ready = await holder.application.handle(probeRequest("/health/ready"));
    expect(ready.status).toBe(200);

    await holder.application.close();

    // Read from inside the first hook, which is the earliest moment an
    // application can observe its own probes: readiness has to be `fail` by
    // then, or an orchestrator keeps routing to an application that has already
    // begun to tear down. Liveness stays `pass` for the same request, which is
    // what keeps that same orchestrator from restarting a draining replica.
    expect(observed).toEqual([{ live: 200, ready: 503 }]);

    const stopped = await holder.application.handle(probeRequest("/health/ready"));
    expect(stopped.status).toBe(503);
    expect(await stopped.json()).toEqual({ status: "fail" });
  });

  test("answers a probe even when a global guard refuses every route", async () => {
    class RefusingGuard {
      canActivate(): boolean {
        return false;
      }
    }

    class GuardedController {
      read(_context: RouteContext): string {
        return "guarded";
      }
    }

    const module = defineModule({
      id: "GuardedProbesModule",
      providers: [provideClass(RefusingGuard, [])],
      controllers: [
        defineControllerRoutes(GuardedController, {
          path: "/guarded",
          routes: [{ method: "GET", path: "read", propertyKey: "read" }],
        }),
      ],
    });
    const application = await AponiaFactory.create(module, {
      logger: false,
      health: true,
      guards: [RefusingGuard],
    });

    // The route is guarded and the probe is not: an orchestrator polling for
    // readiness may not be able to present credentials, and a guard on a probe
    // is how a deployment reports every replica unhealthy at once.
    expect((await application.handle(probeRequest("/guarded/read"))).status).toBe(403);
    expect((await application.handle(probeRequest("/health/ready"))).status).toBe(200);

    await application.close();
  });
});

describe("a probe that no application could mount", () => {
  test("refuses a path a controller already claims", async () => {
    class ClaimingController {
      read(_context: RouteContext): string {
        return "controller";
      }
    }

    const module = defineModule({
      id: "ClaimedProbeModule",
      controllers: [
        defineControllerRoutes(ClaimingController, {
          path: "/health",
          routes: [{ method: "GET", path: "live", propertyKey: "read" }],
        }),
      ],
    });
    const error = await captureCreateFailure(module, { logger: false, health: true });

    // Elysia answers a repeated `(method, path)` from whichever registration it
    // resolves, so without this refusal the application would learn which of
    // the two answers it serves from a mounting detail.
    expect(error).toBeInstanceOf(AponiaError);
    expect(error).toMatchObject({
      code: "DUPLICATE_ROUTE",
      details: {
        method: "GET",
        path: "/health/live",
        module: "ClaimedProbeModule",
        controller: "ClaimingController",
      },
    });
    expect(Object.isFrozen((error as AponiaError).details)).toBe(true);
  });

  test("refuses a pair of probes that would answer one path", async () => {
    const error = await captureCreateFailure(defineModule({ id: "SharedProbePathModule" }), {
      logger: false,
      health: { livenessPath: "/health", readinessPath: "/health" },
    });

    // The details name no controller, which is what tells this refusal apart
    // from the controller collision above: nothing claimed the path, the two
    // probes claimed it of each other.
    expect(error).toMatchObject({
      code: "DUPLICATE_ROUTE",
      details: { method: "GET", path: "/health" },
    });
    expect(Object.isFrozen((error as AponiaError).details)).toBe(true);
  });
});
