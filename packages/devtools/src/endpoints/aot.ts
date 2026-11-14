import { resolve } from "node:path";
import type { AnalyzedController, DeclinedControllerHandler } from "@aponiajs/cli";
import type { LoggerService } from "@aponiajs/common";
import type { AponiaApplicationDiagnostics } from "@aponiajs/platform-elysia";
import { oneLine } from "../logging/one-line.ts";
import { reportFailure } from "../logging/report-failure.ts";
import type { AponiaBuildController, AponiaBuildPayload } from "./aot.types.ts";

/** Existing Aponia build-artifact diagnostics path; not native Elysia AOT diagnostics. */
export const devtoolsAotPath = "/aot";

/** Validated boot facts published beside the read-only project analysis. */
export type AponiaBuildFacts = Pick<AponiaBuildPayload, "graph" | "invokers">;

const noControllers: readonly AponiaBuildController[] = Object.freeze([]);

type AnalysisOutcome =
  | { readonly status: "success"; readonly controllers: readonly AponiaBuildController[] }
  | { readonly status: "failure"; readonly retryAt: number; readonly delay: number };
interface AnalysisEntry {
  outcome?: AnalysisOutcome;
  loading?: Promise<readonly AponiaBuildController[]>;
}

const analyses = new Map<string, AnalysisEntry>();
const initialRetryDelay = 1_000;
const maximumRetryDelay = 30_000;

/** Reads the endpoint's boot facts, returning absence for an unknown record shape. */
export function readAotFacts(
  diagnostics: AponiaApplicationDiagnostics | undefined,
): AponiaBuildFacts | undefined {
  const graph = diagnostics?.graph;
  const invokers = diagnostics?.invokers;
  const reason = invokers?.reason;
  if (
    (graph !== "declared" && graph !== "decorated") ||
    typeof invokers?.accepted !== "boolean" ||
    (reason !== undefined && typeof reason !== "string")
  ) {
    return undefined;
  }
  return Object.freeze({ graph, invokers: Object.freeze({ accepted: invokers.accepted, reason }) });
}

/** Preserves the existing wire shape; analysis failure is not a new payload field. */
export function buildAotPayload(
  facts: AponiaBuildFacts,
  controllers: readonly AponiaBuildController[],
): AponiaBuildPayload {
  return Object.freeze({ graph: facts.graph, invokers: facts.invokers, controllers });
}

/**
 * Lazily reads one project's build verdicts. Concurrent polls share one attempt;
 * successful results (including empty ones) live for the process. Failures degrade
 * to the existing empty wire list and retry on a later poll after exponential
 * backoff, starting at one second and capped at thirty seconds, never permanently.
 * Polls during backoff neither parse source nor repeat the guarded failure report.
 */
export function loadAotAnalysis(
  projectRoot: string,
  logger: LoggerService,
): Promise<readonly AponiaBuildController[]> {
  const root = resolve(projectRoot);
  let entry = analyses.get(root);
  if (entry === undefined) {
    entry = {};
    analyses.set(root, entry);
  }
  if (entry.loading !== undefined) return entry.loading;
  if (entry.outcome?.status === "success") return Promise.resolve(entry.outcome.controllers);
  if (entry.outcome?.status === "failure" && Date.now() < entry.outcome.retryAt) {
    return Promise.resolve(noControllers);
  }
  const loading = analyzeProject(root, logger, entry);
  entry.loading = loading;
  return loading;
}

async function analyzeProject(
  projectRoot: string,
  logger: LoggerService,
  entry: AnalysisEntry,
): Promise<readonly AponiaBuildController[]> {
  try {
    const { analyzeBuildProject } = await import("@aponiajs/cli");
    const analysis = await analyzeBuildProject({ cwd: projectRoot });
    const controllers = projectControllers(analysis.controllers, analysis.invokers.declined);
    entry.outcome = { status: "success", controllers };
    return controllers;
  } catch (error) {
    const delay =
      entry.outcome?.status === "failure"
        ? Math.min(entry.outcome.delay * 2, maximumRetryDelay)
        : initialRetryDelay;
    entry.outcome = { status: "failure", retryAt: Date.now() + delay, delay };
    reportFailure(
      logger,
      `Aponia devtools could not read the route analysis of "${projectRoot}" (${oneLine(error)}); /aot answers the boot's record alone.`,
    );
    return noControllers;
  } finally {
    entry.loading = undefined;
  }
}

function projectControllers(
  controllers: readonly AnalyzedController[],
  declined: readonly DeclinedControllerHandler[],
): readonly AponiaBuildController[] {
  const reasons = new Map<string, string>();
  for (const entry of declined) reasons.set(`${entry.controller}.${entry.method}`, entry.reason);
  return Object.freeze(
    controllers.map((controller) =>
      Object.freeze({
        controller: controller.className,
        handlers: Object.freeze(
          [...new Set(controller.routes.map((route) => route.methodName))].map((handler) => {
            const reason = reasons.get(`${controller.className}.${handler}`);
            return Object.freeze({
              handler,
              invoker: reason === undefined ? ("generated" as const) : ("compiled" as const),
              reason,
            });
          }),
        ),
      }),
    ),
  );
}
