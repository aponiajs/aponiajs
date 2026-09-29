import { expect, spyOn, test } from "bun:test";
import {
  Controller,
  Get,
  Module,
  type ClassToken,
  type DynamicModule,
  type LoggerService,
} from "@aponiajs/common";
import {
  AponiaFactory,
  type AponiaElysiaApplication,
  type AponiaInvokerArtifact,
} from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";
import {
  DevtoolsModule,
  aponiaVersion,
  devtoolsContractVersion,
  devtoolsPathPrefix,
  devtoolsPlugin,
  type AponiaFlowPayload,
  type AponiaMetaPayload,
  type AponiaRoutesPayload,
} from "../src/index.ts";

@Controller("health")
class HealthController {
  @Get("ping")
  ping(): string {
    return "pong";
  }
}

/**
 * A controller that claims one devtools path.
 *
 * Built per case rather than declared once, because the path is the case's own,
 * and the collision it pins is between one registration and one decorator rather
 * than between two file-level declarations.
 */
function controllerAnswering(path: string): ClassToken<unknown> {
  @Controller()
  class AnsweringController {
    @Get(path)
    answer(): { readonly from: string } {
      return { from: "application" };
    }
  }

  return AnsweringController as ClassToken<unknown>;
}

/** The root one case boots: the registration under test and the routes beside it. */
function rootWith(registration: DynamicModule, controllers: readonly ClassToken<unknown>[] = []) {
  @Module({ imports: [registration], controllers })
  class DevtoolsRootModule {}

  return DevtoolsRootModule;
}

interface BootOptions {
  /** Whether the registration under test is enabled. Default true. */
  readonly enabled?: boolean;
  /** The controllers mounted beside the devtools registration. */
  readonly controllers?: readonly ClassToken<unknown>[];
  /** An invoker artifact to boot with, when a case asserts the boot's stamp. */
  readonly invokers?: AponiaInvokerArtifact;
}

/**
 * Boots one application with the module path's own registration.
 *
 * `handle` is the entrypoint every case below drives, which is the point of the
 * mount: the surface is served by the application, so a case does not need a
 * socket, a port, or a report to learn where to send a request.
 */
async function bootWithDevtools(options: BootOptions = {}): Promise<AponiaElysiaApplication> {
  const registration = DevtoolsModule.register({ enabled: options.enabled ?? true });

  return AponiaFactory.create(rootWith(registration, options.controllers), {
    logger: false,
    ...(options.invokers === undefined ? {} : { invokers: options.invokers }),
  });
}

interface CapturedOutput {
  readonly rows: () => readonly string[];
  readonly restore: () => void;
}

/**
 * The devtools plugin reports through the framework logger, which writes to
 * `process.stdout`. Capturing it here keeps Elysia's own startup banner out of
 * the assertion: only the rows carrying the `Devtools` context are read.
 */
function captureOutput(): CapturedOutput {
  const chunks: string[] = [];
  const write = spyOn(process.stdout, "write").mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });

  return {
    rows: () => chunks.join("").split("\n"),
    restore: () => write.mockRestore(),
  };
}

function devtoolsReports(output: CapturedOutput): readonly string[] {
  return output.rows().filter((row) => row.includes("[Devtools]"));
}

/**
 * A logger that records nothing, for the cases that mount the plugin on an
 * application no boot produced or on one already built: the registration is what
 * those cases are about, and none of them asserts a log line.
 */
const silentLogger: LoggerService = {
  log: () => {},
  fatal: () => {},
  error: () => {},
  warn: () => {},
};

test("register returns an inert module when disabled and a plugin module when enabled", () => {
  const disabled = DevtoolsModule.register({ enabled: false });

  expect(disabled.module).toBe(DevtoolsModule);
  expect(disabled.providers).toEqual([]);
  expect(disabled.imports).toEqual([]);
  expect(Object.isFrozen(disabled)).toBe(true);

  const enabled = DevtoolsModule.register({ enabled: true });

  expect(enabled.id).toBe("ElysiaPluginModule[devtools]");
  expect(enabled.providers).toHaveLength(1);
  expect(Object.isFrozen(enabled)).toBe(true);
});

// The enabled twin below makes the same two observations, and finds both
// present. Absence here is therefore evidence that the plugin did not mount,
// not that the boot logs nothing.
test.serial("a listening disabled application mounts no plugin", async () => {
  const output = captureOutput();
  try {
    const application = await AponiaFactory.create(
      rootWith(DevtoolsModule.register({ enabled: false })),
    );
    await application.listen(0);
    await application.close();

    expect(output.rows().join("")).not.toContain("ElysiaPluginModule[devtools]");
    expect(devtoolsReports(output)).toEqual([]);
  } finally {
    output.restore();
  }
});

