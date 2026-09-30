import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineModule, type LoggerService } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "../src/index.ts";
import {
  installShutdownSignalHandlers,
  type ShutdownSignal,
  type ShutdownSignalTarget,
} from "../src/application/shutdown-signals.ts";

/**
 * What one case observed of the installer it gave a target to.
 *
 * The seam exists because the installer's real target is `process`: a case that
 * emitted a real `SIGTERM` would take the test runner down with the application,
 * and the properties that matter here — that a repeat signal is no longer
 * answered, that the process is not ended before the teardown finishes — are
 * only observable in what the installer asked the target to do.
 */
interface SignalTargetProbe {
  readonly target: ShutdownSignalTarget;
  readonly kills: { readonly pid: number; readonly signal: ShutdownSignal }[];
  listenerCount(signal: ShutdownSignal): number;
  emit(signal: ShutdownSignal): void;
}

function createSignalTarget(): SignalTargetProbe {
  const listeners = new Map<ShutdownSignal, Set<() => void>>([
    ["SIGTERM", new Set()],
    ["SIGINT", new Set()],
  ]);
  const kills: { readonly pid: number; readonly signal: ShutdownSignal }[] = [];

  const target: ShutdownSignalTarget = {
    pid: 4321,
    on(signal, listener) {
      listeners.get(signal)?.add(listener);
    },
    off(signal, listener) {
      listeners.get(signal)?.delete(listener);
    },
    kill(pid, signal) {
      kills.push({ pid, signal });
    },
  };

  return {
    target,
    kills,
    listenerCount: (signal) => listeners.get(signal)?.size ?? 0,
    emit: (signal) => {
      const answering = listeners.get(signal);
      if (!answering) {
        return;
      }
      // Copied, because the installer removes its listeners while it answers.
      for (const listener of Array.from(answering)) {
        listener();
      }
    },
  };
}

/**
 * Lets every promise the installer is already holding run to completion.
 *
 * A macrotask boundary rather than a delay: what the teardown's continuation
 * needs is a turn of the event loop, not elapsed time, so this stays exact
 * however fast or slow the machine is.
 */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * A logger a case can read the platform's reported failures from, which
 * `logger: false` leaves nowhere to go.
 */
class FailureRecorder implements LoggerService {
  readonly failures: { readonly failure: unknown; readonly context: unknown }[] = [];

  log(): void {}

  fatal(): void {}

  warn(): void {}

  error(failure: unknown, context?: unknown): void {
    this.failures.push({ failure, context });
  }
}

/**
 * The listeners the real process carried before any case here ran, and the way
 * one puts them back.
 *
 * Two cases below are the only ones in this file that reach the real target, and
 * a listener left behind would answer a signal for every other file in the lane.
 */
const stopSignals = ["SIGTERM", "SIGINT"] as const;

function captureProcessListeners(): { SIGTERM: readonly Function[]; SIGINT: readonly Function[] } {
  return {
    SIGTERM: process.listeners("SIGTERM"),
    SIGINT: process.listeners("SIGINT"),
  };
}

function restoreProcessListeners(captured: ReturnType<typeof captureProcessListeners>): void {
  for (const signal of stopSignals) {
    const before = captured[signal];
    for (const listener of process.listeners(signal)) {
      if (!before.includes(listener)) {
        process.off(signal, listener as () => void);
      }
    }
  }
}

describe("installing the shutdown signal handlers", () => {
  test("asks for both stop signals and nothing else", () => {
    const probe = createSignalTarget();

    installShutdownSignalHandlers(() => Promise.resolve(), undefined, probe.target);

    expect(probe.listenerCount("SIGTERM")).toBe(1);
    expect(probe.listenerCount("SIGINT")).toBe(1);
    expect(probe.kills).toEqual([]);
  });

  test("runs the teardown on SIGTERM and re-raises the signal only once it finished", async () => {
    const probe = createSignalTarget();
    let started = 0;
    let finishTeardown!: () => void;
    const teardownFinished = new Promise<void>((resolve) => {
      finishTeardown = resolve;
    });
    installShutdownSignalHandlers(
      () => {
        started += 1;
        return teardownFinished;
      },
      undefined,
      probe.target,
    );

    probe.emit("SIGTERM");

    expect(started).toBe(1);
    // The teardown is only started at this point, and the process may not end
    // before it finishes: that gap is the whole difference between a graceful
    // stop and a stop that merely begins.
    expect(probe.kills).toEqual([]);

    finishTeardown();
    await settle();

    expect(probe.kills).toEqual([{ pid: probe.target.pid, signal: "SIGTERM" }]);
  });

  test("answers SIGINT with the same teardown and re-raises SIGINT", async () => {
    const probe = createSignalTarget();
    let stopped = 0;
    installShutdownSignalHandlers(
      () => {
        stopped += 1;
        return Promise.resolve();
      },
      undefined,
      probe.target,
    );

    probe.emit("SIGINT");
    await settle();

    expect(stopped).toBe(1);
    // The signal that arrives is the signal that is re-raised: a handler that
    // answered SIGINT with SIGTERM would report a stop request nobody made.
    expect(probe.kills).toEqual([{ pid: probe.target.pid, signal: "SIGINT" }]);
  });

  test("gives the signal back to the runtime as soon as the first one arrives", async () => {
    const probe = createSignalTarget();
    let stopped = 0;
    installShutdownSignalHandlers(
      () => {
        stopped += 1;
        return Promise.resolve();
      },
      undefined,
      probe.target,
    );

    probe.emit("SIGTERM");

    // Removed synchronously, so a repeat reaches the runtime's default action
    // and ends the process at once — the escape hatch a teardown that never
    // returns would otherwise take away.
    expect(probe.listenerCount("SIGTERM")).toBe(0);
    expect(probe.listenerCount("SIGINT")).toBe(0);

    probe.emit("SIGTERM");
    probe.emit("SIGINT");
    await settle();

    expect(stopped).toBe(1);
    expect(probe.kills).toEqual([{ pid: probe.target.pid, signal: "SIGTERM" }]);
  });

  test("reports a teardown that threw and still ends the process", async () => {
    const probe = createSignalTarget();
    const logger = new FailureRecorder();
    const failure = new Error("the teardown refused to stop");
    installShutdownSignalHandlers(() => Promise.reject(failure), logger, probe.target);

    probe.emit("SIGTERM");
    await settle();

    expect(logger.failures).toEqual([{ failure, context: "AponiaApplication" }]);
    // Reported rather than swallowed, and the exit happens anyway: a shutdown
    // path may not become a call that cannot complete.
    expect(probe.kills).toEqual([{ pid: probe.target.pid, signal: "SIGTERM" }]);
  });
});

