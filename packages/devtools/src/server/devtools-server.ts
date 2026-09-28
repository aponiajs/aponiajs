import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LoggerService } from "@aponiajs/common";
import { readApplicationDiagnostics } from "@aponiajs/platform-elysia";
import type { Elysia } from "elysia";
import {
  buildAotPayload,
  devtoolsAotPath,
  loadAotAnalysis,
  readAotFacts,
} from "../endpoints/aot.ts";
import { buildFlowPayload, devtoolsFlowPath } from "../endpoints/flow.ts";
import { buildGraphPayload, devtoolsGraphPath } from "../endpoints/graph.ts";
import { readSinceCursor } from "../endpoints/cursor.ts";
import { buildLogsPayload, devtoolsLogsPath } from "../endpoints/logs.ts";
import { buildMetaPayload, devtoolsMetaPath } from "../endpoints/meta.ts";
import { buildRequestsPayload, devtoolsRequestsPath } from "../endpoints/requests.ts";
import { buildRoutesPayload, devtoolsRoutesPath } from "../endpoints/routes.ts";
import type { TappedLogStream } from "../logging/log-tap.ts";
import type { RequestBuffer } from "../requests/request-buffer.types.ts";
import type { DevtoolsHandlers } from "./devtools-server.types.ts";

/**
 * The endpoints one application's surface serves.
 *
 * There is no server in this module and no socket behind the package: the
 * surface is a route the plugin mounts on the application, and `routeRequest`
 * decides what that route answers. What is left here is what has to be decided
 * before a socket could exist — the record the request is dispatched against —
 * and the one fact that is read from the tree rather than from a boot.
 */

/**
 * The Elysia release installed in the tree that asks, or `null` when the tree
 * has not installed one.
 *
 * Only an install answers. `Bun.resolveSync` falls back to Bun's global install
 * cache when a package is absent from the tree it resolves from, so asking it
 * here would report whatever the machine happens to have — a release the
 * application never ran against. The walk up from the directory that asks is
 * what keeps the answer local, and the manifest is read from the path the walk
 * found rather than resolved a second time, so nothing can consult the cache in
 * between.
 *
 * The starting directory is the one the caller that asks sees, which is the
 * dependency tree the running package resolved through rather than the process's
 * working directory, where an application started from anywhere else would
 * point the answer at the wrong install.
 *
 * A package that is present but carries no version reads the same way as one
 * that is not installed: the payload reports what it read, and a guess would be
 * worse than an absence.
 *
 * @internal
 */
export function resolveElysiaVersion(baseDirectory: string): string | null {
  const manifestPath = findInstalledElysiaManifest(baseDirectory);

  if (manifestPath === undefined) {
    return null;
  }

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: unknown };

    return typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}

/**
 * The manifest of the nearest `node_modules/elysia` at or above a directory, or
 * `undefined` when the walk reaches the filesystem root without finding one.
 *
 * A package's own directory usually has no `node_modules` of its own: the
 * install that serves it is hoisted to a workspace or project root above it, and
 * that is the copy the running application resolved through.
 */
function findInstalledElysiaManifest(baseDirectory: string): string | undefined {
  const candidate = join(baseDirectory, "node_modules", "elysia", "package.json");

  if (existsSync(candidate)) {
    return candidate;
  }

  // `dirname` of a filesystem root is that root, which is where the walk ends.
  const parent = dirname(baseDirectory);

  return parent === baseDirectory ? undefined : findInstalledElysiaManifest(parent);
}