test.serial(
  "an enabled module mounts its plugin, which serves the application's own address",
  async () => {
    const output = captureOutput();
    let application: AponiaElysiaApplication | undefined;
    try {
      application = await AponiaFactory.create(
        rootWith(DevtoolsModule.register({ enabled: true }), [HealthController]),
      );
      await application.listen(0);

      expect(output.rows().join("")).toContain(
        "ElysiaPluginModule[devtools] dependencies initialized",
      );

      // One report, written at `onStart`, and it names where the surface is
      // mounted: there is no second socket behind it, so there is no address of
      // its own for the row to publish.
      const reports = devtoolsReports(output);
      expect(reports).toHaveLength(1);
      expect(reports[0]).toContain(devtoolsPathPrefix);

      // The surface answers on the address the application serves, and the
      // application's own routes answer beside it.
      const meta = await fetch(`${application.getUrl()}${devtoolsPathPrefix}/meta`);

      expect(meta.status).toBe(200);
      expect(((await meta.json()) as AponiaMetaPayload).contract).toBe(devtoolsContractVersion);

      const health = await fetch(`${application.getUrl()}/health/ping`);

      expect(health.status).toBe(200);
      expect(await health.text()).toBe("pong");
    } finally {
      // Closing in the `finally` rather than after the last assertion: a failing
      // assertion would otherwise leave the application listening for the rest of
      // the process.
      await application?.close();
      output.restore();
    }
  },
);

test("serves its endpoints on the application's own address", async () => {
  const application = await bootWithDevtools();

  const meta = await application.handle(new Request(`http://localhost${devtoolsPathPrefix}/meta`));

  expect(meta.status).toBe(200);
  expect(await meta.json()).toMatchObject({ contract: devtoolsContractVersion });
});

test("answers 404 for a path it does not own and 405 for a method it does not serve", async () => {
  const application = await bootWithDevtools();

  const unknown = await application.handle(
    new Request(`http://localhost${devtoolsPathPrefix}/nope`),
  );
  const wrongMethod = await application.handle(
    new Request(`http://localhost${devtoolsPathPrefix}/meta`, { method: "POST" }),
  );

  expect(unknown.status).toBe(404);
  expect(wrongMethod.status).toBe(405);
  expect(wrongMethod.headers.get("allow")).toBe("GET");
});

test("an application route that claims a devtools path answers it", async () => {
  const application = await bootWithDevtools({
    controllers: [controllerAnswering(`${devtoolsPathPrefix}/meta`)],
  });

  const response = await application.handle(
    new Request(`http://localhost${devtoolsPathPrefix}/meta`),
  );

  expect(await response.json()).toEqual({ from: "application" });
});

test("a route that claims a devtools path wins even when the plugin mounts last", async () => {
  const application = await AponiaFactory.create(
    rootWith(DevtoolsModule.register({ enabled: false }), [
      controllerAnswering(`${devtoolsPathPrefix}/meta`),
    ]),
    { logger: false },
  );

  try {
    // Mounted after the controller's route is already on the table, which is the
    // order a caller who reaches for `.use()` on the native application produces.
    // The path is decided by specificity rather than by which registration came
    // last: a static route answers here whether it was mounted before or after the
    // wildcard, and the case above pins the other order.
    application.getNativeApplication().use(devtoolsPlugin({ enabled: true, logger: silentLogger }));

    const response = await application.handle(
      new Request(`http://localhost${devtoolsPathPrefix}/meta`),
    );

    expect(await response.json()).toEqual({ from: "application" });

    // The collision costs the surface one path and not the surface: the wildcard
    // is mounted all the same, and the endpoints the application's route does not
    // claim answer behind it.
    const logs = await application.handle(
      new Request(`http://localhost${devtoolsPathPrefix}/logs`),
    );

    expect(logs.status).toBe(200);
  } finally {
    await application.close();
  }
});

