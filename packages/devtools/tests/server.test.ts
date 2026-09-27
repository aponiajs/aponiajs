import { expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Module, defineModule, type LoggerService, type ModuleDefinition } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";
import {
  aponiaVersion,
  devtoolsContractVersion,
  resolveElysiaVersion,
  routeRequest,
  startDevtoolsServer,
  type AponiaMetaPayload,
  type DevtoolsHandlers,
  type DevtoolsServer,
} from "../src/index.ts";
// The boundary itself, from the module that owns it rather than the barrel: it
// is `@internal` and no application calls it, and three of the near-miss
// spellings below bind successfully on this machine, so a socket case would
// prove what the resolver did rather than what the check decided.
import { isLoopbackHost } from "../src/server/devtools-server.ts";

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

/**
 * A logger that keeps what was written through it, so a case can state what a
 * start reported rather than only what it returned.
 */
function recordingLogger(): {
  readonly logger: LoggerService;
  readonly warnings: readonly string[];
} {
  const warnings: string[] = [];
  const logger: LoggerService = {
    log: () => {},
    fatal: () => {},
    error: () => {},
    warn: (message) => {
      warnings.push(String(message));
    },
  };

  return { logger, warnings };
}

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
      contract: devtoolsContractVersion,
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

test("a registration that names no host binds loopback and reports nothing", () => {
  const { logger, warnings } = recordingLogger();
  const server = startDevtoolsServer({ application: new Elysia(), port: 0, logger });

  try {
    expect(server?.url.startsWith("http://127.0.0.1:")).toBe(true);
    expect(warnings).toEqual([]);
  } finally {
    server?.stop();
  }
});

test("the loopback spellings a registration can name report nothing", () => {
  const results: {
    readonly host: string;
    readonly url: string | undefined;
    readonly warnings: readonly string[];
  }[] = [];

  for (const host of ["127.0.0.1", "localhost", "LOCALHOST", "::1"]) {
    const { logger, warnings } = recordingLogger();
    const server = startDevtoolsServer({ application: new Elysia(), host, port: 0, logger });

    try {
      results.push({ host, url: server?.url, warnings });
    } finally {
      server?.stop();
    }
  }

  // The name, its case-insensitive form, and the IPv6 loopback are the
  // spellings the check must accept beside the `127.x.x.x` form; the
  // default case above pins that branch.
  expect(results.map((result) => [result.host, result.warnings])).toEqual([
    ["127.0.0.1", []],
    ["localhost", []],
    ["LOCALHOST", []],
    ["::1", []],
  ]);
  expect(results.every((result) => result.url !== undefined)).toBe(true);
});

test("the loopback check is silent only for the spellings it names and reports every near miss", () => {
  // Silent: the four spellings the option documents, including the root-dot
  // form of the name and an address in `127.0.0.0/8` that is not `.1`.
  const silent = ["127.0.0.1", "127.255.255.254", "localhost", "LOCALHOST", "localhost.", "::1"];

  // Reported. The first three are loopback to a resolver and to the kernel, and
  // the check still reports them: it resolves nothing, so the boundary is the
  // spelling rather than what the spelling means. `localhost\n` is here because
  // a trailing newline is what a copied value carries, and `$` without the `m`
  // flag refuses it — a pattern that grew that flag would go silent for it.
  const reported = [
    "127.1",
    "::ffff:127.0.0.1",
    "0:0:0:0:0:0:0:1",
    "::",
    "0.0.0.0",
    "192.168.1.5",
    "dev.localhost",
    "",
    "localhost\n",
  ];

  // Filtered rather than mapped so a failure names the spelling that moved.
  expect(silent.filter((host) => !isLoopbackHost(host))).toEqual([]);
  expect(reported.filter((host) => isLoopbackHost(host))).toEqual([]);
});

