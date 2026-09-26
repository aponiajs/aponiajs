/**
 * What one read of a ring buffer answers.
 *
 * `cursor` is the buffer's write count at the moment of the read, and it is
 * what a marker passes back as `since` on the next poll. It is monotonic for
 * the life of one buffer, so a consumer that stores it can poll without
 * missing an item however many writes happen between two reads.
 */
export interface RingBufferRead<TItem> {
  /** Every retained item written after the cursor the read was asked about, oldest first. */
  readonly entries: readonly TItem[];
  /** The total number of items written to this buffer, ever. Pass it back as `since`. */
  readonly cursor: number;
}

/**
 * A fixed-capacity buffer of items polled with a cursor.
 *
 * A buffer rather than a queue because the consumer is a poller: it keeps the
 * cursor it last read and asks for everything after it, which is the shape that
 * survives a reload. Bounded because a consumer that is never polled again must
 * not be able to grow the process — `write` drops the oldest item once the
 * buffer is at capacity.
 *
 * The cursor counts every item written, including the ones dropped, so it never
 * goes backwards: a caller that polls regularly always moves forward, and a
 * caller whose cursor has fallen out of the window reads what is retained
 * rather than an error.
 */
export interface RingBuffer<TItem> {
  /** Appends one item, dropping the oldest once the buffer is at capacity. */
  write(item: TItem): void;
  /**
   * Everything written after `cursor`, or everything retained when `cursor` is
   * older than the window. Never an error, whatever the cursor is.
   */
  since(cursor: number): RingBufferRead<TItem>;
}
