import { expect, test } from "bun:test";
import { Module, defineModule, type LoggerService, type ModuleDefinition } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import {
  aponiaVersion,
  devtoolsContractVersion,
  devtoolsPathPrefix,
  handleDevtoolsRequest,
  type AponiaMetaPayload,
  type DevtoolsHandlers,
} from "../index.ts";
// The handler record the mounted route answers through, from the module that owns
// it rather than the barrel: the surface is a route an application mounts, and
// this is the pair that route calls.
import { handlersOf } from "../../test/support/boot.ts";
import { isDevtoolsSurfaceRequest } from "./request-router.ts";

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
 * What is left here is the dispatcher's own decisions, which are `405` and
 * `404` before a route exists to carry them.
 */

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
  application: unknown,
  path: string,
  handlers?: DevtoolsHandlers,
): Promise<Response> {
  return await handleDevtoolsRequest(
    new Request(`http://localhost${devtoolsPathPrefix}${path}`),
    handlers ?? handlersOf(application, undefined, undefined, silentLogger),
  );
}

async function readMeta(
  application: unknown,
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

  const inside = await handleDevtoolsRequest(
    new Request("http://127.0.0.1:1/__devtools/meta", { method: "POST" }),
    handlers,
  );
  expect(inside.status).toBe(405);
  expect(inside.headers.get("allow")).toBe("GET");

  // The method decides before the path is read, so a path this surface does not
  // own answers 405 rather than 404.
  const outside = await handleDevtoolsRequest(
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
    const response = await handleDevtoolsRequest(
      new Request(`http://127.0.0.1:1${path}`),
      handlers,
    );
    expect(response.status).toBe(404);
  }
});

test("the dispatcher hands the request to the handler it found, answer untouched", async () => {
  const handlers: DevtoolsHandlers = {
    "/meta": (request) => Response.json(new URL(request.url).search),
    "/teapot": () => new Response("short and stout", { status: 418 }),
  };

  const searched = await handleDevtoolsRequest(
    new Request("http://127.0.0.1:1/__devtools/meta?verbose=1"),
    handlers,
  );
  expect(await searched.json()).toBe("?verbose=1");

  const teapot = await handleDevtoolsRequest(
    new Request("http://127.0.0.1:1/__devtools/teapot"),
    handlers,
  );
  expect(teapot.status).toBe(418);
});

test("meta carries the contract version and the release it speaks", async () => {
  const application = await AponiaFactory.createNative(DevtoolsServerFixtureModule, {
    logger: false,
  });

  const handlers = handlersOf(application, undefined, undefined, silentLogger);
  const response = await ask(application, "/meta", handlers);

  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.headers.get("cache-control")).toBe("no-store");

  const meta = (await response.json()) as AponiaMetaPayload;

  expect(meta).toEqual({
    contract: devtoolsContractVersion,
    framework: aponiaVersion,
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
    invokers: { framework: aponiaVersion, elysia: "2.0.0-rc.4", invokers: new Map() },
    descriptors: {
      framework: aponiaVersion,
      elysia: "2.0.0-rc.4",
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
  const meta = await readMeta(undefined);

  expect(meta.framework).toBe(aponiaVersion);
  expect(meta.artifacts).toEqual({ invokers: null, descriptors: null });
});

test("a request URL this platform cannot parse is not the surface's own", () => {
  const request = new Request("http://localhost/__devtools/meta");
  Object.defineProperty(request, "url", { value: "/__devtools/meta" });

  // A URL the check is not sure of stays recorded rather than dropped, which is
  // the safe direction for the one decision this answer makes.
  expect(isDevtoolsSurfaceRequest(request)).toBe(false);
});

test("a URL under the prefix is the surface's own, with or without a suffix", () => {
  expect(isDevtoolsSurfaceRequest(new Request("http://localhost/__devtools"))).toBe(true);
  expect(isDevtoolsSurfaceRequest(new Request("http://localhost/__devtools/flow"))).toBe(true);
  expect(isDevtoolsSurfaceRequest(new Request("http://localhost/__devtoolsx/flow"))).toBe(false);
});