test("routes and flow report the surface's own mount", async () => {
  const application = await bootWithDevtools({ controllers: [HealthController] });

  // The mount is a route in the application's own table, so the endpoints that
  // report that table report it. The row is asserted rather than filtered
  // because `/routes` reports what the application answers and never re-derives
  // it: a builder that dropped this row would be reporting an application that
  // does not exist. A devtools-enabled application therefore carries one more
  // route than the same application without devtools, which is the visible price
  // of serving the surface from the application.
  const routes = (await (
    await application.handle(new Request(`http://localhost${devtoolsPathPrefix}/routes`))
  ).json()) as AponiaRoutesPayload;

  const mount = Object.freeze({ method: "*", path: `${devtoolsPathPrefix}/*` });

  expect(routes.routes).toContainEqual(
    expect.objectContaining({ ...mount, module: "", controller: "", handler: "", source: null }),
  );

  // `/flow` reads the same table, so the route is here too. It carries no stages:
  // the plugin's own hooks are declared on the instance rather than on this
  // route, so there is no step for the chain to state.
  const flow = (await (
    await application.handle(new Request(`http://localhost${devtoolsPathPrefix}/flow`))
  ).json()) as AponiaFlowPayload;

  expect(flow.routes.map((route) => route.id)).toContain(`* ${devtoolsPathPrefix}/*`);

  // The application's own route is reported beside it, so the row is an addition
  // rather than a replacement.
  expect(routes.routes).toContainEqual(
    expect.objectContaining({ method: "GET", path: "/health/ping", handler: "ping" }),
  );
});

test("a disabled registration mounts no route at all", async () => {
  const application = await bootWithDevtools({ enabled: false });

  const response = await application.handle(
    new Request(`http://localhost${devtoolsPathPrefix}/meta`),
  );

  expect(response.status).toBe(404);
});

test("an application no boot produced answers the endpoints that need no report", async () => {
  // A bare `Elysia` with the plugin mounted by hand: there is no boot behind it,
  // so nothing published an application on the store this request carries, and
  // no boot opened a request record for it either.
  const application = new Elysia({ name: "HandBuilt" }).use(
    devtoolsPlugin({ enabled: true, logger: silentLogger }),
  );

  const meta = await application.handle(new Request(`http://localhost${devtoolsPathPrefix}/meta`));

  // The documented degraded form: `/meta` answers with this release's own stamp
  // and `null` for every artifact no boot adopted, rather than refusing the
  // request. That is what it answered for an application no boot produced before
  // the surface moved onto the application.
  expect(meta.status).toBe(200);
  expect(await meta.json()).toMatchObject({
    contract: devtoolsContractVersion,
    framework: aponiaVersion,
    artifacts: { invokers: null, descriptors: null },
  });

  // Every endpoint whose fact belongs to a boot, or to the application that boot
  // produced, is not registered for a request that carries neither, so the
  // dispatcher's absence is the answer: not a throw, and not an empty `200`
  // claiming a report there is nothing to build.
  for (const path of ["/graph", "/routes", "/flow", "/aot", "/requests"]) {
    const response = await application.handle(
      new Request(`http://localhost${devtoolsPathPrefix}${path}`),
    );

    expect(response.status).toBe(404);
  }

  // `/logs` is the registration's own fact rather than a boot's — the stream
  // records the logger object the registration was handed — so it is the one
  // endpoint beside `/meta` that still answers.
  const logs = await application.handle(new Request(`http://localhost${devtoolsPathPrefix}/logs`));

  expect(logs.status).toBe(200);
  expect(await logs.json()).toMatchObject({ cursor: 0 });
});

test.serial("the report describes the boot the plugin's own application carries", async () => {
  const acceptedInvokers: AponiaInvokerArtifact = {
    framework: aponiaVersion,
    elysia: null,
    invokers: new Map(),
  };
  const application = await bootWithDevtools({ invokers: acceptedInvokers });

  const meta = (await (
    await application.handle(new Request(`http://localhost${devtoolsPathPrefix}/meta`))
  ).json()) as AponiaMetaPayload;

  // The stamp is read from the record bootstrap attached to the root
  // application: a report that described some other instance would state `null`,
  // which is exactly what the record's absence would prove.
  expect(meta.framework).toBe(aponiaVersion);
  expect(meta.artifacts.invokers).toBe(aponiaVersion);
});

test.serial("an application that only handles requests still answers the surface", async () => {
  const output = captureOutput();
  try {
    const application = await bootWithDevtools();

    const response = await application.handle(
      new Request(`http://localhost${devtoolsPathPrefix}/meta`),
    );

    // `onStart` never fires for an application that never listens, which is the
    // whole reason the surface is mounted rather than started: it answers here
    // all the same.
    expect(response.status).toBe(200);
    expect(() => application.getUrl()).toThrow(
      expect.objectContaining({ code: "APPLICATION_NOT_LISTENING" }),
    );

    // And `onStart` is only where the plugin says where the mount is, so nothing
    // was reported for a boot that did not reach it.
    expect(devtoolsReports(output)).toEqual([]);
  } finally {
    output.restore();
  }
});
