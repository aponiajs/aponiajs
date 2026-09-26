import { readFileSync } from "node:fs";
import { readApplicationDiagnostics } from "@aponiajs/platform-elysia";
import type { Elysia } from "elysia";
import { buildMetaPayload, devtoolsMetaPath } from "../endpoints/meta.ts";
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
 * A refused bind is this package's problem and never the application's: the
 * reason is reported under `Devtools`, with the address it could not take, and
 * `undefined` is returned. That is the caller's signal that there is nothing to
 * report as listening; the boot itself continues untouched.
 */
export function startDevtoolsServer(options: DevtoolsServerOptions): DevtoolsServer | undefined {
  const port = options.port ?? defaultDevtoolsPort;
  const handlers = createHandlers(options.application);

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
 * The resolved Elysia release, or `null` when none resolves.
 *
 * Resolved from the directory of the caller that asks, which is the dependency
 * tree the running package sees — the same tree the framework's own resolution
 * uses — rather than the process's working directory, where an application
 * started from anywhere else would point the answer at the wrong install.
 *
 * A manifest that cannot be read and one that carries no version are both "no
 * Elysia resolves" rather than a guess: the payload reports what was read.
 *
 * @internal
 */
export function resolveElysiaVersion(baseDirectory: string): string | null {
  try {
    const manifestPath = Bun.resolveSync("elysia/package.json", baseDirectory);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: unknown };

    return typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}

/**
 * The endpoints one server serves, built once. The report is fixed for the life
 * of the socket: it describes a boot, and a boot does not change after it has
 * started.
 */
function createHandlers(application: Elysia): DevtoolsHandlers {
  const meta = buildMetaPayload({
    diagnostics: readApplicationDiagnostics(application),
    elysia: resolveElysiaVersion(import.meta.dir),
    startedAt: new Date().toISOString(),
  });

  return Object.freeze({
    [devtoolsMetaPath]: () =>
      Response.json(meta, { status: 200, headers: { "cache-control": "no-store" } }),
  });
}

/**
 * One line-safe account of a thrown reason. The refusal is a single row, so a
 * message that arrived wrapped is folded back into one.
 */
function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  return message.replaceAll(/\s+/g, " ").trim();
}
