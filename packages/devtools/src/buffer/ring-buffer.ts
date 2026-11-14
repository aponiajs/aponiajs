import type { RingBuffer, RingBufferRead } from "./ring-buffer.types.ts";

/**
 * A bounded cursor buffer, built for one capacity.
 *
 * The cursor is the write count rather than an index into the retained items,
 * which is what keeps it monotonic across the drops: the oldest retained item's
 * cursor is the write count minus the number of items held, so a caller whose
 * cursor predates the window slides to the front of the window and reads what
 * is left rather than failing or reading a stale offset.
 *
 * A read copies the retained items it answers with and freezes the copy, so a
 * payload built from one can never be changed by a later write, and the frozen
 * answer travels as far as the wire without a second copy.
 */
export function createRingBuffer<TItem>(capacity: number): RingBuffer<TItem> {
  const items: TItem[] = [];
  let written = 0;

  return Object.freeze({
    write(item: TItem): void {
      items.push(item);
      written += 1;

      if (items.length > capacity) {
        items.shift();
      }
    },
    since(cursor: number): RingBufferRead<TItem> {
      // The cursor of the oldest retained item. A caller older than it reads
      // what is retained rather than an error, and the cursor it is answered
      // with is the write count, so it can never go backwards.
      const oldest = written - items.length;
      const from = Math.max(cursor - oldest, 0);

      return Object.freeze({ cursor: written, entries: Object.freeze(items.slice(from)) });
    },
  });
}
