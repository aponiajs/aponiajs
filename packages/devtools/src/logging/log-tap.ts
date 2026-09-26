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
 * The stream each tapped logger records into.
 *
 * A logger is a live object the application owns, so tapping one twice would
 * wrap the wrapper: every line would be recorded twice and printed twice. The
 * map makes a second tap answer with the stream that is already recording — one
 * logger, one stream — so a registration that names a logger another one already
 * named publishes the stream a client is already polling rather than a fresh one
 * nothing writes into.
 */
const tappedLoggers = new WeakMap<object, LogBuffer>();

/**
 * Whether this package can record the lines a value writes: an object with at
 * least one callable `LoggerService` method.
 *
 * The value arrives from an option, and a JavaScript caller has no type checker,
 * so it is checked rather than trusted. A value that fails the check records
 * nothing, and the endpoint that would publish it is not registered at all,
 * because an empty stream claims the application logs nothing — the one answer
 * that must not be given when it is not true.
 *
 * @internal
 */
export function isRecordableLogger(value: unknown): value is LoggerService {
  if (value === null || typeof value !== "object") {
    return false;
  }

  return recordableLevels.some(
    (level) => typeof (value as Record<string, unknown>)[level] === "function",
  );
}

/**
 * Records everything `logger` writes into `buffer`, and answers the stream that
 * records it.
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
 * refuses the assignment — is left exactly as it was and the stream handed over
 * records nothing for it, because a debugging aid that failed a boot over its own
 * tap would be the failure mode this package exists not to have. A logger it has
 * tapped before is answered with the stream already recording it, so the two
 * cannot disagree about where a line went.
 */
export function tapLogBuffer(logger: LoggerService, buffer: LogBuffer): LogBuffer {
  try {
    const tapped = tappedLoggers.get(logger);

    if (tapped !== undefined) {
      return tapped;
    }

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
  } catch {
    // Nothing was recorded and the logger keeps the methods it had, because the
    // tap is this package's convenience and never the application's contract.
  }

  rememberTap(logger, buffer);

  return buffer;
}

/**
 * Remembers which stream records a logger, however the patch went: a logger this
 * package could not patch is still a logger it has answered for, and a second
 * caller gets the same answer rather than a second stream that records nothing.
 *
 * A value that cannot be keyed — a JavaScript caller can pass anything — is
 * simply not remembered, because the stream handed over is the answer either way.
 */
function rememberTap(logger: LoggerService, buffer: LogBuffer): void {
  try {
    tappedLoggers.set(logger, buffer);
  } catch {
    // Not an object, so there is nothing to remember it by.
  }
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
