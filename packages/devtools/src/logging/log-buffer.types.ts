import type { RingBuffer, RingBufferRead } from "../buffer/ring-buffer.types.ts";

/**
 * One line the application wrote through its logger.
 *
 * The four fields are the wire shape `/__devtools/logs` publishes, and the
 * buffer stores exactly them: `message` and `context` are already projected to
 * text when the line is recorded, because the logger's own arguments can be any
 * value and a payload that carried them would not be JSON-serializable.
 *
 * `context` is the subsystem the caller named as the final string argument —
 * the same name the framework's own logger prints — and the empty string when
 * the caller named none. The logger's configured context is private to it and
 * is not guessed at.
 */
export interface LogEntry {
  /** The `LoggerService` method that was called: `log`, `warn`, `error`, and so on. */
  readonly level: string;
  /** The subsystem the caller named, or the empty string when it named none. */
  readonly context: string;
  /** The message, projected to text. */
  readonly message: string;
  /** When the line was written, as an ISO-8601 timestamp. */
  readonly timestamp: string;
}

/** The application's log stream: a bounded cursor buffer of {@link LogEntry}. */
export type LogBuffer = RingBuffer<LogEntry>;

/** One read of a {@link LogBuffer}, as `/__devtools/logs` publishes it. */
export type LogBufferRead = RingBufferRead<LogEntry>;
