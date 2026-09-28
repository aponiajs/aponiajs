import { expect, spyOn, test } from "bun:test";
import { Controller, Get, Logger, Module, type LoggerService } from "@aponiajs/common";
import { AponiaFactory, type AponiaElysiaApplication } from "@aponiajs/platform-elysia";
import {
  devtoolsContractVersion,
  devtoolsPlugin,
  type AponiaLogsPayload,
  type AponiaMetaPayload,
  type AponiaRequestsPayload,
  type RequestRecord,
} from "../src/index.ts";

/**
 * The second spelling of the opt-in: `devtoolsPlugin` mounted through
 * `AponiaFactory.create`'s `plugins` option.
 *
 * The module path's own cases live in `devtools-module.test.ts`, and this file
 * is its counterpart rather than its copy. What it has to pin is that the two
 * spellings mount the same thing — the option path boots where a module's
 * `imports` cannot be written, and a surface that answered differently there
 * would be two devtools rather than one with two doors. The cases below
 * therefore assert the option path through `application.handle`, the way a
 * client meets the surface wherever it was mounted: there is no socket in this
 * package any more, and the surface answers on the application's own address.
 *
 * The one difference the option path is allowed is the one it exists for: the
 * plugin is not an `imports` entry, so a build's lowering never sees it. That is
 * `aponia build`'s rule rather than this package's, which is why nothing here
 * asserts it.
 */

@Controller("health")
class HealthController {
  @Get("ping")
  ping(): string {
    return "pong";
  }
}

/** The root a case booted through the option, with nothing else on it. */
@Module({ controllers: [HealthController] })
class PluginOptionsModule {}

const reportLogger = new Logger("PluginOptions", { timestamp: false });

/**
 * Silences the framework logger, which writes to `process.stdout`, for the one
 * case that hands a real logger over: the boot's own lines are what that case is
 * about, and it reads them back out of `/logs` rather than off the console.
 */
function captureOutput(): () => void {
  const write = spyOn(process.stdout, "write").mockImplementation(() => true);

  return () => write.mockRestore();
}

async function ask(application: AponiaElysiaApplication, path: string): Promise<Response> {
  return await application.handle(new Request(`http://localhost${path}`));
}

async function readRequests(application: AponiaElysiaApplication): Promise<AponiaRequestsPayload> {
  await Bun.sleep(0);

  const response = await ask(application, "/__devtools/requests");

  expect(response.status).toBe(200);

  return (await response.json()) as AponiaRequestsPayload;
}

/**
 * The recorded answer a case is about, polled rather than read once: the record
 * writes a request twice — once when it arrives and once when it is answered —
 * and the completion lands in the after-response phase, which the installed
 * Elysia schedules on a later macrotask. The poll is bounded and its failure
 * names the whole window, so a record that never fills is a failure rather than a
 * wait.
 *
 * The poll waits for an answered entry — one whose `status` is not `null` —
 * because the pending entry matches the same `path` and `url` and is in the
 * record before the answer is, so a poll that accepted it would resolve on the
 * very first read and hand the case a `null` status.
 */
async function waitForEntry(
  application: AponiaElysiaApplication,
  match: (record: RequestRecord) => boolean,
): Promise<RequestRecord> {
  let seen: readonly RequestRecord[] = [];

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const payload = await readRequests(application);
    seen = payload.entries;

    const entry = payload.entries.find((record) => record.status !== null && match(record));
    if (entry !== undefined) {
      return entry;
    }

    await Bun.sleep(5);
  }

  throw new Error(`the record holds no such entry: ${JSON.stringify(seen)}`);
}

/**
 * The `log` a logger answers with, read as data rather than referenced as a
 * method: this package patches that property in place, so its identity before
 * and after a registration is what tells a logger the devtools touched from one
 * it left alone.
 */
function loggedMethod(logger: LoggerService): unknown {
  return Object.getOwnPropertyDescriptor(logger, "log")?.value;
}

test("the factory answers undefined when disabled and a plugin when enabled", () => {
  const disabled = devtoolsPlugin({ enabled: false });

  // Not an inert plugin: a boot must not be able to mistake a disabled
  // registration for an enabled one, and the platform's contract for "mount
  // nothing" on this path is the `undefined` entry.
  expect(disabled).toBeUndefined();

  const enabled = devtoolsPlugin({ enabled: true });

  expect(enabled).toBeDefined();
});

test.serial("the option path mounts the surface the module path mounts", async () => {
  const application = await AponiaFactory.create(PluginOptionsModule, {
    logger: false,
    plugins: [devtoolsPlugin({ enabled: true })],
  });

  try {
    // The surface answers on the application's own address, because it is a route
    // the application mounts rather than a server of its own: no `listen()`, and
    // the same `/meta` the module path serves.
    const meta = (await (await ask(application, "/__devtools/meta")).json()) as AponiaMetaPayload;

    expect(meta.contract).toBe(devtoolsContractVersion);

    // The application answers its own routes beside the surface, and the
    // request-capture pair reaches them: the plugin's after-response hook is
    // declared global, so a route it does not own is recorded like any other.
    const response = await ask(application, "/health/ping");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("pong");

    const entry = await waitForEntry(application, (record) => record.path === "/health/ping");

    expect(entry.method).toBe("GET");
    expect(entry.status).toBe(200);
  } finally {
    await application.close();
  }
});

test.serial("the option path's stream records the lines the boot wrote", async () => {
  const restoreOutput = captureOutput();
  const untapped = loggedMethod(reportLogger);

  try {
    const application = await AponiaFactory.create(PluginOptionsModule, {
      logger: reportLogger,
      plugins: [devtoolsPlugin({ enabled: true, logger: reportLogger })],
    });

    try {
      // The stream is built when the plugin is constructed, which is before the
      // application is, so the object the application hands the factory is already
      // the tapped one by the time the boot's first line is written. That is the
      // whole reason the tap belongs to the registration rather than to a hook,
      // and the identity of the method is what says it was patched in place: a
      // wrapper would be a logger the framework never writes to.
      expect(loggedMethod(reportLogger)).not.toBe(untapped);

      const logs = (await (await ask(application, "/__devtools/logs")).json()) as AponiaLogsPayload;
      const contexts = logs.entries.map((item) => item.context);

      expect(contexts).toContain("AponiaFactory");
      expect(contexts).toContain("InstanceLoader");
    } finally {
      await application.close();
    }
  } finally {
    restoreOutput();
  }
});

test.serial("a disabled option path mounts nothing and leaves its logger alone", async () => {
  const logger: LoggerService = {
    log: () => {},
    fatal: () => {},
    error: () => {},
    warn: () => {},
  };
  const untouched = loggedMethod(logger);
  const application = await AponiaFactory.create(PluginOptionsModule, {
    logger: false,
    plugins: [devtoolsPlugin({ enabled: false, logger })],
  });

  try {
    // The application is unaffected: it answers its own route, and the surface
    // was not mounted at all, so the prefix it would have claimed answers `404`
    // the way any unowned path does.
    const response = await ask(application, "/health/ping");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("pong");
    expect((await ask(application, "/__devtools/meta")).status).toBe(404);

    // And the logger the registration named is left exactly as it was: an
    // enabled registration patches it in place, which the case above pins from
    // the other side, so this identity is the difference between the two.
    expect(loggedMethod(logger)).toBe(untouched);
  } finally {
    await application.close();
  }
});
