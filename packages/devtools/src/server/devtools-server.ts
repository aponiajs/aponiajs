import type { LoggerService } from "@aponiajs/common";
import type { AponiaBootDiagnostics } from "@aponiajs/platform-core";
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
import type { LogStream } from "../logging/log-tap.ts";
import type { RequestBuffer } from "../interfaces/request-buffer.interface.ts";
import type { DevtoolsHandlers } from "../interfaces/devtools-server.interface.ts";
import { devtoolsUiHtml } from "./ui-page.ts";

/**
 * The endpoints one application's surface serves.
 *
 * There is no server in this module and no socket behind the package: the
 * surface is a controller the module registers, and `handleDevtoolsRequest`
 * decides what the controller's handlers answer. What is left here is the record
 * the request is dispatched against.
 */

/**
 * The endpoints one application answers, built once, with the payloads that
 * describe the running application read at request time rather than the boot.
 *
 * Every fact comes from the neutral boot record, so the same endpoints answer
 * the same way on every platform. A route mounted directly on a native
 * application outside the graph, a contributed native hook, and a native route
 * table are not part of the record; the payloads state their absence rather than
 * reading a platform object.
 *
 * @internal
 */
export function createHandlers(
  diagnostics: AponiaBootDiagnostics | undefined,
  logs: LogStream | undefined,
  requests: RequestBuffer | undefined,
  logger: LoggerService,
): DevtoolsHandlers {
  const meta = buildMetaPayload({ diagnostics, startedAt: new Date().toISOString() });
  const graph = buildGraphPayload(diagnostics);
  const aot = readAotFacts(diagnostics);
  const ui = (): Response => htmlResponse(devtoolsUiHtml());

  return Object.freeze({
    "": ui,
    "/": ui,
    [devtoolsMetaPath]: () => jsonResponse(meta),
    ...(graph === undefined
      ? {}
      : {
          [devtoolsGraphPath]: (request: Request) => {
            const view = new URL(request.url).searchParams.get("view");
            if (view === "graph" || view === "nodes") {
              return jsonResponse(buildGraphPayload(diagnostics, { view }));
            }
            return jsonResponse(graph);
          },
        }),
    ...(aot === undefined
      ? {}
      : {
          [devtoolsAotPath]: async () =>
            jsonResponse(buildAotPayload(aot, await loadAotAnalysis(process.cwd(), logger))),
        }),
    ...(diagnostics === undefined
      ? {}
      : {
          [devtoolsRoutesPath]: () => jsonResponse(buildRoutesPayload(diagnostics)),
          [devtoolsFlowPath]: () => jsonResponse(buildFlowPayload(diagnostics)),
        }),
    ...(logs === undefined
      ? {}
      : {
          [devtoolsLogsPath]: (request: Request) =>
            jsonResponse(buildLogsPayload(logs.buffer, readSinceCursor(request), logs.levels)),
        }),
    ...(requests === undefined
      ? {}
      : {
          [devtoolsRequestsPath]: (request: Request) =>
            jsonResponse(buildRequestsPayload(requests, readSinceCursor(request))),
        }),
  });
}

function jsonResponse(payload: unknown): Response {
  return Response.json(payload, { status: 200, headers: { "cache-control": "no-store" } });
}

function htmlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
    },
  });
}
