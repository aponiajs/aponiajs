import { createRingBuffer } from "../buffer/ring-buffer.ts";
import type { RequestBuffer, RequestRecord } from "./request-buffer.types.ts";

/**
 * How many requests one devtools registration retains.
 *
 * The spec fixes the buffer's shape and says it is bounded, and names no
 * capacity. A registration records one entry per request, so the window is what
 * a developer reads while working through a bug rather than a traffic archive:
 * a few hundred entries is more than a page renders and a bound a forgotten
 * consumer cannot grow past. It matches the log stream's capacity because the two
 * are read together, and it is stated once here rather than repeated per call
 * site.
 */
export const defaultRequestBufferCapacity = 500;

/**
 * The request record for one devtools registration, built at the capacity it is
 * given.
 *
 * A `RequestBuffer` is a `RingBuffer<RequestRecord>` and nothing more: the
 * record's shape is what this domain adds, and the boundedness, the cursor, and
 * the read are the shared buffer's, so `/logs` and `/requests` behave identically
 * by construction.
 */
export function createRequestBuffer(capacity: number): RequestBuffer {
  return createRingBuffer<RequestRecord>(capacity);
}
