import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Module, defineModule, type LoggerService, type ModuleDefinition } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";
import {
  aponiaVersion,
  resolveElysiaVersion,
  routeRequest,
  startDevtoolsServer,
  type AponiaMetaPayload,
  type DevtoolsHandlers,
  type DevtoolsServer,
} from "../src/index.ts";

/**
 * The loopback server and the dispatcher under it. The contract is HTTP, so
 * every case either calls the pure dispatcher or fetches a socket that bound
 * port `0` and had its address read back: no case here depends on a port it
 * guessed, and none of them answers the question "is 8000 free".
 */

/** The Elysia this workspace installed, read without the resolver under test. */
const installedElysiaVersion = (
  (await Bun.file(Bun.resolveSync("elysia/package.json", import.meta.dir)).json()) as {
    version: string;
  }
).version;

const silentLogger: LoggerService = {
  log: () => {},
  fatal: () => {},
  error: () => {},
  warn: () => {},
};

/** Binds the loopback socket on port `0` and reads the address it took. */
function serveLoopback(
  application: Elysia,
  options: { readonly port?: number; readonly logger?: LoggerService } = {},
): DevtoolsServer {
  const server = startDevtoolsServer({
    application,
    port: options.port ?? 0,
    logger: options.logger ?? silentLogger,
  });

  if (server === undefined) {
    throw new Error("the devtools server refused to bind the loopback socket");
  }

  return server;
}

async function readMeta(server: DevtoolsServer): Promise<AponiaMetaPayload> {
  const response = await fetch(`${server.url}/__devtools/meta`);

  expect(response.status).toBe(200);

  return (await response.json()) as AponiaMetaPayload;
}

@Module({})
class DevtoolsServerFixtureModule {}

const declaredFixtureModule: ModuleDefinition = defineModule({
  id: "DevtoolsServerFixtureDeclared",
});

test("a non-GET method answers 405 before any path lookup", async () => {
  const handlers: DevtoolsHandlers = { "/meta": () => Response.json({ contract: 1 }) };

  const inside = await routeRequest(
    new Request("http://127.0.0.1:1/__devtools/meta", { method: "POST" }),
    handlers,
  );
  expect(inside.status).toBe(405);
  expect(inside.headers.get("allow")).toBe("GET");

  // The method decides before the path is read, so a path this server does not
  // own answers 405 rather than 404.
  const outside = await routeRequest(
    new Request("http://127.0.0.1:1/not-devtools", { method: "PUT" }),
    handlers,
  );
  expect(outside.status).toBe(405);
});

test("a path the dispatcher does not own answers 404", async () => {
  const handlers: DevtoolsHandlers = { "/meta": () => Response.json({ contract: 1 }) };

  const paths = [
    "/not-devtools",
    "/__devtools",
    "/__devtools/",
    "/__devtools/nope",
    "/__devtools/meta/",
    "/__devtoolsx/meta",
    // A suffix lookup that read the prototype chain would find a function here
    // and call it; the dispatcher only serves what the handler record owns.
    "/__devtools/constructor",
  ];

  for (const path of paths) {
    const response = await routeRequest(new Request(`http://127.0.0.1:1${path}`), handlers);
    expect(response.status).toBe(404);
  }
});

test("the dispatcher hands the request to the handler it found, answer untouched", async () => {
  const handlers: DevtoolsHandlers = {
    "/meta": (request) => Response.json(new URL(request.url).search),
    "/teapot": () => new Response("short and stout", { status: 418 }),
  };

  const searched = await routeRequest(
    new Request("http://127.0.0.1:1/__devtools/meta?verbose=1"),
    handlers,
  );
  expect(await searched.json()).toBe("?verbose=1");

  const teapot = await routeRequest(new Request("http://127.0.0.1:1/__devtools/teapot"), handlers);
  expect(teapot.status).toBe(418);
});

test("the listening socket answers the method and path contract over HTTP", async () => {
  const server = serveLoopback(new Elysia());
  try {
    expect(server.url.startsWith("http://127.0.0.1:")).toBe(true);

    const get = await fetch(`${server.url}/__devtools/meta`);
    expect(get.status).toBe(200);

    const post = await fetch(`${server.url}/__devtools/meta`, { method: "POST" });
    expect(post.status).toBe(405);

    const unknown = await fetch(`${server.url}/__devtools/nope`);
    expect(unknown.status).toBe(404);

    const outside = await fetch(`${server.url}/not-devtools`);
    expect(outside.status).toBe(404);
  } finally {
    server.stop();
  }
});

test("meta carries the contract version and the release it speaks", async () => {
  const application = await AponiaFactory.createNative(DevtoolsServerFixtureModule, {
    logger: false,
  });
  const server = serveLoopback(application);

  try {
    const response = await fetch(`${server.url}/__devtools/meta`);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");

    const meta = (await response.json()) as AponiaMetaPayload;

    expect(meta).toEqual({
      contract: 1,
      framework: aponiaVersion,
      elysia: installedElysiaVersion,
      artifacts: { invokers: null, descriptors: null },
      startedAt: expect.any(String),
    });
    expect(meta.startedAt).toBe(new Date(meta.startedAt).toISOString());

    // The payload is built once and shared by every request, so a second read
    // reports the same boot rather than the moment it was asked.
    expect(await readMeta(server)).toEqual(meta);
  } finally {
    server.stop();
  }
});

