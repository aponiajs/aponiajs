import { formatLogValue, type LogLevel, type LoggerService } from "@aponiajs/common";
import type { LogBuffer, LogEntry } from "./log-buffer.types.ts";

/**
 * The `LoggerService` methods a tap records: every level the interface declares,
 * and `debug` and `verbose` are optional on it, so a logger that omits them is
 * tapped for the levels it has. This order is the package's own and no contract
 * depends on it — each level's method is patched on its own, and every level is
 * attempted whatever happened to the ones before it, so the order decides only
 * the order `levels` is stated in.
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
 * A tapped logger's stream and the levels the tap reached on it.
 *
 * `levels` is what makes a stream readable: an entry states only the level it was
 * written at, so without this list an absent `debug` line and a `debug` level the
 * tap never reached would read the same. It is the levels the tap installed on,
 * in `recordableLevels` order, and it is a copy the caller owns.
 */
export interface LogStream {
  /** The buffer that records every line written through the tapped logger. */
  readonly buffer: LogBuffer;
  /** The levels the tap patched, in `recordableLevels` order. */
  readonly levels: readonly LogLevel[];
}

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
const tappedLoggers = new WeakMap<object, LogStream>();

/**
 * Reads the existing log stream for a tapped logger, or undefined when it was not tapped.
 * @internal
 */
export function getTappedLogStream(logger: object): LogStream | undefined {
  return tappedLoggers.get(logger);
}

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
 * A level is read defensively, because a live object refuses a read as readily as
 * an assignment: a getter, or a `Proxy`, can throw on the read itself, and this
 * check walks levels until it finds a callable one — so a value whose readable
 * levels come after an unreadable one reaches that throw. It runs at registration,
 * while a module is being declared, so a throw here would fail the boot rather than
 * refuse a value. A level that cannot be read is a level that cannot be recorded.
 *
 * @internal
 */
export function isRecordableLogger(value: unknown): value is LoggerService {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const target = value as Record<string, unknown>;

  return recordableLevels.some((level) => isCallableMethod(target, level));
}

/**
 * Whether one level of a value is a callable method, read without letting the read
 * escape.
 *
 * This is the check's half of the rule the tap applies per level: a getter, or a
 * `Proxy`, can throw on the read itself, and that is data a JavaScript caller
 * supplies rather than a defect here. Answering `false` says the level cannot be
 * recorded, which is the truth about a level nothing can be read from — and it is
 * answered from inside the guard rather than thrown out of a registration.
 */
function isCallableMethod(target: Record<string, unknown>, level: LogLevel): boolean {
  try {
    return typeof target[level] === "function";
  } catch {
    return false;
  }
}

/**
 * Records everything `logger` writes into `buffer`, and answers the stream that
 * records it — or `undefined` when nothing could be installed on the logger, in
 * which case `buffer` will never receive a line and the caller must not publish
 * it as a stream.
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
 * Each level is attempted on its own, and one that refuses costs only itself: the
 * method it had is left in place, the levels before it record, and the levels
 * after it are still attempted. A refusal is either half of the pair the tap needs
 * — a live object can refuse the read of a level as readily as the assignment to
 * it — and neither costs anything beyond the level it landed on. That is why the
 * answer carries `levels` — a stream states which levels it can hold rather than
 * leaving a client to read a silence the tap never installed into. The whole
 * answer is `undefined` only when no level at all was patched, because that is the
 * shape where an empty stream would announce that nothing is being logged while
 * that logger goes on printing every line — the same false answer a value that is
 * not a logger is refused. A logger it has tapped before is answered with the
 * stream already recording it, so the two cannot disagree about where a line went.
 *
 * @param logger - The logger to tap in place.
 * @param buffer - The buffer tapped lines are recorded into.
 * @returns The stream recording the logger, or `undefined` when no level patched.
 */
export function recordLogger(logger: LoggerService, buffer: LogBuffer): LogStream | undefined {
  const tapped = tappedLoggers.get(logger);

  if (tapped !== undefined) {
    return tapped;
  }

  // One assertion, stated here rather than repeated per level: the methods the
  // interface declares are mutable properties of whatever object implements it,
  // and patching them is what keeps the logger the object it was.
  const target = logger as unknown as Record<string, unknown>;
  const levels: LogLevel[] = [];

  for (const level of recordableLevels) {
    try {
      const write: ((message: unknown, ...optionalParameters: unknown[]) => void) | undefined =
        logger[level];

      // A level the logger does not carry is a level there is nothing to patch.
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
      levels.push(level);
    } catch {
      // A level that refused — the read or the assignment — costs only itself: it
      // is not pushed, it keeps the method it had, and the remaining levels are
      // still attempted. The read is inside this attempt because a live object can
      // refuse the read as well as the assignment, and this runs at registration,
      // while a module is being declared. Nothing here may escape — the tap is
      // this package's convenience and never the application's contract, so a boot
      // does not fail over it, which is the failure mode this package exists not
      // to have.
    }
  }

  if (levels.length === 0) {
    return undefined;
  }

  const stream = Object.freeze({ buffer, levels: Object.freeze(levels) });
  rememberTap(logger, stream);

  return stream;
}

/**
 * Remembers which stream records a logger, once a tap has installed something on
 * it: a second caller gets that stream rather than a second one nothing writes
 * into. A logger nothing could be installed on is not remembered, because there is
 * no stream to answer with — the honest answer is the one it just got, and a
 * later tap retries rather than remembering an absence as a stream.
 *
 * A value that cannot be keyed — a JavaScript caller can pass anything — is
 * simply not remembered, because the stream handed over is the answer either way.
 */
function rememberTap(logger: LoggerService, stream: LogStream): void {
  try {
    tappedLoggers.set(logger, stream);
  } catch {
    // Not an object, so there is nothing to remember it by.
  }
}

/**
 * One entry, as `/logs` states it.
 *
 * `message` is rendered by `@aponiajs/common`'s `formatLogValue` rather than left
 * to `JSON.stringify`, because a logger's arguments are `unknown` by contract: an
 * `Error` would serialize as `{}`, a function as nothing at all, and a value that
 * refers to itself would fail the payload on the request that asked for it. It is
 * one definition rather than a copy of one: `/requests` states the exception the
 * platform's mapping recorded through the same call, so the two surfaces cannot
 * disagree about a failure they both report, and the literal a value that refuses
 * everything is stated as is the same word on both by construction.
 *
 * A line is reported as the caller wrote it: the text is not folded to one line,
 * because a devtools stream states what happened rather than editing it. The
 * rendering may not throw — it runs inside a patched logger method, and one caller
 * of a logger method is the platform's error hook reporting an unhandled failure —
 * and `formatLogValue` is total, so there is nothing here to catch. What a throw
 * would cost has moved rather than gone: the platform's error hook guards the
 * logger call that reaches this tap, so a throw on that path is caught, announced
 * on `stderr`, and the request is answered all the same, while the line itself goes
 * unrecorded, because the entry is built before the logger is called; every other
 * caller of a logger method carries the throw, as it did before the tap existed.
 */
function createLogEntry(
  level: LogLevel,
  message: unknown,
  optionalParameters: readonly unknown[],
): LogEntry {
  return Object.freeze({
    level,
    context: namedContext(optionalParameters),
    message: formatLogValue(message),
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
