import type { AponiaApplicationDiagnostics } from "@aponiajs/platform-elysia";
import type { Elysia } from "elysia";
import type { AponiaMountedRoute, AponiaRoutesPayload } from "./payloads.types.ts";
import { readRouteParameters } from "./route-parameters.ts";
import { readRouteSource } from "./route-source.ts";

/** The path this endpoint is served under, relative to the devtools prefix. */
export const devtoolsRoutesPath = "/routes";

/**
 * The two fields of Elysia's mounted route table this endpoint reads, as the
 * table may hold them.
 *
 * They are `unknown` on purpose: the table belongs to the installed Elysia
 * rather than to this release, and a devtools endpoint that trusted a shape it
 * did not write would fail a request over a field it never reports.
 */
interface MountedNativeRoute {
  readonly method: unknown;
  readonly path: unknown;
}

/**
 * Builds the payload `/routes` answers with, from the mounted route table the
 * application holds at this moment and the plans the boot recorded for it.
 *
 * The table is read here, when the request arrives, rather than kept from the
 * boot: it belongs to the running application, which may mount another route on
 * the native instance before it listens, and a devtools server that answered a
 * frozen copy would report a server that no longer exists. The record arrives
 * already read, because a boot does not change once it has started.
 *
 * The join runs one way only: every route the table holds is reported, and a
 * record entry describes a route only when the table holds it. A plan the
 * application never mounted is therefore absent rather than invented, and a
 * mounted route no plan and no callback describes is reported with the names it
 * does not have — the empty string — instead of a guess. `source` states one of
 * this release's three values and reads as `null` otherwise: a plan an older
 * record states no binding for, a route no record describes at all, and a value
 * under that field that is not one of the three — a foreign copy of the platform
 * writes what it likes under the same key — are one absence, because this
 * endpoint publishes no binding state it cannot name.
 *
 * The table is Elysia's, so both halves of it are what the installed release
 * holds rather than what this one expects: an entry whose method or path is not
 * a string cannot be joined or reported, and is dropped rather than rendered as
 * one.
 */
export function buildRoutesPayload(
  application: Elysia,
  diagnostics: AponiaApplicationDiagnostics | undefined,
): AponiaRoutesPayload {
  const recorded = describeRecordedRoutes(diagnostics);
  const routes: AponiaMountedRoute[] = [];

  for (const mounted of readMountedRoutes(application)) {
    const { method, path } = mounted;
    if (typeof method !== "string" || typeof path !== "string") {
      continue;
    }

    routes.push(recorded.get(routeKey(method, path)) ?? describeUnrecordedRoute(method, path));
  }

  routes.sort(compareMountedRoutes);

  return Object.freeze({ routes: Object.freeze(routes) });
}

/**
 * What the boot recorded about each route it mounted, keyed by the method and
 * path the mounted table joins on.
 *
 * The compiled plans come first and the routes a controller mounted itself fill
 * only the gaps they leave: a route a plan describes is described in full — its
 * parameters and the property key that serves it included — while a callback's
 * route states its module and controller and no handler, and the two halves of
 * one mounted table cannot both describe one route.
 */
function describeRecordedRoutes(
  diagnostics: AponiaApplicationDiagnostics | undefined,
): ReadonlyMap<string, AponiaMountedRoute> {
  const recorded = new Map<string, AponiaMountedRoute>();

  for (const entry of recordedEntries(diagnostics?.routes)) {
    const plan = entry?.route;
    if (typeof plan?.method !== "string" || typeof plan.path !== "string") {
      continue;
    }

    // An entry's `source` is read for the one rule both endpoints share although
    // the record's type declares it, because the record is read through a
    // registry-global symbol key: a boot run by a copy of the platform older
    // than this field answers the same key with plans that have none, and a
    // foreign one may state a value this release does not write. Both read as
    // the absence — the answer a route no record describes reports — rather than
    // as a binding state this route was never given.
    const source = readRouteSource(entry.source);
    recorded.set(
      routeKey(plan.method, plan.path),
      Object.freeze({
        method: plan.method,
        path: plan.path,
        module: entry.module,
        controller: entry.controller,
        handler: handlerName(plan.propertyKey),
        source,
        parameters: readRouteParameters(plan.parameters),
      }),
    );
  }

  for (const entry of recordedEntries(diagnostics?.callbackRoutes)) {
    if (typeof entry?.method !== "string" || typeof entry.path !== "string") {
      continue;
    }

    const key = routeKey(entry.method, entry.path);
    if (recorded.has(key)) {
      continue;
    }

    const source = readRouteSource(entry.source);
    recorded.set(
      key,
      Object.freeze({
        method: entry.method,
        path: entry.path,
        module: entry.module,
        controller: entry.controller,
        // A callback builds its routes from an instance and registers them
        // itself, so no plan names the property key that built one: the report
        // states that absence rather than a guess.
        handler: "",
        source,
        parameters: Object.freeze([]),
      }),
    );
  }

  return recorded;
}

/**
 * One route the record holds nothing about, as the payload reports it: the two
 * facts the mounted table states, and every fact the record would have supplied
 * left empty rather than filled in.
 */
function describeUnrecordedRoute(method: string, path: string): AponiaMountedRoute {
  return Object.freeze({
    method,
    path,
    module: "",
    controller: "",
    handler: "",
    source: null,
    parameters: Object.freeze([]),
  });
}

/**
 * The mounted table as this endpoint reads it.
 *
 * `routes` is a stable Elysia API, but what this release reads is whatever the
 * installed one holds. A table that is not an array is a route report with no
 * routes rather than a reason to fail the request: this handler answers inside
 * `Bun.serve`, and an application whose routes cannot be read is still an
 * application whose other endpoints answer.
 */
function readMountedRoutes(application: Elysia): readonly MountedNativeRoute[] {
  const mounted: readonly MountedNativeRoute[] = application.routes;

  return Array.isArray(mounted) ? mounted : [];
}

/**
 * The key a record entry and a mounted route are joined on.
 *
 * The method is folded to upper case on both sides because the two sources state
 * it differently — a plan declares `RequestMethod` values while the table
 * carries whatever Elysia stored — and a join that missed a route over its case
 * would report a mounted route as one no record describes.
 */
function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

/**
 * A handler's property key as the payload spells it, or the empty string when
 * the entry states none.
 *
 * `String(key)` is the projection the platform's own inspection uses, and it is
 * applied here rather than left to JSON: a symbol-keyed handler has no string
 * form in a payload that dropped it, and `Symbol(description)` keeps the marker
 * readable.
 */
function handlerName(propertyKey: unknown): string {
  return typeof propertyKey === "string" || typeof propertyKey === "symbol"
    ? String(propertyKey)
    : "";
}

/**
 * A record's entries as a walkable list, for the same reason the table is
 * checked: the record arrives through a registry-global symbol key, and a copy
 * of the platform older than a collection answers the same key without it.
 */
function recordedEntries<TEntry>(entries: readonly TEntry[] | undefined): readonly TEntry[] {
  return Array.isArray(entries) ? entries : [];
}

/**
 * The order the payload states: path, method, controller, handler, and module,
 * each compared by code unit so every runtime orders identically.
 */
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
