/**
 * One line-safe account of a thrown reason.
 *
 * A report is a single log row — a refused bind, an analysis that could not be
 * read — and the reason it carries is embedded in that row's sentence. A
 * message that arrived wrapped is therefore folded back into one line, and one
 * that arrived padded is trimmed. The reason itself is otherwise untouched:
 * this reports what was thrown rather than interpreting it.
 *
 * The whole read is guarded, because the sentence it feeds is built as an
 * argument to the guarded report and is therefore built first: a sentence that
 * reports a failure may not become the failure the guard exists to prevent. The
 * two shapes that refuse a read here are the two reads the plain form makes — a
 * `Proxy` whose `getPrototypeOf` trap throws, which `instanceof` walks, and a
 * value whose primitive conversion throws, which `String` makes — and either
 * one is a bare throw to a caller whose logger only ever sees the sentence.
 *
 * A refusal is stated as the framework's own word for a value it could not
 * render, `[unrenderable]` — the literal `@aponiajs/common` states in its shared
 * rendering and in its console logger alike, restated rather than imported
 * because `common` does not publish it.
 * The word is stated rather than left out: this result is embedded in the
 * sentence's parentheses, and a missing clause inside them would read as a
 * value that was read successfully and was empty.
 */
export function oneLine(error: unknown): string {
  try {
    const message = error instanceof Error ? error.message : String(error);

    return message.replaceAll(/\s+/g, " ").trim();
  } catch {
    return "[unrenderable]";
  }
}
