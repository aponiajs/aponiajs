import type { RingBuffer, RingBufferRead } from "../buffer/ring-buffer.types.ts";

/**
 * One request the application answered.
 *
 * The eight fields are the wire shape `/__devtools/requests` publishes, and the
 * buffer stores exactly them. `path` and `url` answer different questions and
 * both are published: `path` is the route pattern that matched — `/users/:id` —
 * so it names the route that answered and joins to `/routes`, while `url` is the
 * path and query string as they arrived, which a pattern never carries. A
 * request that matched no route has no pattern to state, so `path` carries the
 * path that arrived and `/routes` is the table that says which of the two it is.
 *
 * `error`, `headers`, and `body` are added only when there is something to add,
 * and never written as `undefined`: an opt-out has to be observable on the wire,
 * and a field that states "not captured" and one that states "nothing arrived"
 * are different facts.
 */
export interface RequestRecord {
  /** The request's method, as it arrived. */
  readonly method: string;
  /**
   * The route pattern that matched, or the path that arrived when nothing did.
   * Never an origin: a pattern and a path are both application-relative.
   */
  readonly path: string;
  /** The path and query string as they arrived, which no pattern carries. */
  readonly url: string;
  /** The status the answer went out with. */
  readonly status: number;
  /** How long the application took to answer, in milliseconds. */
  readonly durationMs: number;
  /** When the request arrived, as an ISO-8601 timestamp. */
  readonly timestamp: string;
  /**
   * The message the answer published for a failure — a `5xx` — and never the
   * exception's. Absent when there was no failure, and absent for the failures
   * whose published answer cannot be read from where the record is written.
   */
  readonly error?: string;
  /** The request's headers, as they arrived, with the redacted ones replaced. */
  readonly headers?: Readonly<Record<string, string>>;
  /** The request body the route parsed, cut at the policy's limit and marked when it was. */
  readonly body?: string;
}

/** The application's request record: a bounded cursor buffer of {@link RequestRecord}. */
export type RequestBuffer = RingBuffer<RequestRecord>;

/** One read of a {@link RequestBuffer}, as `/__devtools/requests` publishes it. */
export type RequestBufferRead = RingBufferRead<RequestRecord>;
