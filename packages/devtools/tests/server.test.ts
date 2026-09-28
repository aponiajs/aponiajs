import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Module, defineModule, type LoggerService, type ModuleDefinition } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";
import {
  aponiaVersion,
  devtoolsContractVersion,
  devtoolsPathPrefix,
  resolveElysiaVersion,
  routeRequest,
  type AponiaMetaPayload,
  type DevtoolsHandlers,
} from "../src/index.ts";
// The handler record the mounted route answers through, from the module that owns
// it rather than the barrel: the surface is a route an application mounts, and
// this is the pair that route calls.
import { createHandlers } from "../src/server/devtools-server.ts";

/**
 * The dispatcher, the `/meta` record, and the Elysia resolver.
 *
 * There is no server in this package and no socket behind it, so nothing here
 * binds a port: the dispatcher is called directly and the record it dispatches
 * into is built in process for the application a case booted. The mount itself —
 * that the application answers these paths on its own address, and that the
 * `404` and `405` reach a client through it — is pinned over `application.handle`
 * in `devtools-module.test.ts`.
 *
 * What is left here is the two halves a mount could not show cheaply: the
 * dispatcher's own decisions, which are `405` and `404` before a route exists to
 * carry them, and the release the installed Elysia states, which is read from
 * the tree rather than from a boot.
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

/**
 * One devtools path answered for one application.
 *
 * A case that polls twice through one record passes the record it built, because
 * a case that built a second one would be asking a different boot: the payload
 * a request describes is settled when the record is.
 */
async function ask(
  application: Elysia,
  path: string,
  handlers?: DevtoolsHandlers,
): Promise<Response> {
  return await routeRequest(
    new Request(`http://localhost${devtoolsPathPrefix}${path}`),
    handlers ?? createHandlers(application, undefined, undefined, silentLogger),
  );
}

async function readMeta(
  application: Elysia,
  handlers?: DevtoolsHandlers,
): Promise<AponiaMetaPayload> {
  const response = await ask(application, "/meta", handlers);

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

  // The method decides before the path is read, so a path this surface does not
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

test("meta carries the contract version and the release it speaks", async () => {
  const application = await AponiaFactory.createNative(DevtoolsServerFixtureModule, {
    logger: false,
  });

  const handlers = createHandlers(application, undefined, undefined, silentLogger);
  const response = await ask(application, "/meta", handlers);

  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.headers.get("cache-control")).toBe("no-store");

  const meta = (await response.json()) as AponiaMetaPayload;

  expect(meta).toEqual({
    contract: devtoolsContractVersion,
    framework: aponiaVersion,
    elysia: installedElysiaVersion,
    artifacts: { invokers: null, descriptors: null },
    startedAt: expect.any(String),
  });
  expect(meta.startedAt).toBe(new Date(meta.startedAt).toISOString());

  // The payload is built once and shared by every request, so a second read
  // through the same record reports the same boot rather than the moment it was
  // asked.
  expect(await readMeta(application, handlers)).toEqual(meta);
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

  const meta = await readMeta(application);

  expect(meta.framework).toBe(aponiaVersion);
  expect(meta.artifacts).toEqual({ invokers: aponiaVersion, descriptors: aponiaVersion });
});

test("meta reports no stamp for a descriptor the caller wrote by hand", async () => {
  // The graph is declared data, and no build emitted it: the record's stamps are
  // the artifact's own release, so a hand-written descriptor reports `null`
  // rather than the release that happens to be serving the report.
  const application = await AponiaFactory.createNative(declaredFixtureModule, { logger: false });

  const meta = await readMeta(application);

  expect(meta.framework).toBe(aponiaVersion);
  expect(meta.artifacts).toEqual({ invokers: null, descriptors: null });
});

test("meta falls back to the release serving it when no boot produced the application", async () => {
  const meta = await readMeta(new Elysia());

  expect(meta.framework).toBe(aponiaVersion);
  expect(meta.artifacts).toEqual({ invokers: null, descriptors: null });
});

test("a record from a copy of the platform older than the artifact stamps answers null", async () => {
  // The record is read through a registry-global symbol key, so a boot run by an
  // older copy of `@aponiajs/platform-elysia` in this process is reachable from
  // here — and that copy's record has no `artifacts` at all. This attaches the
  // record the way an older bootstrap did. The handler record is built on the
  // request path, where a throw is that request's failure, so the read has to
  // answer `null`, the way it does for an artifact the boot did not adopt,
  // rather than fail the surface that reads it.
  const application = new Elysia();
  Object.defineProperty(application, Symbol.for("aponia.application.diagnostics"), {
    value: {
      framework: "0.0.0-older",
      graph: "decorated",
      invokers: { accepted: false, reason: undefined },
    },
    enumerable: false,
  });

  const meta = await readMeta(application);

  expect(meta.framework).toBe("0.0.0-older");
  expect(meta.artifacts).toEqual({ invokers: null, descriptors: null });
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
