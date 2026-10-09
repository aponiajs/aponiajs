import { afterEach, expect, test } from "bun:test";
import { aponiaVersion, devtoolsContractVersion } from "@aponiajs/devtools";
import type { DevtoolsApplication } from "./application.ts";
import { createApplication, get, read } from "./application.ts";

let booted: DevtoolsApplication | undefined;

afterEach(async () => {
  await booted?.application.close();
  booted = undefined;
});

test("meta reports the contract and the versions the boot ran", async () => {
  booted = await createApplication();

  const meta = await read<{ contract: number; framework: string; elysia: string | null }>(
    `${booted.devtools}/meta`,
  );

  expect(meta.contract).toBe(devtoolsContractVersion);
  expect(meta.framework).toBe(aponiaVersion);
  // The release the endpoint resolves from the application's own tree, which is
  // the one this workspace installs: the example reports Elysia 2 because that
  // is what it ran against.
  expect(meta.elysia).toStartWith("2.");
});

test("graph reports the module the boot compiled", async () => {
  booted = await createApplication();

  const graph = await read<{
    rootModule: string;
    modules: readonly { id: string; controllers: readonly string[] }[];
  }>(`${booted.devtools}/graph`);

  expect(graph.rootModule).toBe("AppModule");
  expect(graph.modules.flatMap((module) => module.controllers)).toContain("AppController");
});

test("routes reports each mounted route and the binding that serves it", async () => {
  booted = await createApplication();

  const routes = await read<{
    routes: readonly { method: string; path: string; controller: string; source: string }[];
  }>(`${booted.devtools}/routes`);

  expect(routes.routes).toContainEqual(
    expect.objectContaining({
      method: "GET",
      path: "/greetings",
      controller: "AppController",
      source: "compiled",
    }),
  );
});

test("flow reports the stages a route passes through", async () => {
  booted = await createApplication();

  const flow = await read<{ routes: readonly { id: string; stages: readonly { id: string }[] }[] }>(
    `${booted.devtools}/flow`,
  );

  // The id is the route key both `/flow` and `/routes` build: `METHOD path`.
  const route = flow.routes.find((entry) => entry.id === "GET /greetings");
  expect(route).toBeDefined();
  expect(route!.stages.length).toBeGreaterThan(0);
});

test("requests records a request the application answered", async () => {
  booted = await createApplication();

  const response = await get(booted.application, "/greetings");
  expect(response.status).toBe(200);

  const requests = await read<{
    entries: readonly { id: number; method: string; path: string; status: number | null }[];
  }>(`${booted.devtools}/requests`);

  // The case makes one request, and one request writes two entries — the arrival
  // and the answer — so the answer is the last entry.
  const last = requests.entries.at(-1);
  expect(last).toMatchObject({ method: "GET", path: "/greetings", status: 200 });
});

test("logs serves the lines the one logger both places were handed wrote", async () => {
  booted = await createApplication();

  const logs = await read<{
    entries: readonly { level: string; context: string; message: string }[];
  }>(`${booted.devtools}/logs`);

  expect(logs.entries).toContainEqual(
    expect.objectContaining({
      context: "AponiaApplication",
      message: "Aponia application successfully started",
    }),
  );
  // The same object reached the plugin: what the factory wrote is what the
  // endpoint serves. A second logger would leave this list empty.
  expect(booted.logger.lines).toContain("Aponia application successfully started");
});

test("aot answers the boot's own record when no build wrote an analysis", async () => {
  booted = await createApplication();

  const aot = await read<{
    graph: string;
    invokers: { accepted: boolean; reason?: string };
  }>(`${booted.devtools}/aot`);

  expect(aot.graph).toBe("decorated");
  expect(aot.invokers.accepted).toBe(false);
  expect(aot.invokers.reason).toBeTruthy();
});

test("a disabled registration mounts nothing at all", async () => {
  booted = await createApplication(false);

  // The surface is a route on the application, so with nothing registered the
  // application answers its own 404 for the prefix rather than serving it.
  const response = await get(booted.application, "/__devtools/meta");
  expect(response.status).toBe(404);
});
