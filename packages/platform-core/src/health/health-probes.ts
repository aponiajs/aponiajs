import { AponiaError, type ClassToken } from "@aponiajs/common";
import type { PlatformRouteHandler } from "../interfaces/platform-host.interface.ts";
import type { MountedRoute } from "../interfaces/kernel.interface.ts";
import type { AponiaHealthOptions, AponiaHealthStatus } from "../interfaces/health.interface.ts";

/** The media type the health-check draft defines. */
const healthContentType = "application/health+json";

const defaultLivenessPath = "/health/live";
const defaultReadinessPath = "/health/ready";

/**
 * The one fact a readiness probe reports.
 *
 * It is the boot's own rather than a provider's, because the shutdown plan runs
 * inside the boot and a token would put a mutable lifecycle flag in reach of
 * every route. Only readiness reads it; liveness answers from the fact that the
 * process answered at all.
 */
export class ApplicationReadiness {
  #ready = true;

  /** Flips the probe to `fail`; the shutdown of a boot calls this first. */
  markShuttingDown(): void {
    this.#ready = false;
  }

  isReady(): boolean {
    return this.#ready;
  }
}

/** One probe this boot mounts, with the handler it answers through. */
export interface HealthProbeMount {
  /** The mount the host registers. */
  readonly mount: MountedRoute;
  /** The handler that answers the probe. */
  readonly handler: PlatformRouteHandler;
}

/** The placeholder controller a probe is mounted under. */
class HealthProbeController {}

/**
 * Lowers the `health` option into the probes to mount, or `undefined` when the
 * application asked for none.
 *
 * The paths are checked against the routes this boot already compiled, because a
 * probe mounts outside the module graph and a repeated `(method, path)` would be
 * answered by whichever registration the runtime resolves first.
 *
 * @param routes - The routes the boot compiled.
 * @param options - The `health` option the application passed.
 * @param readiness - The flag this boot's readiness probe reads.
 * @returns The probes to mount, or `undefined` when the option is absent.
 */
export function compileHealthProbes(
  routes: readonly MountedRoute[],
  options: boolean | AponiaHealthOptions | undefined,
  readiness: ApplicationReadiness,
): readonly HealthProbeMount[] | undefined {
  if (options === undefined || options === false) {
    return undefined;
  }

  const paths: AponiaHealthOptions = options === true ? {} : options;
  const probes = Object.freeze([
    Object.freeze({ kind: "liveness" as const, path: paths.livenessPath ?? defaultLivenessPath }),
    Object.freeze({
      kind: "readiness" as const,
      path: paths.readinessPath ?? defaultReadinessPath,
    }),
  ]);

  const claimed = new Set<string>();
  for (const probe of probes) {
    const key = `GET ${probe.path}`;
    if (claimed.has(key)) {
      throw new AponiaError(
        "DUPLICATE_ROUTE",
        `Route "${key}" is claimed by both health probes: they must answer different paths.`,
        { method: "GET", path: probe.path },
      );
    }
    claimed.add(key);

    const claim = routes.find(
      (mount) => mount.route.method === "GET" && mount.route.path === probe.path,
    );
    if (claim !== undefined) {
      throw new AponiaError(
        "DUPLICATE_ROUTE",
        `Route "${key}" is claimed by both a controller and the health probes option.`,
        { method: "GET", path: probe.path, controller: claim.controller.name },
      );
    }
  }

  return Object.freeze(
    probes.map((probe) =>
      Object.freeze({
        mount: createMount(probe.path),
        handler: async () => answerHealthProbe(probe.kind, readiness),
      }),
    ),
  );
}

function createMount(path: string): MountedRoute {
  return Object.freeze({
    route: Object.freeze({
      method: "GET",
      path,
      propertyKey: "health",
      parameters: Object.freeze([]),
      schema: undefined,
      declaredParameterCount: 0,
      pipes: Object.freeze([]),
      enhancers: Object.freeze({
        guards: Object.freeze([]),
        interceptors: Object.freeze([]),
        filters: Object.freeze([]),
      }),
      serializer: undefined,
    }),
    controller: HealthProbeController as unknown as ClassToken<unknown>,
    instance: undefined,
    guards: Object.freeze([]),
    interceptors: Object.freeze([]),
    filters: Object.freeze([]),
    pipes: Object.freeze([]),
  });
}

/**
 * The answer one probe gives.
 *
 * `no-store` is stated rather than left to a default, because a cached probe
 * answer is a stale one.
 */
export function answerHealthProbe(
  kind: "liveness" | "readiness",
  readiness: ApplicationReadiness,
): Response {
  const ready = kind === "liveness" || readiness.isReady();
  const status: AponiaHealthStatus = ready ? "pass" : "fail";

  return new Response(JSON.stringify(Object.freeze({ status })), {
    status: ready ? 200 : 503,
    headers: {
      "content-type": healthContentType,
      "cache-control": "no-store",
    },
  });
}
