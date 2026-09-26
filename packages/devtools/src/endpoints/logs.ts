import type { LogBuffer } from "../logging/log-buffer.types.ts";
import type { AponiaLogsPayload } from "./payloads.types.ts";

/** The path this endpoint is served under, relative to the devtools prefix. */
export const devtoolsLogsPath = "/logs";

/**
 * The cursor `/logs` was asked about, read from the request's query string.
 *
 * A poller states the cursor the previous answer carried, and every answer
 * carries one, so the first poll from a fresh client names nothing and reads the
 * whole retained window. A `since` that is not a safe integer — absent, a word, a
 * fraction — reads the same way as no cursor at all: the contract has no error in
 * it, and a client whose cursor was lost should be answered with the retained
 * stream rather than a `400` it cannot act on.
 *
 * A negative number is handed over as it is rather than folded into a zero here,
 * because the buffer already answers a cursor at or before its oldest retained
 * write with the whole window — the answer a zero reads — and one clamp in the
 * buffer is one place for one rule to be wrong.
 *
 * The query string is parsed by `URL`, which is what knows what a query string
 * is, rather than by a split this file would have to keep correct; a repeated
 * key reads as its first value, which is what a poller sends.
 */
export function readLogsCursor(request: Request): number {
  const since = new URL(request.url).searchParams.get("since");

  if (since === null) {
    return 0;
  }

  const cursor = Number(since);

  return Number.isSafeInteger(cursor) ? cursor : 0;
}

/**
 * Builds the payload `/logs` answers with: the entries written after one cursor,
 * oldest first, and the cursor the next poll asks from.
 *
 * The read is the buffer's, and so is everything that makes the answer total:
 * a cursor older than the retained window slides to the front of it, and one
 * ahead of every write that has happened answers nothing. Neither is an error,
 * and the cursor in the answer never goes backwards, because it is what tells
 * the poller what to ask for next.
 */
export function buildLogsPayload(buffer: LogBuffer, since: number): AponiaLogsPayload {
  const read = buffer.since(since);

  return Object.freeze({ cursor: read.cursor, entries: read.entries });
}
