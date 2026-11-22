import type { LoggerService } from "@aponiajs/common";

/** The signals a graceful shutdown answers. */
const shutdownSignals = Object.freeze(["SIGTERM", "SIGINT"] as const);

/** One signal the installer can answer. */
export type ShutdownSignal = (typeof shutdownSignals)[number];

/**
 * The process surface the installer reaches through.
 *
 * Structural rather than `typeof process`, so a caller can hand it a double:
 * the only way to prove a second signal no longer reaches an application is to
 * observe the listeners attached and removed.
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
 * Runs an application's teardown instead of letting the process die abruptly.
 *
 * The listeners are removed synchronously when the first signal arrives, so a
 * repeat reaches the runtime's default action, and the process ends by
 * re-raising the signal through `kill` so the exit status stays the signal's
 * own. A failing teardown is reported and the signal is still re-raised.
 *
 * @param teardown - The application's own stop.
 * @param logger - Where a failing teardown is reported.
 * @param target - The process surface, defaulting to `process`.
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
      try {
        logger?.error(error, "AponiaApplication");
      } catch {
        // A logger that refuses may not prevent the process from ending.
      }
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