describe("an application and the process's stop signals", () => {
  let application: AponiaApplication | undefined;
  const captured = captureProcessListeners();

  afterEach(async () => {
    await application?.close();
    application = undefined;
    restoreProcessListeners(captured);
  });

  test("installs nothing at all when the application does not ask", async () => {
    application = await AponiaFactory.create(defineModule({ id: "SignalDefaultModule" }), {
      logger: false,
    });

    await application.listen(0);

    // The compatibility case: an application that already listens keeps the
    // process's signals exactly as it found them.
    expect(process.listeners("SIGTERM")).toHaveLength(captured.SIGTERM.length);
    expect(process.listeners("SIGINT")).toHaveLength(captured.SIGINT.length);
  });

  test("installs nothing when the application asks not to", async () => {
    application = await AponiaFactory.create(defineModule({ id: "SignalRefusalModule" }), {
      logger: false,
    });

    await application.listen(0, { shutdownSignals: false });

    expect(process.listeners("SIGTERM")).toHaveLength(captured.SIGTERM.length);
    expect(process.listeners("SIGINT")).toHaveLength(captured.SIGINT.length);
  });

  test("owns the stop signals when it asks for them", async () => {
    application = await AponiaFactory.create(defineModule({ id: "SignalOwnerModule" }), {
      logger: false,
    });

    await application.listen(0, { shutdownSignals: true });

    expect(process.listeners("SIGTERM")).toHaveLength(captured.SIGTERM.length + 1);
    expect(process.listeners("SIGINT")).toHaveLength(captured.SIGINT.length + 1);
  });

  test("keeps one set of listeners across a stop and a second listen", async () => {
    application = await AponiaFactory.create(defineModule({ id: "SignalRestartModule" }), {
      logger: false,
    });

    await application.listen(0, { shutdownSignals: true });
    await application.close();
    await application.listen(0, { shutdownSignals: true });

    // A second set would each run the teardown once and then re-raise a signal
    // the other had already answered.
    expect(process.listeners("SIGTERM")).toHaveLength(captured.SIGTERM.length + 1);
    expect(process.listeners("SIGINT")).toHaveLength(captured.SIGINT.length + 1);
  });
});

describe("a real process that receives a real signal", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  test("finishes its teardown, past a hook that throws, before the signal ends it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aponia-shutdown-"));
    temporaryDirectories.push(directory);
    const markerPath = join(directory, "shutdown.steps");

    // The fixture declares a hook that throws ahead of the one that records, so
    // the file exists only if the failing hook neither stopped the remaining
    // ones nor prevented the exit.
    const child = Bun.spawnSync({
      cmd: [process.execPath, join(import.meta.dir, "fixtures", "shutdown-signal-app.ts")],
      cwd: import.meta.dir,
      env: { ...Bun.env, APONIA_SHUTDOWN_MARKER: markerPath },
      stdout: "pipe",
      stderr: "pipe",
    });

    // Three facts, and none of them alone is the answer: the hooks ran in the
    // order the platform documents them in and wrote their evidence, and the
    // process then ended by the signal rather than through an exit call of its
    // own. A process that ignored the signal would leave no file, one that ended
    // before the teardown finished would leave an empty one, and one that
    // answered with `process.exit` would report an exit code instead.
    expect(await readFile(markerPath, "utf8")).toBe(
      "beforeApplicationShutdown\nonApplicationShutdown",
    );
    expect(child.signalCode).toBe("SIGTERM");
    expect(child.exitCode).toBeNull();
  });
});
