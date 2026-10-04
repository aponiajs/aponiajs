import type { LoggerService } from "./logger.types.ts";

/**
 * A no-op implementation of `LoggerService` that silently discards all log entries.
 */
export const NOOP_LOGGER: LoggerService = Object.freeze({
  log(): void {},
  fatal(): void {},
  warn(): void {},
  error(): void {},
});

const systemLoggerObservers = new Set<(logger: LoggerService) => void>();

/**
 * Registers an observer that will receive the application's boot logger when initialized.
 *
 * @param observer - Callback invoked with the configured system logger.
 * @returns An unsubscribe function to remove the observer.
 */
export function observeSystemLogger(observer: (logger: LoggerService) => void): () => void {
  systemLoggerObservers.add(observer);
  return () => {
    systemLoggerObservers.delete(observer);
  };
}

/**
 * Notifies all registered logger observers of the active system logger.
 * @internal
 */
export function notifySystemLogger(logger: LoggerService): void {
  for (const observer of systemLoggerObservers) {
    observer(logger);
  }
}
