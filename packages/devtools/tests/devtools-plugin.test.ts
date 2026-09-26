import { expect, spyOn, test } from "bun:test";
import { Controller, Get, Logger, Module, type LoggerService } from "@aponiajs/common";
import { AponiaFactory, type AponiaElysiaApplication } from "@aponiajs/platform-elysia";
import {
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
 * therefore assert the option path over HTTP, the way the socket is asserted
 * everywhere in this package: port `0`, the address read back out of the report
 * the socket published, and no case depending on a port it guessed.
 *
 * The one difference the option path is allowed is the one it exists for: the
 * plugin is not an `imports` entry, so a build's lowering never sees it. That is
 * `aponia build`'s rule rather than this package's, which is why nothing here
 * asserts it.
 */

const ephemeralPort = 0;

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
 * The loopback address one report names. Reading it back is what keeps a case
 * off a fixed port: the port belongs to the socket, and the report is where the
 * socket published it.
 */
function reportedAddress(output: CapturedOutput, index = 0): string {
  const report = devtoolsReports(output)[index] ?? "";
  const address = /http:\/\/127\.0\.0\.1:\d+/.exec(report)?.[0];

  if (address === undefined) {
    throw new Error(`the devtools report named no loopback address: ${report}`);
  }

  return address;
}

async function readRequests(address: string): Promise<AponiaRequestsPayload> {
  const response = await fetch(`${address}/__devtools/requests`);

  expect(response.status).toBe(200);

  return (await response.json()) as AponiaRequestsPayload;
}

/**
 * The recorded entry a case is about, polled rather than read once: the
 * completion hook writes it in the after-response phase, so a single read would
 * make the case depend on how this machine happened to schedule that hook rather
 * than on what the record holds. The poll is bounded, and its failure names the
 * whole window, so a record that never fills is a failure rather than a wait.
 */
async function waitForEntry(
  address: string,
  match: (record: RequestRecord) => boolean,
): Promise<RequestRecord> {
  let seen: readonly RequestRecord[] = [];

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const payload = await readRequests(address);
    seen = payload.entries;

    const entry = payload.entries.find(match);
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

/** Whether a loopback address still answers; a stopped socket refuses. */
async function answers(address: string): Promise<boolean> {
  try {
    await fetch(`${address}/__devtools/meta`);
    return true;
  } catch {
    return false;
  }
}

test("the factory answers undefined when disabled and a plugin when enabled", () => {
  const disabled = devtoolsPlugin({ enabled: false });

  // Not an inert plugin: a boot must not be able to mistake a disabled
  // registration for an enabled one, and the platform's contract for "mount
  // nothing" on this path is the `undefined` entry.
  expect(disabled).toBeUndefined();

  const enabled = devtoolsPlugin({ enabled: true, port: ephemeralPort });

  expect(enabled).toBeDefined();
});

test.serial("the option path mounts the surface the module path mounts", async () => {
  const output = captureOutput();
  let application: AponiaElysiaApplication | undefined;
  try {
    application = await AponiaFactory.create(PluginOptionsModule, {
      logger: false,
      plugins: [devtoolsPlugin({ enabled: true, port: ephemeralPort })],
    });
    await application.listen(0);

    // One report, exactly as the module path writes: the plugin starts the same
    // server at the same moment, so the address read back is the one a client
    // and the endpoint that serves it meet on.
    const reports = devtoolsReports(output);
    expect(reports).toHaveLength(1);

    const address = reportedAddress(output);
    const meta = (await (await fetch(`${address}/__devtools/meta`)).json()) as AponiaMetaPayload;

    expect(meta.contract).toBe(1);

    // The application answers its own routes beside the surface, and the
    // request-capture pair reaches them: the plugin's after-response hook is
    // declared global, so a route it does not own is recorded like any other.
    const response = await fetch(`${application.getUrl()}/health/ping`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("pong");

    const entry = await waitForEntry(address, (record) => record.path === "/health/ping");

    expect(entry.method).toBe("GET");
    expect(entry.status).toBe(200);
  } finally {
    await application?.close();
    output.restore();
  }
});

test.serial("the option path's stream records the lines the boot wrote", async () => {
  const output = captureOutput();
  let application: AponiaElysiaApplication | undefined;
  try {
    const untapped = loggedMethod(reportLogger);

    application = await AponiaFactory.create(PluginOptionsModule, {
      logger: reportLogger,
      plugins: [devtoolsPlugin({ enabled: true, port: ephemeralPort, logger: reportLogger })],
    });

    // The stream is built when the factory is called, which is before the
    // application is, so the object the application hands the factory is already
    // the tapped one by the time the boot's first line is written. That is the
    // whole reason the tap belongs to the registration rather than to `onStart`,
    // and the identity of the method is what says it was patched in place: a
    // wrapper would be a logger the framework never writes to.
    expect(loggedMethod(reportLogger)).not.toBe(untapped);

    await application.listen(0);

    const address = reportedAddress(output);
    const logs = (await (await fetch(`${address}/__devtools/logs`)).json()) as AponiaLogsPayload;
    const contexts = logs.entries.map((item) => item.context);

    expect(contexts).toContain("AponiaFactory");
    expect(contexts).toContain("InstanceLoader");
  } finally {
    await application?.close();
    output.restore();
  }
});

test.serial("a disabled option path mounts nothing and leaves its logger alone", async () => {
  const output = captureOutput();
  const logger: LoggerService = {
    log: () => {},
    fatal: () => {},
    error: () => {},
    warn: () => {},
  };
  const untouched = loggedMethod(logger);
  let application: AponiaElysiaApplication | undefined;
  try {
    application = await AponiaFactory.create(PluginOptionsModule, {
      logger: false,
      plugins: [devtoolsPlugin({ enabled: false, port: ephemeralPort, logger })],
    });
    await application.listen(0);

    // The application is unaffected: it answers its own route, and nothing under
    // `Devtools` was reported, so no socket was opened.
    const response = await application.handle(new Request("http://localhost/health/ping"));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("pong");
    expect(devtoolsReports(output)).toEqual([]);

    // And the logger the registration named is left exactly as it was: an
    // enabled registration patches it in place, which the case above pins from
    // the other side, so this identity is the difference between the two.
    expect(loggedMethod(logger)).toBe(untouched);
  } finally {
    await application?.close();
    output.restore();
  }
});

test.serial("the option path's socket stops with the application that mounted it", async () => {
  const output = captureOutput();
  try {
    const application = await AponiaFactory.create(PluginOptionsModule, {
      logger: false,
      plugins: [devtoolsPlugin({ enabled: true, port: ephemeralPort })],
    });
    await application.listen(0);

    const address = reportedAddress(output);

    expect(await answers(address)).toBe(true);

    // The socket is the plugin's, and `onStop` stops it however the plugin was
    // mounted. A devtools server left bound here would hold the port across the
    // next boot and answer for an application that is gone.
    await application.close();

    expect(await answers(address)).toBe(false);
  } finally {
    output.restore();
  }
});
