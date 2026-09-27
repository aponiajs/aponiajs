import { createRingBuffer } from "../buffer/ring-buffer.ts";
import type { LogBuffer, LogEntry } from "./log-buffer.types.ts";

/**
 * How many log lines one devtools server retains.
 *
 * The spec fixes the buffer's shape and says it is bounded, and names no
 * capacity. A boot writes roughly a dozen lines and a running application
 * writes on failures rather than on requests, so a few hundred lines is a
 * window a developer can scroll and a cost a forgotten consumer cannot grow
 * beyond — the bound the spec asks for, chosen once here and stated in the
 * package's own report rather than repeated per call site.
 */
export const defaultLogBufferCapacity = 500;

/**
 * The log stream for one devtools server, built at the capacity it is given.
 *
 * A `LogBuffer` is a `RingBuffer<LogEntry>` and nothing more: the record's
 * shape is what the log stream adds, and the boundedness, the cursor, and the
 * read are the shared buffer's, so `/logs` and every other cursor endpoint
 * behave identically by construction.
 */
export function createLogBuffer(capacity: number): LogBuffer {
  return createRingBuffer<LogEntry>(capacity);
}
