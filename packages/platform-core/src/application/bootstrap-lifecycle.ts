import type { AponiaContainer } from "@aponiajs/core";
import {
  collectLifecycleCalls,
  type ApplicationShutdown,
  type LifecycleCall,
} from "./lifecycle-hooks.ts";

function reportFailure(logger: unknown, error: unknown): void {
  try {
    (logger as { error?: (failure: unknown, context?: string) => void } | undefined)?.error?.(
      error,
      "ApplicationShutdown",
    );
  } catch {
    // A logger that refuses may not stop the shutdown plan.
  }
}

async function runHooks(
  calls: readonly LifecycleCall[],
  logger: unknown,
  signal?: string,
): Promise<void> {
  for (const call of calls) {
    try {
      await call(signal);
    } catch (error) {
      reportFailure(logger, error);
    }
  }
}

/**
 * Builds the shutdown plan a boot attaches.
 *
 * The order is Nest's: `beforeApplicationShutdown`, then the listener stops,
 * then `onModuleDestroy` reversed, then `onApplicationShutdown`. A hook that
 * throws is reported and the remaining hooks still run.
 *
 * @internal
 */
export function createShutdown(
  container: AponiaContainer,
  logger: unknown,
  stop: (force?: boolean) => Promise<void>,
): ApplicationShutdown {
  const before = collectLifecycleCalls(container, "beforeApplicationShutdown", {
    reverseModules: true,
  });
  const destroy = collectLifecycleCalls(container, "onModuleDestroy", { reverseModules: true });
  const after = collectLifecycleCalls(container, "onApplicationShutdown", {
    reverseModules: true,
  });
  let closed = false;

  return async (force = true, signal?: string): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    await runHooks(before, logger, signal);
    await stop(force);
    await runHooks(destroy, logger);
    await runHooks(after, logger, signal);
  };
}
