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
import { oneLine } from "../logging/one-line.ts";
import type { TappedLogStream } from "../logging/log-tap.ts";
import type { RequestBuffer } from "../requests/request-buffer.types.ts";
import type {
  DevtoolsHandlers,
  DevtoolsServer,
  DevtoolsServerOptions,
} from "./devtools-server.types.ts";
import { routeRequest } from "./request-router.ts";

/** The address a registration that names none binds. */
const defaultDevtoolsHostname = "127.0.0.1";

/**
 * The loopback spellings this package stays silent for: the `localhost` name
 * with an optional root dot, the IPv6 loopback, and any address in
 * `127.0.0.0/8` written as four dotted octets.
 *
 * The check is syntactic and resolves nothing, and that direction is the safe
 * one: any name the pattern cannot be sure of is reported rather than assumed.
 * `127.1`, `::ffff:127.0.0.1`, and `0:0:0:0:0:0:0:1` are loopback to a resolver
 * and to the kernel, and all three warn here. `localhost` is the one name
 * accepted without being resolved, and the price is stated where the option is
 * documented: a hosts file that mapped it to one of this machine's public
 * addresses would bind it in silence.
 *
 * The octets after `127` are not range-checked because an address outside an
 * interface's range cannot bind at all — there is nothing to expose — while a
 * spelling that is rejected for the wrong reason would go silent.
 */
const loopbackHostPattern = /^(?:localhost\.?|::1|127(?:\.\d{1,3}){3})$/i;

/**
 * Whether a host names the loopback interface, so a bind to it exposes nothing.
 *
 * Exported for this package's own tests, which pin the boundary the socket cases
 * cannot reach: three of the near-miss spellings warn while binding
 * successfully, so a socket case would report what they resolved to rather than
 * what the check decided. Not on the barrel — an application never calls this.
 *
 * @internal
 */
export function isLoopbackHost(host: string): boolean {
  return loopbackHostPattern.test(host);
}

/** The port an application that names none binds. */
const defaultDevtoolsPort = 8000;

/**
 * Starts the devtools server for one boot.
 *
 * Synchronous on purpose. Elysia invokes a plugin's `onStart` without awaiting
 * it, so nothing here may be a promise that has to settle before the first
 * request is served — including the read that resolves the installed Elysia.
 *
 * The bind address is the caller's, and the default is loopback because a
 * debugging aid should not be reachable by default. A bind outside loopback is
 * permitted and never silent: one row names the address it bound and
 * `/requests`, because that endpoint records request headers and bodies by
 * default, so the reader is told what the bind exposed rather than left to
 * infer it.
 *
 * A refused bind is this package's problem and never the application's: the
 * reason is reported under `Devtools`, with the address it could not take, and
 * `undefined` is returned. That is the caller's signal that there is nothing to
 * report as listening; the boot itself continues untouched. The report is
 * guarded, because a logger that refuses it would otherwise cost the caller
 * both the row and that `undefined` — see `reportRefusedBind`.
 */
export function startDevtoolsServer(options: DevtoolsServerOptions): DevtoolsServer | undefined {
  const port = options.port ?? defaultDevtoolsPort;
  const host = options.host ?? defaultDevtoolsHostname;
  const handlers = createHandlers(
    options.application,
    options.logs,
    options.requests,
    options.logger,
  );

  try {
    const server = Bun.serve({
      hostname: host,
      port,
      fetch: (request) => routeRequest(request, handlers),
    });
    const url = server.url.origin;

    // Reported after the socket exists, so the row names the address that was
    // taken rather than one that was asked for — the port is the socket's, not
    // the registration's. A bind that never happened states its own refusal
    // below instead, so a failed widening is one row and not two.
    if (!isLoopbackHost(host)) {
      options.logger.warn(
        `Aponia devtools is bound to ${url} because the registration set host, so /requests — ` +
          "which records request headers and bodies by default — is reachable from outside this machine.",
      );
    }

    return Object.freeze({ url, stop: () => void server.stop(true) });
  } catch (error) {
    // An IPv6 host is bracketed the way a URL needs it here: the socket never
    // started, so the address is the one the registration asked for.
    const refusedAddress = host.includes(":")
      ? `http://[${host}]:${port}`
      : `http://${host}:${port}`;
    // Built once, because it is stated on one of two channels: the logger this
    // start was handed, or, when that logger refuses, `stderr`.
    const refusal = `Aponia devtools could not listen on ${refusedAddress} (${oneLine(error)}); the application continues without it.`;

    reportRefusedBind(options.logger, refusal);

    return undefined;
  }
}

/**
 * Reports a refused bind, and never lets the logger's own failure become the
 * caller's.
 *
 * The sentence is this package's only account of a refusal the boot already
 * survived, and `LoggerService` is an interface an application's own
 * implementation may refuse: a throw out of the `warn` above would leave the
 * caller with neither the report nor the `undefined` that says there is nothing
 * to report as listening. That is worse here than anywhere else in the
 * framework, because this runs inside the plugin's `onStart`, which Elysia
 * neither awaits nor catches — the refusal would take `listen()` with it, and
 * the sentence the row carries, that the application continues without the
 * devtools server, would be the one thing a throw made false.
 *
 * The rule is the framework's: a call site that reports a failure guards, and a
 * call site that reports progress does not. This one reports a failure, so a
 * logger that refuses is answered on `stderr` by a direct write — the only
 * place this package writes a process stream — because the channel that would
 * normally carry the row is the one that just failed. The wording is the
 * logger's either way; only the channel changes.
 */
function reportRefusedBind(logger: LoggerService, refusal: string): void {
  try {
    logger.warn(refusal);
  } catch {
    announceRefusedBind(refusal);
  }
}

/**
 * States a refused bind where a reader will see it, when the logger would not.
 *
 * Guarded for the reason the call above is: a process can be writing to a
 * stream that refuses, and a throw out of this one would leave the caller with
 * no report and no `undefined` — the two things this path exists to deliver
 * together. A `stderr` write that refuses leaves nothing further to report to,
 * so the absence is accepted at the last line rather than taken out on the
 * boot.
 */
function announceRefusedBind(refusal: string): void {
  try {
    process.stderr.write(`${refusal}\n`);
  } catch {
    // Nothing left to report to.
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
 * `/logs` and `/requests` are the endpoints whose source is passed in rather than
 * read off the application: each is registered only for a server that was handed
 * the buffer it states, and each reads its cursor from the request, because two
 * pollers read one buffer from two different positions.
 *
 * `/aot` publishes the facts its record states even when that is all it can
 * publish, so the path is registered only for a record that carries them: a
 * record a copy of the platform this release does not own wrote is one this
 * server has nothing to say about, and the dispatcher answers `404` for it. The
 * analyzer that supplies its other half is reached from the request instead, so
 * nothing here loads it.
 *
 * Every builder it calls is total — a record this release cannot project is one
 * of the cases they answer rather than throw for — because this runs before the
 * bind's `try`, where a failure would be reported as a refused listen, a cause
 * this package never observed.
 */
function createHandlers(
  application: Elysia,
  logs: TappedLogStream | undefined,
  requests: RequestBuffer | undefined,
  logger: LoggerService,
): DevtoolsHandlers {
  const diagnostics = readApplicationDiagnostics(application);
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
    // the handler record states the paths this server serves, and a path it does
    // not own is the dispatcher's `404`.
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
