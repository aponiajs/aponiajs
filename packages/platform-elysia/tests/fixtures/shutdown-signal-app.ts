import { writeFileSync } from "node:fs";
import { defineModule, provideClass } from "@aponiajs/common";
import { AponiaFactory } from "../../src/index.ts";

/**
 * The application a stop-signal case ships a real `SIGTERM` to.
 *
 * No in-process case can reach the real target: this installer defaults to
 * `process`, and a test that sent its own runner a signal would take the runner
 * down with it. So the one property only a real process can state is stated
 * here — that the process answers the signal, finishes its teardown, and only
 * then ends.
 *
 * The evidence is a file rather than a log line, because a line on a piped
 * stream is not guaranteed to be flushed before the process re-raises the
 * signal that ends it: the write below happens synchronously at the end of the
 * teardown, which is before the re-raise by construction. The parent reads the
 * file and the exit status together, and neither alone is the answer — a
 * process that ignored the signal would leave no file, and one that called
 * `exit` would leave a status of its own rather than the signal's.
 *
 * Descriptors rather than decorators throughout, so the fixture depends on
 * nothing a working directory's `tsconfig.json` has to enable.
 */

/**
 * Where the fixture writes its evidence, which the parent reads after the exit.
 *
 * Read once, through a function, so the value every hook captures is the string
 * rather than the environment entry: a hook that re-read `Bun.env` would depend
 * on an environment nothing can change, and the check below would have to be
 * restated at each use.
 */
function requireMarkerPath(): string {
  const path = Bun.env.APONIA_SHUTDOWN_MARKER;
  if (path === undefined) {
    throw new Error("The shutdown-signal fixture needs APONIA_SHUTDOWN_MARKER.");
  }

  return path;
}

const markerPath = requireMarkerPath();

/** Which hooks ran, in the order they ran, written once the teardown ends. */
const steps: string[] = [];

class FixtureSampler {
  beforeApplicationShutdown(): void {
    steps.push("beforeApplicationShutdown");
  }

  async onApplicationShutdown(): Promise<void> {
    // Awaited work on purpose: the re-raise has to wait for a hook that returns
    // a promise, which is what makes this a teardown that finished rather than
    // one that was merely started.
    await Promise.resolve();
    steps.push("onApplicationShutdown");
    writeFileSync(markerPath, steps.join("\n"));
  }
}

/**
 * A hook that throws, so the parent can assert that the failure neither stops
 * the remaining hooks nor prevents the exit. It is declared first, which is the
 * order the container hands the hooks over in.
 */
class FixtureRefuser {
  onApplicationShutdown(): void {
    throw new Error("The shutdown fixture refused to stop.");
  }
}

const rootModule = defineModule({
  id: "ShutdownSignalFixture",
  providers: [provideClass(FixtureRefuser, []), provideClass(FixtureSampler, [])],
});

const application = await AponiaFactory.create(rootModule, { logger: false });
await application.listen(0, { shutdownSignals: true });

process.kill(process.pid, "SIGTERM");
