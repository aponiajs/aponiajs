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
 * One call site needs that guard: the platform's default mapping reports an
 * unhandled failure through `error` from inside the hook whose return value is
 * the response, so it guards the call and answers whatever the logger does, and
 * reports a logger that refused on `stderr`. Everywhere else a throw is a throw —
 * a logger that fails while the boot logs its routes fails the boot, which is
 * loud at the one moment there is no answer to lose.
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
