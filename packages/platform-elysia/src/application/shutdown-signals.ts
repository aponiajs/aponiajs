import type { LoggerService } from "@aponiajs/common";
import { reportThroughLogger } from "../errors/default-exception-filter.ts";

/**
 * The signals a graceful shutdown answers.
 *
 * `SIGTERM` is what a container runtime and an orchestrator send to ask a
 * process to stop, and `SIGINT` is what an interactive terminal sends. Both mean
 * the same thing to this platform, so an application that opts in gets both from
 * one decision.
 */
const shutdownSignals = Object.freeze(["SIGTERM", "SIGINT"] as const);

/**
 * One signal this installer can answer.
 *
 * @internal
 */
export type ShutdownSignal = (typeof shutdownSignals)[number];

/**
 * The process surface the installer reaches through.
 *
 * Structural rather than `typeof process`, so a caller can hand it a double: the
 * only way to prove that a second signal no longer reaches this application is
 * to observe the listeners the installer attached and removed, and a case that
 * sent the test runner a real `SIGTERM` would take the runner down with it. The
 * real target is `process` itself, which the default parameter states.
 *
 * @internal
 */
export interface ShutdownSignalTarget {
  readonly pid: number;
  on(signal: ShutdownSignal, listener: () => void): unknown;
  off(signal: ShutdownSignal, listener: () => void): unknown;
  kill(pid: number, signal: ShutdownSignal): unknown;
}

/**
 * Runs this application's teardown instead of letting the process die abruptly.
 *
 * Installing a listener is the whole mechanism: a process with a listener for
 * `SIGTERM` no longer takes the default action for it, so the teardown below is
 * what a container's stop request reaches.
 *
 * Two properties make the installation safe to leave in place for the life of
 * the process, and both are why the listeners are removed before the signal is
 * re-raised rather than after:
 *
 * - **A second signal is a hard stop.** The listeners are removed the moment the
 *   first one arrives, so a repeat reaches the platform's default action and the
 *   process ends at once — which is the escape hatch a teardown that never
 *   returns would otherwise take away, and what `Ctrl+C` twice has always meant.
 *   That removal is the whole of this installer's idempotence, and it is why
 *   there is no "already shutting down" flag: the first listener detaches the
 *   others in the same synchronous call that runs the teardown, so no second
 *   listener is left to reach a guard, and a flag nothing can set is a branch
 *   nothing can test.
 * - **The process still exits.** Re-raising the signal through `kill` rather than
 *   calling `process.exit` lets the exit status stay the one the signal means,
 *   and the original signal number reaches whoever reads it. A repository-wide
 *   `exit` here would also discard work the process still owes its streams.
 *
 * `teardown` is the application's own stop, so a failure in it is reported where
 * an application reads its logs and the exit still happens: a shutdown path may
 * not become a call that cannot complete. This is a failure-reporting call site
 * and goes through the seam the shutdown hooks already report through.
 *
 * @internal
 */
export function installShutdownSignalHandlers(
  teardown: (signal: ShutdownSignal) => Promise<void>,
  logger: LoggerService | undefined,
  target: ShutdownSignalTarget = process,
): void {
  const installed: { readonly signal: ShutdownSignal; readonly listener: () => void }[] = [];

  const detach = (): void => {
    for (const entry of installed) {
      target.off(entry.signal, entry.listener);
    }
  };

  const finish = async (signal: ShutdownSignal): Promise<void> => {
    try {
      await teardown(signal);
    } catch (error) {
      reportThroughLogger(logger, error, "AponiaApplication");
    } finally {
      target.kill(target.pid, signal);
    }
  };

  const handle = (signal: ShutdownSignal): void => {
    detach();
    void finish(signal);
  };

  for (const signal of shutdownSignals) {
    const listener = (): void => {
      handle(signal);
    };
    installed.push({ signal, listener });
    target.on(signal, listener);
  }
}
