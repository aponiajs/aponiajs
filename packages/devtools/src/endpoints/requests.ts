import type { RequestBuffer } from "../requests/request-buffer.types.ts";
import type { AponiaRequestsPayload } from "./payloads.types.ts";

/** The path this endpoint is served under, relative to the devtools prefix. */
export const devtoolsRequestsPath = "/requests";

/**
 * Builds the payload `/requests` answers with: the entries recorded after one
 * cursor, oldest first, and the cursor the next poll asks from.
 *
 * The read is the buffer's, and so is everything that makes the answer total: a
 * cursor older than the retained window slides to the front of it, and one ahead
 * of every write answers nothing. Neither is an error, and the cursor in the
 * answer never goes backwards, because it is what tells the poller what to ask
 * for next.
 *
 * The record is the application's own traffic, and a poll of it adds nothing to
 * it: the surface is mounted on the application the record describes, and the
 * plugin's arrival hook leaves every request under the devtools prefix out, so
 * the request that asks for this payload is not one this payload reports.
 *
 * @internal
 */
export function buildRequestsPayload(buffer: RequestBuffer, since: number): AponiaRequestsPayload {
  const read = buffer.since(since);

  return Object.freeze({ cursor: read.cursor, entries: read.entries });
}
