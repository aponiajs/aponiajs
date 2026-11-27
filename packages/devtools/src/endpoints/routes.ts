import type { AponiaBootDiagnostics } from "@aponiajs/common";
import type { AponiaMountedRoute, AponiaRoutesPayload } from "../interfaces/payloads.interface.ts";
import { readRouteParameters } from "./route-parameters.ts";
import { readRouteSource } from "./route-source.ts";

/** The path this endpoint is served under, relative to the devtools prefix. */
export const devtoolsRoutesPath = "/routes";

/**
 * Builds the payload `/routes` answers with from the neutral boot record.
 *
 * Every route the record describes is reported: the plans a controller mounted
 * and the routes a controller's own callback added. The native route table is
 * not read, so a route mounted directly on the platform's application outside
 * the graph is not reported — that is the documented degradation of this
 * endpoint on every platform.
 *
 * A plan states its module, controller, handler, binding, and parameters; a
 * callback route states its module, controller, method, and path and leaves the
 * handler empty, because the property key that built it exists only while the
 * mount ran.
 */
export function buildRoutesPayload(
  diagnostics: AponiaBootDiagnostics | undefined,
): AponiaRoutesPayload {
  const recorded = describeRecordedRoutes(diagnostics);
  const routes = [...recorded.values()];

  routes.sort(compareMountedRoutes);

  return Object.freeze({ routes: Object.freeze(routes) });
}

function describeRecordedRoutes(
  diagnostics: AponiaBootDiagnostics | undefined,
): ReadonlyMap<string, AponiaMountedRoute> {
  const recorded = new Map<string, AponiaMountedRoute>();

  for (const entry of diagnostics?.routes ?? []) {
    const plan = entry.route;
    recorded.set(
      routeKey(plan.method, plan.path),
      Object.freeze({
        method: plan.method,
        path: plan.path,
        module: entry.module,
        controller: entry.controller,
        handler: handlerName(plan.propertyKey),
        source: readRouteSource(entry.source),
        parameters: readRouteParameters(plan.parameters),
      }),
    );
  }

  for (const entry of diagnostics?.callbackRoutes ?? []) {
    const key = routeKey(entry.method, entry.path);
    if (recorded.has(key)) {
      continue;
    }
    recorded.set(
      key,
      Object.freeze({
        method: entry.method,
        path: entry.path,
        module: entry.module,
        controller: entry.controller,
        handler: "",
        source: readRouteSource(entry.source),
        parameters: Object.freeze([]),
      }),
    );
  }

  return recorded;
}

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function handlerName(propertyKey: unknown): string {
  return typeof propertyKey === "string" || typeof propertyKey === "symbol"
    ? String(propertyKey)
    : "";
}

function compareMountedRoutes(left: AponiaMountedRoute, right: AponiaMountedRoute): number {
  return (
    compareText(left.path, right.path) ||
    compareText(left.method, right.method) ||
    compareText(left.controller, right.controller) ||
    compareText(left.handler, right.handler) ||
    compareText(left.module, right.module)
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
