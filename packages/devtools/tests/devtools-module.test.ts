import { expect, spyOn, test } from "bun:test";
import { Controller, Get, Module } from "@aponiajs/common";
import {
  AponiaFactory,
  type AponiaElysiaApplication,
  type AponiaInvokerArtifact,
} from "@aponiajs/platform-elysia";
import { DevtoolsModule, aponiaVersion, type AponiaMetaPayload } from "../src/index.ts";

// `0` is the standard "no fixed port" sentinel. The plugin now binds it, and
// every case below reads the address the socket took back out of the report it
// published, so none of them depends on a port it guessed.
const ephemeralPort = 0;

@Controller("health")
class HealthController {
  @Get("ping")
  ping(): string {
    return "pong";
  }
}

@Module({ imports: [DevtoolsModule.register({ enabled: false })] })
class DisabledModule {}

@Module({
  imports: [DevtoolsModule.register({ enabled: true, port: ephemeralPort })],
  controllers: [HealthController],
})
class EnabledModule {}

@Module({ imports: [DevtoolsModule.register({ enabled: true })] })
class DefaultPortModule {}

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
function reportedAddress(report: string): string {
  const address = /http:\/\/127\.0\.0\.1:\d+/.exec(report)?.[0];

  if (address === undefined) {
    throw new Error(`the devtools report named no loopback address: ${report}`);
  }

  return address;
}

/**
 * The port a freshly bound socket took. Bun types a server's port as optional —
 * a unix socket has none — so a case that needs the number states that it read
 * one rather than defaulting it.
 */
function boundPort(server: { readonly port?: number }): number {
  if (server.port === undefined) {
    throw new Error("the blocker bound no port to take");
  }

  return server.port;
}

/**
 * A root module whose devtools port is only known once something has taken it.
 * The registration carries the port, so the decorated module has to be built
 * after the blocker bound its socket.
 */
function devtoolsModuleOn(port: number) {
  @Module({
    imports: [DevtoolsModule.register({ enabled: true, port })],
    controllers: [HealthController],
  })
  class TakenPortModule {}

  return TakenPortModule;
}

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
    const application = await AponiaFactory.create(DisabledModule);
    await application.listen(0);
    await application.close();

    expect(output.rows().join("")).not.toContain("ElysiaPluginModule[devtools]");
    expect(devtoolsReports(output)).toEqual([]);
  } finally {
    output.restore();
  }
});

test.serial("an enabled module mounts its plugin, which serves the address it bound", async () => {
  const output = captureOutput();
  let application: AponiaElysiaApplication | undefined;
  try {
    application = await AponiaFactory.create(EnabledModule);
    await application.listen(0);

    expect(output.rows().join("")).toContain(
      "ElysiaPluginModule[devtools] dependencies initialized",
    );

    const reports = devtoolsReports(output);
    expect(reports).toHaveLength(1);

    // The one report names the port the socket took rather than the sentinel
    // the registration asked for, and that address is what answers for as long
    // as the application that started it is listening.
    const address = reportedAddress(reports[0] ?? "");
    const response = await fetch(`${address}/__devtools/meta`);

    expect(response.status).toBe(200);
    expect(((await response.json()) as AponiaMetaPayload).contract).toBe(1);
  } finally {
    // Closing in the `finally` rather than after the last assertion: a failing
    // assertion would otherwise leave the application and the devtools socket
    // it started listening for the rest of the process.
    await application?.close();
    output.restore();
  }
});

/**
 * Whether a loopback address still answers. A socket that has stopped refuses
 * the connection, which is what `fetch` reports as a rejection.
 */
async function answers(address: string): Promise<boolean> {
  try {
    await fetch(`${address}/__devtools/meta`);
    return true;
  } catch {
    return false;
  }
}