test("meta names the release that supplied each artifact a boot adopted", async () => {
  const application = await AponiaFactory.createNative(DevtoolsServerFixtureModule, {
    logger: false,
    invokers: { framework: aponiaVersion, elysia: installedElysiaVersion, invokers: new Map() },
    descriptors: {
      framework: aponiaVersion,
      elysia: installedElysiaVersion,
      modules: { DevtoolsServerFixtureModule: declaredFixtureModule },
    },
  });
  const server = serveLoopback(application);

  try {
    const meta = await readMeta(server);

    expect(meta.framework).toBe(aponiaVersion);
    expect(meta.artifacts).toEqual({ invokers: aponiaVersion, descriptors: aponiaVersion });
  } finally {
    server.stop();
  }
});

test("meta reports no stamp for a descriptor the caller wrote by hand", async () => {
  // The graph is declared data, and no build emitted it: the record's stamps are
  // the artifact's own release, so a hand-written descriptor reports `null`
  // rather than the release that happens to be serving the report.
  const application = await AponiaFactory.createNative(declaredFixtureModule, { logger: false });
  const server = serveLoopback(application);

  try {
    const meta = await readMeta(server);

    expect(meta.framework).toBe(aponiaVersion);
    expect(meta.artifacts).toEqual({ invokers: null, descriptors: null });
  } finally {
    server.stop();
  }
});

test("meta falls back to the release serving it when no boot produced the application", async () => {
  const server = serveLoopback(new Elysia());

  try {
    const meta = await readMeta(server);

    expect(meta.framework).toBe(aponiaVersion);
    expect(meta.artifacts).toEqual({ invokers: null, descriptors: null });
  } finally {
    server.stop();
  }
});

test("a record from a copy of the platform older than the artifact stamps answers null", async () => {
  // The record is read through a registry-global symbol key, so a boot run by an
  // older copy of `@aponiajs/platform-elysia` in this process is reachable from
  // here — and that copy's record has no `artifacts` at all. This attaches the
  // record the way an older bootstrap did. The handler build runs inside the
  // plugin's `onStart`, where a throw takes `listen()` with it, so the read has
  // to answer `null`, the way it does for an artifact the boot did not adopt,
  // rather than fail a boot that is otherwise fine.
  const application = new Elysia();
  Object.defineProperty(application, Symbol.for("aponia.application.diagnostics"), {
    value: {
      framework: "0.0.0-older",
      graph: "decorated",
      invokers: { accepted: false, reason: undefined },
    },
    enumerable: false,
  });

  const server = serveLoopback(application);

  try {
    const meta = await readMeta(server);

    expect(meta.framework).toBe("0.0.0-older");
    expect(meta.artifacts).toEqual({ invokers: null, descriptors: null });
  } finally {
    server.stop();
  }
});

test("a port that is already bound is refused, and the caller continues", async () => {
  const blocker = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("taken"),
  });
  const warnings: string[] = [];
  const logger: LoggerService = {
    log: () => {},
    fatal: () => {},
    error: () => {},
    warn: (message) => {
      warnings.push(String(message));
    },
  };

  try {
    const server = startDevtoolsServer({
      application: new Elysia(),
      port: blocker.port,
      logger,
    });

    expect(server).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`http://127.0.0.1:${blocker.port}`);
    expect(warnings[0]).not.toContain("\n");
  } finally {
    await blocker.stop(true);
  }
});

test("the Elysia release resolves from the directory a running package sees", () => {
  expect(resolveElysiaVersion(join(import.meta.dir, "..", "src", "server"))).toBe(
    installedElysiaVersion,
  );
});

/**
 * A throwaway project, optionally with a stub `elysia` manifest installed in its
 * own `node_modules`, so a case can state what the resolver reads. A directory
 * with its own `package.json` resolves that directory's `node_modules` rather
 * than a copy Bun has cached elsewhere.
 */
function createStubProject(elysiaManifest?: string): {
  readonly directory: string;
  readonly remove: () => void;
} {
  const directory = mkdtempSync(join(tmpdir(), "aponia-devtools-"));

  writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "stub-project" }));

  if (elysiaManifest !== undefined) {
    mkdirSync(join(directory, "node_modules", "elysia"), { recursive: true });
    writeFileSync(join(directory, "node_modules", "elysia", "package.json"), elysiaManifest);
  }

  return { directory, remove: () => rmSync(directory, { recursive: true, force: true }) };
}

test("a project that never installed Elysia reports no version, whatever the machine has cached", () => {
  const project = createStubProject();

  try {
    // The trap this pins: `Bun.resolveSync` falls back to Bun's global install
    // cache, so it can answer for a directory tree that installed nothing —
    // reporting a release the application never ran against. The resolver reads
    // only a `node_modules` at or above the directory, so the answer here does
    // not depend on what this machine happens to have cached.
    expect(resolveElysiaVersion(project.directory)).toBeNull();
  } finally {
    project.remove();
  }
});

test("a manifest that carries no version resolves to nothing rather than to an empty string", () => {
  const project = createStubProject(JSON.stringify({ name: "elysia" }));

  try {
    expect(resolveElysiaVersion(project.directory)).toBeNull();
  } finally {
    project.remove();
  }
});

test("a manifest that cannot be read resolves to nothing rather than throwing", () => {
  const project = createStubProject("{ not json");

  try {
    expect(resolveElysiaVersion(project.directory)).toBeNull();
  } finally {
    project.remove();
  }
});
