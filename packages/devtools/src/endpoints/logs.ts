import type { LogBuffer } from "../logging/log-buffer.types.ts";
import type { AponiaLogsPayload } from "./payloads.types.ts";

/** The path this endpoint is served under, relative to the devtools prefix. */
export const devtoolsLogsPath = "/logs";

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
