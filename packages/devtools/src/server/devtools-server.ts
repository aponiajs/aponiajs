import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
