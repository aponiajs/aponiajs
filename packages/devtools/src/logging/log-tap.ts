import type { LoggerService, LogLevel } from "@aponiajs/common";
import type { LogBuffer, LogEntry } from "./log-buffer.types.ts";

/**
 * The `LoggerService` methods a tap records, in the order the interface declares
 * them. `debug` and `verbose` are optional on it, so a logger that omits them is
 * tapped for the levels it has.
 */
const recordableLevels = [
  "log",
  "fatal",
  "error",
  "warn",
  "debug",
  "verbose",
] as const satisfies readonly LogLevel[];

/**
 * The loggers this module has already wrapped.
 *
 * A logger is a live object the application owns, so wrapping one twice would
 * wrap the wrapper: every line would be recorded twice and printed twice. The
 * guard makes a second tap a no-op that leaves the first recording, which is the
 * state the application asked for the first time.
 */
const tappedLoggers = new WeakSet<object>();

/**
 * Records everything `logger` writes into `buffer`, and answers the same logger.
 *
 * The logger is patched in place rather than replaced. The application has
 * already handed this object to the platform, which holds its own reference to
 * it, so a wrapper would be a logger the framework never uses and a replacement
 * would be one the application never sees. Patching keeps one object: the line
 * the platform writes and the line the application writes are the same line, and
 * both still reach the console, because the method that was already there is
 * still called.
 *
 * Every call is recorded, whatever the logger would print. `LoggerService` has
 * no notion of an enabled level — that is a display decision a concrete logger
 * may make for itself, and re-applying a rule this package cannot read would be
 * enforcing a filter it does not own.
 *
 * A logger this package cannot patch — a frozen object, or a property that
 * refuses the assignment — is left exactly as it was and is still answered with,
 * because a debugging aid that failed a boot over its own tap would be the
 * failure mode this package exists not to have.
 */
export function tapLogBuffer(logger: LoggerService, buffer: LogBuffer): LoggerService {
  if (tappedLoggers.has(logger)) {
    return logger;
  }

  try {
    // One assertion, stated here rather than repeated per level: the methods the
    // interface declares are mutable properties of whatever object implements
    // it, and patching them is what keeps the logger the object it was.
    const target = logger as unknown as Record<string, unknown>;

    for (const level of recordableLevels) {
      const write: ((message: unknown, ...optionalParameters: unknown[]) => void) | undefined =
        logger[level];
      if (write === undefined) {
        continue;
      }

      target[level] = (message: unknown, ...optionalParameters: unknown[]): void => {
        // The entry is recorded before the line is written: the logger's own
        // write can fail — a closed stream, a logger that throws — and a line
        // the application wrote is still a line this stream states.
        buffer.write(createLogEntry(level, message, optionalParameters));
        write.call(logger, message, ...optionalParameters);
      };
    }

    tappedLoggers.add(logger);
  } catch {
    // Nothing was recorded and the logger keeps the methods it had, because the
    // tap is this package's convenience and never the application's contract.
  }

  return logger;
}

/**
 * One entry, as `/logs` states it.
 *
 * `message` is projected to text here rather than left to `JSON.stringify`,
 * because a logger's arguments are `unknown` by contract: an `Error` would
 * serialize as `{}`, a function as nothing at all, and a value that refers to
 * itself would fail the payload on the request that asked for it. The projection
 * is the console logger's where it has one — a string is its own text, a function
 * is its name — and JSON for everything else, with the plain string form as the
 * floor nothing falls through. A line is reported as the caller wrote it: the
 * text is not folded to one line, because a devtools stream states what happened
 * rather than editing it.
 */
function createLogEntry(
  level: LogLevel,
  message: unknown,
  optionalParameters: readonly unknown[],
): LogEntry {
  return Object.freeze({
    level,
    context: namedContext(optionalParameters),
    message: projectMessage(message),
    timestamp: new Date().toISOString(),
  });
}

/**
 * The context the caller named: the final string argument, which is where the
 * framework's own logger reads it from, and the empty string when the caller
 * named none. A logger's configured context is private to it and is not guessed
 * at.
 */
function namedContext(optionalParameters: readonly unknown[]): string {
  const last = optionalParameters.at(-1);

  return typeof last === "string" ? last : "";
}

function projectMessage(message: unknown): string {
  if (typeof message === "string") {
    return message;
  }
  if (typeof message === "function") {
    return message.name || "(anonymous)";
  }
  if (message instanceof Error) {
    // The name and the message, never the stack: a stack describes the internals
    // of the running application, and a stream a page reads is no place for one.
    return `${message.name}: ${message.message}`;
  }

  try {
    return JSON.stringify(message) ?? String(message);
  } catch {
    return String(message);
  }
}
