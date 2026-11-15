import { AponiaError, type ModuleDefinition } from "@aponiajs/common";
import type { Elysia } from "elysia";
import { collectClaimedElysiaRoutes } from "../modules/route-uniqueness.ts";
import { registerNativeRoute } from "../routing/native-route.ts";
import type { AponiaHealthOptions, AponiaHealthStatus } from "./application-health.types.ts";

/**
 * The media type the health-check draft defines, which is the only thing that
 * distinguishes a probe's answer from any other JSON document an orchestrator
 * might be polling.
 */
const healthContentType = "application/health+json";

/** The one member the draft requires, and the only one this platform sends. */
const statusMember = "status";

const defaultLivenessPath = "/health/live";
const defaultReadinessPath = "/health/ready";

/**
 * Which question one probe asks.
 *
 * @internal
 */
type HealthProbeKind = "liveness" | "readiness";

/**
 * One probe this boot mounts.
 *
 * @internal
 */
interface HealthProbe {
  readonly kind: HealthProbeKind;
  readonly method: "GET";
  readonly path: string;
}

/**
 * The one fact a readiness probe reports.
 *
 * It is the boot's own rather than a provider's, because the shutdown plan
 * already runs inside the boot and the probes are mounted beside it: a token
 * would put a mutable lifecycle flag in reach of every route, and what a probe
 * answers is not an application's to set.
 *
 * Only readiness reads it. Liveness answers from the fact that the process
 * answered at all, which is what keeps an orchestrator from restarting an
 * application that is busy draining — the mistake that makes a graceful stop
 * impossible.
 *
 * @internal
 */
export class ApplicationReadiness {
  #ready: boolean;

  /**
   * A boot that has just mounted its probes is ready by definition: the flag
   * describes an application that has begun to stop, and only one call moves it.
   */
  constructor() {
    this.#ready = true;
  }

  /**
   * Flips the probe to `fail`. The shutdown plan calls this before its first
   * hook, so a request that arrives while the application is stopping is told to
   * go elsewhere rather than being answered by a half-torn-down graph.
   */
  markShuttingDown(): void {
    this.#ready = false;
  }

  isReady(): boolean {
    return this.#ready;
  }
}

/**
 * The probes an application asked for, or `undefined` when it asked for none.
 *
 * The paths are validated against the compiled graph before anything mounts,
 * because a probe path a controller already claims is the one collision this
 * platform can still refuse: the probes are mounted outside the module graph, so
 * they are not part of the compile-time uniqueness check and Elysia would answer
 * the repeated path with whichever registration it resolves. A caller that
 * declared `GET /health/live` as a route of its own therefore fails its boot
 * rather than silently losing either the probe or the route.
 *
 * Routes a native plugin provides stay outside this check, exactly as they are
 * outside the compile-time one: a plugin mounts through `use()` and overriding a
 * route is Elysia's documented behavior.
 *
 * @internal
 */
export function compileHealthProbes(
  root: ModuleDefinition,
  options: boolean | AponiaHealthOptions | undefined,
): readonly HealthProbe[] | undefined {
  if (options === undefined || options === false) {
    return undefined;
  }

  const paths: AponiaHealthOptions = options === true ? {} : options;
  const probes = Object.freeze([
    Object.freeze({
      kind: "liveness" as const,
      method: "GET" as const,
      path: paths.livenessPath ?? defaultLivenessPath,
    }),
    Object.freeze({
      kind: "readiness" as const,
      method: "GET" as const,
      path: paths.readinessPath ?? defaultReadinessPath,
    }),
  ]);

  assertProbePathsAreDistinct(probes);
  const claims = collectClaimedElysiaRoutes(root);
  for (const probe of probes) {
    const claim = claims.get(`${probe.method} ${probe.path}`);
    if (claim) {
      throw new AponiaError(
        "DUPLICATE_ROUTE",
        `Route "${probe.method} ${probe.path}" is claimed by both a controller and the health probes option.`,
        Object.freeze({
          method: probe.method,
          path: probe.path,
          module: claim.module,
          controller: claim.controller,
        }),
      );
    }
  }

  return probes;
}

/**
 * Mounts the two probes on the application's own route table.
 *
 * They mount through the platform's route boundary like every other route it
 * registers, and they carry no hook: a probe runs no guard, no interceptor, and
 * no declared filter, because an orchestrator polling for the application's
 * readiness may not be able to authenticate and an authentication guard on a
 * probe is how a deployment reports everything unhealthy at once.
 *
 * @internal
 */
export function mountHealthProbes(
  application: Elysia,
  readiness: ApplicationReadiness,
  probes: readonly HealthProbe[],
): void {
  for (const probe of probes) {
    registerNativeRoute(
      application,
      probe.method,
      probe.path,
      () => answerProbe(probe.kind, readiness),
      undefined,
    );
  }
}

/**
 * The answer one probe gives.
 *
 * `no-store` is stated rather than left to a default, because a cached probe
 * answer is a stale one: an intermediary that replayed a `pass` from before the
 * application began to stop is exactly the dropped request the readiness flip
 * exists to prevent.
 */
function answerProbe(kind: HealthProbeKind, readiness: ApplicationReadiness): Response {
  const ready = kind === "liveness" || readiness.isReady();
  const status: AponiaHealthStatus = ready ? "pass" : "fail";

  return new Response(JSON.stringify(Object.freeze({ [statusMember]: status })), {
    status: ready ? 200 : 503,
    headers: {
      "content-type": healthContentType,
      "cache-control": "no-store",
    },
  });
}

/**
 * Refuses a pair of probes that would both answer one path.
 *
 * Distinct defaults make this unreachable unless an application configured it, so
 * the check exists for the typo — `livenessPath: "/health"` beside
 * `readinessPath: "/health"` — which would otherwise leave one of the two
 * answers unreachable and cannot be told from a deliberate choice at mount time.
 */
function assertProbePathsAreDistinct(probes: readonly HealthProbe[]): void {
  const claimed = new Set<string>();

  for (const probe of probes) {
    const key = `${probe.method} ${probe.path}`;
    if (claimed.has(key)) {
      throw new AponiaError(
        "DUPLICATE_ROUTE",
        `Route "${key}" is claimed by both health probes: they must answer different paths.`,
        Object.freeze({ method: probe.method, path: probe.path }),
      );
    }
    claimed.add(key);
  }
}