/**
 * The endpoints one application answers, built once, with the payloads that
 * describe the running application read at request time rather than the boot.
 *
 * `/meta` and `/graph` describe a boot, and a boot does not change once it has
 * started, so their payloads are built here and answered unchanged. `/routes`,
 * `/flow`, and `/logs` report what the running application holds, which belongs
 * to the application rather than to the boot: an application may mount another
 * route on its native instance before it listens, and the lines it logs arrive
 * while it serves, so those handlers read their source when they are asked
 * instead of freezing a moment no client ever observed. The table is also where
 * a route's own entry lives — its contributed hooks and the schema slots Elysia
 * holds — which is the half of a route's stages no boot record carries.
 *
 * `application` is `undefined` for a request that reached a registration with no
 * boot behind it — a plugin mounted on a bare `Elysia` by hand. Three endpoints
 * need it, and an endpoint whose fact is missing is not registered rather than
 * answered with a guess, so a path this record does not own is the dispatcher's
 * `404`, exactly as a record with no compiled root serves no `/graph`.
 * `/meta` still answers, with this release's own stamp and `null` for every
 * artifact no boot adopted, because that is what it says for a record it does
 * not hold.
 *
 * `/logs` and `/requests` are the endpoints whose source is passed in rather
 * than read off the application: each is registered only for a surface that was
 * handed the buffer it states, and each reads its cursor from the request,
 * because two pollers read one buffer from two different positions. `/logs`
 * comes from the registration and answers without a boot; `/requests` comes from
 * the record the boot opened, so an application no boot produced serves none —
 * there is no record, and an empty window would claim there was one.
 *
 * `/aot` publishes the facts its record states even when that is all it can
 * publish, so the path is registered only for a record that carries them: a
 * record a copy of the platform this release does not own wrote is one this
 * surface has nothing to say about, and the dispatcher answers `404` for it. The
 * analyzer that supplies its other half is reached from the request instead, so
 * nothing here loads it.
 *
 * Every builder it calls is total — a record this release cannot project is one
 * of the cases they answer rather than throw for — because this runs inside a
 * request handler, where a throw is that request's failure.
 *
 * @internal
 *
 * The mounted route and this package's own tests are the only callers, and it
 * stays off the barrel: `routeRequest` is the dispatcher an application is told
 * about, and this is the record it is dispatched against.
 */
export function createHandlers(
  application: Elysia | undefined,
  logs: TappedLogStream | undefined,
  requests: RequestBuffer | undefined,
  logger: LoggerService,
): DevtoolsHandlers {
  const diagnostics =
    application === undefined ? undefined : readApplicationDiagnostics(application);
  const meta = buildMetaPayload({
    diagnostics,
    elysia: resolveElysiaVersion(import.meta.dir),
    startedAt: new Date().toISOString(),
  });
  const graph = buildGraphPayload(diagnostics);
  const aot = readAotFacts(diagnostics);

  return Object.freeze({
    [devtoolsMetaPath]: () => jsonResponse(meta),
    // A boot the record holds no compiled root for serves no `/graph` at all:
    // the handler record states the paths this surface serves, and a path it
    // does not own is the dispatcher's `404`.
    ...(graph === undefined ? {} : { [devtoolsGraphPath]: () => jsonResponse(graph) }),
    // `/aot` is the one endpoint here whose payload is built per request even
    // though half of it describes the boot: the other half is a project's
    // analysis, which is settled asynchronously and read from a cache this
    // handler shares with every later poll.
    ...(aot === undefined
      ? {}
      : {
          [devtoolsAotPath]: async () =>
            jsonResponse(buildAotPayload(aot, await loadAotAnalysis(process.cwd(), logger))),
        }),
    // The two endpoints whose fact is the mounted application. A surface that
    // reached no application serves neither: the table they report belongs to an
    // application, and an answer invented without one would describe nothing.
    ...(application === undefined
      ? {}
      : {
          [devtoolsRoutesPath]: () => jsonResponse(buildRoutesPayload(application, diagnostics)),
          [devtoolsFlowPath]: () => jsonResponse(buildFlowPayload(application, diagnostics)),
        }),
    // A surface with no stream serves no `/logs`, the way a boot the record holds
    // no compiled root for serves no `/graph`: the handler record states the
    // paths this surface serves, and a path it does not own is the dispatcher's
    // `404`.
    ...(logs === undefined
      ? {}
      : {
          [devtoolsLogsPath]: (request: Request) =>
            jsonResponse(buildLogsPayload(logs.buffer, readSinceCursor(request), logs.levels)),
        }),
    // The request record is passed in for `/logs`' reason, and a registration
    // that captures nothing still hands one over: an empty record with a live
    // cursor is a fact about the registration, not an absence to infer.
    ...(requests === undefined
      ? {}
      : {
          [devtoolsRequestsPath]: (request: Request) =>
            jsonResponse(buildRequestsPayload(requests, readSinceCursor(request))),
        }),
  });
}

/**
 * One endpoint's answer. Every payload is built when it is asked for and is
 * never stored: a cached report would outlive the moment it describes.
 */
function jsonResponse(payload: unknown): Response {
  return Response.json(payload, { status: 200, headers: { "cache-control": "no-store" } });
}