test.serial("a second listen replaces the devtools socket instead of losing it", async () => {
  const output = captureOutput();
  let application: AponiaElysiaApplication | undefined;
  try {
    application = await AponiaFactory.create(EnabledModule);
    await application.listen(0);

    const firstAddress = reportedAddress(devtoolsReports(output)[0] ?? "");

    // A second `listen()` re-runs the plugin's `onStart` with the first socket
    // still held, which is already broken at the application level. What the
    // plugin must not add to that is a socket nothing can stop: the one it
    // replaces is stopped as it is replaced, and the handle names the one it
    // holds, which is what `close()` stops. A handle overwritten by a start
    // that failed — or by a second socket — is the leak this pins.
    await application.listen(0);

    expect(await answers(firstAddress)).toBe(false);

    const secondAddress = reportedAddress(devtoolsReports(output)[1] ?? "");
    expect(secondAddress).not.toBe(firstAddress);
    expect(await answers(secondAddress)).toBe(true);
  } finally {
    await application?.close();
    output.restore();
  }
});

test.serial("closing the application stops the devtools socket it started", async () => {
  const output = captureOutput();
  try {
    const application = await AponiaFactory.create(EnabledModule);
    await application.listen(0);

    const address = reportedAddress(devtoolsReports(output)[0] ?? "");

    // The socket answers for as long as the application that started it runs...
    expect(await answers(address)).toBe(true);

    // ...and stops with it. The address is the one the plugin's own socket took,
    // so a server left bound here is the leak this pins: it would hold the port
    // across the next boot and answer for an application that is gone.
    await application.close();

    expect(await answers(address)).toBe(false);
  } finally {
    output.restore();
  }
});

test.serial("an enabled module reports the loopback port it defaults to", async () => {
  const output = captureOutput();
  try {
    const application = await AponiaFactory.create(DefaultPortModule);
    await application.listen(0);
    await application.close();

    const reports = devtoolsReports(output);
    expect(reports).toHaveLength(1);

    // `8000` is the documented default, and this case decides nothing about
    // whether the port is free: a bind that succeeds reports the address it
    // took, and one that is refused reports the address it could not take. The
    // port a real socket serves on is pinned by the ephemeral case instead.
    expect(reports[0]).toContain("127.0.0.1:8000");
  } finally {
    output.restore();
  }
});

test.serial("the report describes the boot the plugin's own application carries", async () => {
  const output = captureOutput();
  let application: AponiaElysiaApplication | undefined;
  try {
    const acceptedInvokers: AponiaInvokerArtifact = {
      framework: aponiaVersion,
      elysia: null,
      invokers: new Map(),
    };

    application = await AponiaFactory.create(EnabledModule, {
      logger: false,
      invokers: acceptedInvokers,
    });
    await application.listen(0);

    const address = reportedAddress(devtoolsReports(output)[0] ?? "");
    const meta = (await (await fetch(`${address}/__devtools/meta`)).json()) as AponiaMetaPayload;

    // The stamp is read from the record bootstrap attached to the root
    // application: a report that described some other instance would state
    // `null`, which is exactly what the record's absence proves.
    expect(meta.framework).toBe(aponiaVersion);
    expect(meta.artifacts.invokers).toBe(aponiaVersion);
  } finally {
    await application?.close();
    output.restore();
  }
});

test.serial("a devtools port that is already bound does not fail the boot", async () => {
  const blocker = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("taken"),
  });
  const output = captureOutput();
  const takenPort = boundPort(blocker);

  try {
    const application = await AponiaFactory.create(devtoolsModuleOn(takenPort));
    await application.listen(0);

    // The application is unaffected: it answers its own routes, and the one
    // Devtools row states the address the devtools socket could not take.
    const response = await application.handle(new Request("http://localhost/health/ping"));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("pong");

    const reports = devtoolsReports(output);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain(`http://127.0.0.1:${takenPort}`);

    // The row says the bind was refused rather than naming an address a
    // placeholder could have echoed back: this is the pair for the ephemeral
    // case above, where the address the row names is the one that answers.
    expect(reports[0]).toContain("could not listen");

    await application.close();
  } finally {
    output.restore();
    await blocker.stop(true);
  }
});

test.serial(
  "an application that only handles requests stays unlistened, so the plugin reports nothing",
  async () => {
    const output = captureOutput();
    try {
      const application = await AponiaFactory.create(EnabledModule, { logger: false });

      const response = await application.handle(new Request("http://localhost/health/ping"));

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("pong");
      expect(() => application.getUrl()).toThrow(
        expect.objectContaining({ code: "APPLICATION_NOT_LISTENING" }),
      );
      expect(devtoolsReports(output)).toEqual([]);
    } finally {
      output.restore();
    }
  },
);