test("a host outside loopback binds it, answers, and reports once what it exposed", async () => {
  const { logger, warnings } = recordingLogger();
  const server = startDevtoolsServer({
    application: new Elysia(),
    host: "0.0.0.0",
    port: 0,
    logger,
  });

  if (server === undefined) {
    throw new Error("the devtools server refused to bind the widened socket");
  }

  try {
    // The socket bound the address the registration named rather than the
    // default...
    expect(server.url.startsWith("http://0.0.0.0:")).toBe(true);

    // ...and it answers: `0.0.0.0` is every interface, loopback included, and
    // the port is read from the address Bun reported rather than guessed.
    const boundPort = new URL(server.url).port;
    const response = await fetch(`http://127.0.0.1:${boundPort}/__devtools/meta`);
    expect(response.status).toBe(200);

    // One row states the address that was bound and what is reachable through
    // it: `/requests` records request headers and bodies by default, so the
    // reader is told what the widening costs rather than that it happened.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("0.0.0.0");
    expect(warnings[0]).toContain("host");
    expect(warnings[0]).toContain("/requests");
    expect(warnings[0]).not.toContain("\n");
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

test("a refusal the logger will not carry is stated on stderr, and the caller still continues", async () => {
  const blocker = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("taken"),
  });
  const logger: LoggerService = {
    log: () => {},
    fatal: () => {},
    error: () => {},
    warn: () => {
      throw new Error("the logger refused the refusal");
    },
  };
  const stderr: string[] = [];
  const stderrWrite = spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });

  try {
    const server = startDevtoolsServer({
      application: new Elysia(),
      port: blocker.port,
      logger,
    });

    // The sentence is the one the logger was handed, on the channel that
    // survived, and it is the whole row: the address the registration could not
    // take is still in it.
    expect(server).toBeUndefined();
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toContain(`http://127.0.0.1:${blocker.port}`);
    expect(stderr[0]).toContain("could not listen");
    expect(stderr[0]).toContain("the application continues without it");
  } finally {
    stderrWrite.mockRestore();
    await blocker.stop(true);
  }
});

test("a refusal stderr refuses too still answers undefined rather than throwing", async () => {
  const blocker = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("taken"),
  });
  const logger: LoggerService = {
    log: () => {},
    fatal: () => {},
    error: () => {},
    warn: () => {
      throw new Error("the logger refused the refusal");
    },
  };
  const stderrWrite = spyOn(process.stderr, "write").mockImplementation(() => {
    throw new Error("the stream refused the refusal");
  });

  try {
    // Both channels refused, and the caller still hears the `undefined` that
    // says the application continues: the direct write is guarded for the
    // reason the logger call is, because a throw out of it would leave neither
    // the row nor that answer — and inside `onStart`, which Elysia does not
    // catch, it would take `listen()` with it.
    const server = startDevtoolsServer({
      application: new Elysia(),
      port: blocker.port,
      logger,
    });

    expect(server).toBeUndefined();
  } finally {
    stderrWrite.mockRestore();
    await blocker.stop(true);
  }
});

test("a host outside loopback that cannot bind reports the refusal and no exposure row", async () => {
  // `::` rather than `::1`: the guarantee this case exists for — a widening
  // that never happened exposes nothing — is only testable with a host the
  // check treats as widen-eligible, and `::1` is one of the silent spellings
  // the sibling case lists. With a loopback host no exposure row could appear
  // however the code was ordered, so the case could not bite.
  const blocker = Bun.serve({ hostname: "::", port: 0, fetch: () => new Response("taken") });
  const { logger, warnings } = recordingLogger();

  try {
    const server = startDevtoolsServer({
      application: new Elysia(),
      host: "::",
      port: blocker.port,
      logger,
    });

    expect(server).toBeUndefined();

    // One row, and it is the refusal. Two things hold that: the exposure row is
    // written only after a bind that succeeded, and the address is the one the
    // registration asked for because no socket exists to report its own. The
    // bracketed form is what a URL needs for an IPv6 host.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`http://[::]:${blocker.port}`);
    expect(warnings[0]).not.toContain("/requests");
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
