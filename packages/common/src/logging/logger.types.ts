export type LogLevel = "fatal" | "error" | "warn" | "log" | "debug" | "verbose";

/**
 * The logger contract a boot and an application both write through.
 *
 * A method may throw. This interface is public and an application's own
 * implementation answers for itself, so the framework never reads a successful
 * call as a promise the interface makes. `ConsoleLogger`, the one this framework
 * builds, does not throw: it renders every value it is handed, or states that it
 * could not. That is a property of that class rather than of this contract, and
 * both halves are needed — a caller that must not be harmed by a throw guards for
 * itself, and an application that hands over a logger gets one that cannot cost
 * it a response.
 *
 * One rule follows, and it is narrow on purpose: a call site that reports a
 * failure guards, and a call site that reports progress does not. Three call
 * sites report a failure — the platform's default mapping answers an unhandled
 * failure from inside the hook whose return value is the response, its declared
 * filter hook reports a filter that threw before declining to what answers next,
 * and `listen` reports the failure it is about to rethrow — so each guards the
 * call and answers whatever the logger does, and reports a logger that refused on
 * `stderr`. Everywhere else a throw is a throw — a logger that fails while the
 * boot logs its routes fails the boot, which is loud at the one moment there is
 * no answer to lose. A throw on a progress line aborts work that has not yet
 * reported a failure, and aborting it is louder than continuing.
 */
export interface LoggerService {
  log(message: unknown, ...optionalParameters: unknown[]): void;
  fatal(message: unknown, ...optionalParameters: unknown[]): void;
  error(message: unknown, ...optionalParameters: unknown[]): void;
  warn(message: unknown, ...optionalParameters: unknown[]): void;
  debug?(message: unknown, ...optionalParameters: unknown[]): void;
  verbose?(message: unknown, ...optionalParameters: unknown[]): void;
}

export interface ConsoleLoggerOptions {
  readonly logLevels?: readonly LogLevel[];
  readonly timestamp?: boolean;
  readonly prefix?: string;
  readonly json?: boolean;
  readonly colors?: boolean;
  readonly context?: string;
  readonly compact?: boolean | number;
  readonly depth?: number;
}
