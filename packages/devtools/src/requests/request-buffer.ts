import { createRingBuffer } from "../buffer/ring-buffer.ts";
import type { RequestBuffer, RequestRecord } from "./request-buffer.types.ts";

/**
 * How many entries one devtools registration retains.
 *
 * The spec fixes the buffer's shape and says it is bounded, and names no
 * capacity. The bound is on **entries**, not on requests: one answered request
 * writes two of them, one at arrival and one at completion, so `1000` holds five
 * hundred answered requests. A request nothing answered costs one entry rather
 * than two, so the same bound holds more requests the more of those a boot
 * records — up to the full `1000` when nothing is answered at all. The cursor
 * counts entries rather than requests, so a consumer polling it reads two of
 * them per answered request.
 *
 * The log stream's capacity is its own constant and does not move with this one:
 * its bound counts lines, and one line is one call, so the two numbers are equal
 * by coincidence rather than by rule and neither is derived from the other.
 *
 * The window is what a developer reads while working through a bug rather than a
 * traffic archive: a few hundred requests is more than a page renders and a bound
 * a forgotten consumer cannot grow past. It is stated once here rather than
 * repeated per call site.
 */
export const defaultRequestBufferCapacity = 1000;

/**
 * The request record for one devtools registration, built at the capacity it is
 * given.
 *
 * A `RequestBuffer` is a `RingBuffer<RequestRecord>` and nothing more: the
 * record's shape is what this domain adds, and the boundedness, the cursor, and
 * the read are the shared buffer's, so the two cursor endpoints answer a poll
 * identically by construction. What differs is what each caller writes into its
 * own buffer rather than how the buffer answers a read: the log stream writes
 * one entry per line, while one answered request writes two, which is why this
 * capacity and the log stream's state different facts.
 */
export function createRequestBuffer(capacity: number): RequestBuffer {
  return createRingBuffer<RequestRecord>(capacity);
}
