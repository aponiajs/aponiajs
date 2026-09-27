import type { RingBuffer, RingBufferRead } from "../buffer/ring-buffer.types.ts";

/**
 * One entry of the request record: a request that arrived, and the answer it
 * received when this package saw one.
 *
 * One request writes two of these. The first is written when the request
 * arrives, before anything can state an answer — its `status` and `durationMs`
 * are `null` — and the second when the answer's completion runs, with the same
 * `id`. A consumer groups by `id` and takes the last entry each request has in
 * the window it reads, which is the answer wherever the answer is still there to
 * read. Two configurations are where it is not, and in neither is the entry at
 * fault: a consumer lagging more than one window behind never reads an answer the
 * bounded buffer has already evicted, and an answer written after a second
 * `listen()` is written to the record the socket that is gone was serving, which a
 * poll of the new one never reads. The pending entry is not redundant:
 * a request whose answer never reaches this package — a plugin that answered
 * from its own `onRequest`, so that no later phase ran at all — would otherwise
 * leave no trace, and would be indistinguishable from a request that never
 * arrived.
 *
 * The nine fields are the wire shape `/__devtools/requests` publishes, and the
 * buffer stores exactly them. `path` and `url` answer different questions and
 * both are published: `path` is the route pattern that matched — `/users/:id` —
 * so it names the route that answered and joins to `/routes`, while `url` is the
 * path and query string as they arrived, which a pattern never carries. A
 * request that matched no route has no pattern to state, and a request nothing
 * has answered yet has no pattern either, so `path` carries the path that
 * arrived in both cases and `/routes` is the table that says which of the two it
 * is.
 *
 * `error`, `headers`, and `body` are added only when there is something to add,
 * and never written as `undefined`: an opt-out has to be observable on the wire,
 * and a field that states "not captured" and one that states "nothing arrived"
 * are different facts.
 */
export interface RequestRecord {
  /**
   * The request this entry describes. One request produces one entry when it
   * arrived and a second when it was answered, and both carry this id, so a
   * consumer groups by it and takes the last entry for each. It is the arrival
   * ordinal of the capture that wrote this record, whose counter outlives the
   * record: an id never repeats within one capture, so a consumer that polled
   * through a `listen()` and kept ids cannot group two different requests — one
   * boot's and the next boot's — under one id. It is unique per capture rather
   * than per process: two captures in one process each start at `1`, which is no
   * collision for that consumer, because a poll reads one record and every id that
   * meets in one answer is that record's capture's own.
   */
  readonly id: number;
  /** The request's method, as it arrived. */
  readonly method: string;
  /**
   * The route pattern that matched, or the path that arrived when nothing did.
   * Never an origin: a pattern and a path are both application-relative.
   */
  readonly path: string;
  /** The path and query string as they arrived, which no pattern carries. */
  readonly url: string;
  /**
   * The status the client received, or `null` when no answer was observed.
   *
   * `null` states an absence rather than a failure: the request arrived, this
   * record saw it, and no answer for it was read — either because nothing ran
   * afterwards that could report what the application answered, or because the
   * answer lies outside the window the consumer read. It is never `0` and never an
   * omitted key.
   */
  readonly status: number | null;
  /** From this package's arrival hook to the answer's completion, in milliseconds, or `null` when no answer was observed. */
  readonly durationMs: number | null;
  /** When the request arrived, as an ISO-8601 timestamp. */
  readonly timestamp: string;
  /**
   * The failure's message: what the answer published, or — for an unhandled
   * failure the platform mapped — the exception that mapping answered.
   *
   * Absent when there was no failure, and absent for a `5xx` a handler built
   * itself, whose body is the one the client already holds. An unhandled failure
   * the platform mapped is present rather than absent: the mapping answers one
   * fixed `detail` for every such failure and its `Response` is not on the
   * after-response context either, so the boot records the exception the mapping
   * answered as it answers, and that record is read here — in the same account
   * the log stream states the exception in, through the same call, and never a
   * stack.
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
