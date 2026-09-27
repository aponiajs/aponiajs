import type { LoggerService, LogLevel } from "@aponiajs/common";
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
export interface TappedLogStream {
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
const tappedLoggers = new WeakMap<object, TappedLogStream>();

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
 * Each level is attempted on its own, and one that refuses the assignment costs
 * only itself: the method it had is left in place, the levels before it record,
 * and the levels after it are still attempted. That is why the answer carries
 * `levels` — a stream states which levels it can hold rather than leaving a
 * client to read a silence the tap never installed into. The whole answer is
 * `undefined` only when no level at all was patched, because that is the shape
 * where an empty stream would announce that nothing is being logged while that
 * logger goes on printing every line — the same false answer a value that is not
 * a logger is refused. A logger it has tapped before is answered with the stream
 * already recording it, so the two cannot disagree about where a line went.
 */
export function tapLogBuffer(
  logger: LoggerService,
  buffer: LogBuffer,
): TappedLogStream | undefined {
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
    const write: ((message: unknown, ...optionalParameters: unknown[]) => void) | undefined =
      logger[level];

    // A level the logger does not carry is a level there is nothing to patch.
    if (write === undefined) {
      continue;
    }

    try {
      target[level] = (message: unknown, ...optionalParameters: unknown[]): void => {
        // The entry is recorded before the line is written: the logger's own
        // write can fail — a closed stream, a logger that throws — and a line
        // the application wrote is still a line this stream states.
        buffer.write(createLogEntry(level, message, optionalParameters));
        write.call(logger, message, ...optionalParameters);
      };
      levels.push(level);
    } catch {
      // This level keeps the method it had, and the remaining levels are still
      // attempted: a refusal costs the level it landed on rather than that level
      // and every one after it. Nothing here may escape — the tap is this
      // package's convenience and never the application's contract, so a boot
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
function rememberTap(logger: LoggerService, stream: TappedLogStream): void {
  try {
    tappedLoggers.set(logger, stream);
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
