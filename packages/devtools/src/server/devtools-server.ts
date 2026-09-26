import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readApplicationDiagnostics } from "@aponiajs/platform-elysia";
import type { Elysia } from "elysia";
import { buildFlowPayload, devtoolsFlowPath } from "../endpoints/flow.ts";
import { buildGraphPayload, devtoolsGraphPath } from "../endpoints/graph.ts";
import { buildLogsPayload, devtoolsLogsPath, readLogsCursor } from "../endpoints/logs.ts";
import { buildMetaPayload, devtoolsMetaPath } from "../endpoints/meta.ts";
import { buildRoutesPayload, devtoolsRoutesPath } from "../endpoints/routes.ts";
import { createLogBuffer, defaultLogBufferCapacity } from "../logging/log-buffer.ts";
import type { LogBuffer } from "../logging/log-buffer.types.ts";
import { isRecordableLogger, tapLogBuffer } from "../logging/log-tap.ts";
import type {
  DevtoolsHandlers,
  DevtoolsServer,
  DevtoolsServerOptions,
} from "./devtools-server.types.ts";
import { routeRequest } from "./request-router.ts";

/** The only address the devtools socket ever binds. */
const devtoolsHostname = "127.0.0.1";

/** The port an application that names none binds. */
const defaultDevtoolsPort = 8000;

/**
 * Starts the loopback devtools server for one boot.
 *
 * Synchronous on purpose. Elysia invokes a plugin's `onStart` without awaiting
 * it, so nothing here may be a promise that has to settle before the first
 * request is served — including the read that resolves the installed Elysia.
 *
 * The application's log stream is taken from the boot record it carries, and
 * recording its lines means patching the logger the record names **in place**:
 * the application and the platform already hold their references to it, so a
 * wrapper would see only the lines that went through the wrapper and a
 * replacement would be a logger neither of them writes to. That is a mutation of
 * a logger the platform built, done here because a stream of the application's
 * own lines cannot be had any other way.
 *
 * A refused bind is this package's problem and never the application's: the
 * reason is reported under `Devtools`, with the address it could not take, and
 * `undefined` is returned. That is the caller's signal that there is nothing to
 * report as listening; the boot itself continues untouched.
 */
export function startDevtoolsServer(options: DevtoolsServerOptions): DevtoolsServer | undefined {
  const port = options.port ?? defaultDevtoolsPort;
  const handlers = createHandlers(options.application, createLogStream(options.application));

  try {
    const server = Bun.serve({
      hostname: devtoolsHostname,
      port,
      fetch: (request) => routeRequest(request, handlers),
    });

    return Object.freeze({ url: server.url.origin, stop: () => void server.stop(true) });
  } catch (error) {
    options.logger.warn(
      `Aponia devtools could not listen on http://${devtoolsHostname}:${port} (${describe(error)}); the application continues without it.`,
    );

    return undefined;
  }
}

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
 * The application's log stream, taken from the boot record it carries.
 *
 * The logger is a boot decision, so it is read from the record rather than
 * passed beside it: whatever `AponiaFactory.create` was given — a
 * `LoggerService`, a list of levels, or nothing at all — the record names the
 * very object the platform writes through, so no registration can disagree with
 * the boot it belongs to and an application that named no logger is not a
 * silence nobody can explain.
 *
 * Three states are three answers. A record naming a logger is tapped, which is
 * the in-place patch `startDevtoolsServer` states above, and its stream is
 * published. `null` — the application disabled its logging — is a decision, and
 * the stream is published empty rather than absent, because that is what the
 * decision looks like to a client. A record with no logger field at all is one
 * written before this field existed, or an application no boot produced, and it
 * serves no `/logs` at all: the endpoint states a stream, and this one has none
 * to state. A field a foreign record fills with something that is not a logger
 * reads the same way, because an empty stream would claim the application logs
 * nothing.
 */
function createLogStream(application: Elysia): LogBuffer | undefined {
  const logger = readApplicationDiagnostics(application)?.logger;

  if (logger === undefined) {
    return undefined;
  }

  const logs = createLogBuffer(defaultLogBufferCapacity);

  if (logger === null) {
    return logs;
  }

  return isRecordableLogger(logger) ? tapLogBuffer(logger, logs) : undefined;
}

/**
 * The endpoints one server serves, built once — with one payload the running
 * application answers rather than the boot.
 *
 * `/meta` and `/graph` describe a boot, and a boot does not change once it has
 * started, so their payloads are built here and answered unchanged. `/routes`,
 * `/flow`, and `/logs` report what the running application holds, which belongs
 * to the application rather than to the boot: an application may mount another
 * route on its native instance before it listens, and the lines it logs arrive
 * while it serves, so those handlers read their source when they are asked
 * instead of freezing a moment no client ever observed. The table is also where
 * a route's own entry lives — its contributed hooks and the schema slots Elysia
 * holds — which is the half of a route's stages no boot record carries. All of
 * them are registered whatever the record holds, because the table is this
 * package's answer on its own; a route no record describes is reported with the
 * facts a record would have supplied left empty.
 *
 * `/logs` is the one endpoint whose source is not the record's own data but the
 * live object the record names: it is registered for a server that resolved a
 * stream, and its cursor is the request's, because two pollers read the same
 * stream from two different positions.
 *
 * Every builder it calls is total — a record this release cannot project is one
 * of the cases they answer rather than throw for — because this runs before the
 * bind's `try`, where a failure would be reported as a refused listen, a cause
 * this package never observed.
 */
function createHandlers(application: Elysia, logs: LogBuffer | undefined): DevtoolsHandlers {
  const diagnostics = readApplicationDiagnostics(application);
  const meta = buildMetaPayload({
    diagnostics,
    elysia: resolveElysiaVersion(import.meta.dir),
    startedAt: new Date().toISOString(),
  });
  const graph = buildGraphPayload(diagnostics);

  return Object.freeze({
    [devtoolsMetaPath]: () => jsonResponse(meta),
    // A boot the record holds no compiled root for serves no `/graph` at all:
    // the handler record states the paths this server serves, and a path it does
    // not own is the dispatcher's `404`.
    ...(graph === undefined ? {} : { [devtoolsGraphPath]: () => jsonResponse(graph) }),
    [devtoolsRoutesPath]: () => jsonResponse(buildRoutesPayload(application, diagnostics)),
    [devtoolsFlowPath]: () => jsonResponse(buildFlowPayload(application, diagnostics)),
    // A server with no stream serves no `/logs`, the way a boot the record holds
    // no compiled root for serves no `/graph`: the handler record states the
    // paths this server serves, and a path it does not own is the dispatcher's
    // `404`.
    ...(logs === undefined
      ? {}
      : {
          [devtoolsLogsPath]: (request: Request) =>
            jsonResponse(buildLogsPayload(logs, readLogsCursor(request))),
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

/**
 * One line-safe account of a thrown reason. The refusal is a single row, so a
 * message that arrived wrapped is folded back into one.
 */
function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  return message.replaceAll(/\s+/g, " ").trim();
}
