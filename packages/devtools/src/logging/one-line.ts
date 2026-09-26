/**
 * One line-safe account of a thrown reason.
 *
 * A report is a single log row — a refused bind, an analysis that could not be
 * read — and the reason it carries is embedded in that row's sentence. A
 * message that arrived wrapped is therefore folded back into one line, and one
 * that arrived padded is trimmed. The reason itself is otherwise untouched:
 * this reports what was thrown rather than interpreting it.
 */
export function oneLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  return message.replaceAll(/\s+/g, " ").trim();
}
