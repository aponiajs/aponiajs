/**
 * The cursor a cursor endpoint was asked about, read from the request's query
 * string.
 *
 * `/logs` and `/requests` are polled the same way and answer the same contract,
 * so they read their cursor the same way: once, here. A poller states the cursor
 * the previous answer carried and every answer carries one, so the first poll from
 * a fresh client names nothing and reads the whole retained window. A `since` that
 * is not a safe integer — absent, a word, a fraction — reads the same as no cursor
 * at all: the contract has no error in it, and a client whose cursor was lost
 * should be answered with the retained window rather than a `400` it cannot act
 * on.
 *
 * A negative number is handed over as it is rather than folded into a zero here,
 * because the buffer already answers a cursor at or before its oldest retained
 * write with the whole window — the answer a zero reads — and one clamp in the
 * buffer is one place for one rule to be wrong.
 *
 * The query string is parsed by `URL`, which is what knows what a query string is,
 * rather than by a split this file would have to keep correct; a repeated key
 * reads as its first value, which is what a poller sends.
 *
 * @internal
 */
export function readSinceCursor(request: Request): number {
  const since = new URL(request.url).searchParams.get("since");

  if (since === null) {
    return 0;
  }

  const cursor = Number(since);

  return Number.isSafeInteger(cursor) ? cursor : 0;
}
