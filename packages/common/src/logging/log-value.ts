/**
 * How a logged value is stated in text, and what a value this release cannot
 * state is stated as instead.
 */

/**
 * The literal a value this release cannot render is stated as.
 *
 * A value's place states that the tool could not turn it into text, rather than
 * the field being absent or the line failing. An absent field reads as a value
 * the caller never passed, and a thrown error is a different fact entirely. It
 * is one of the literals this framework states in a value's place, beside
 * `[redacted]`, `[truncated]`, and `[unserializable]`.
 */
export const unrenderableValue = "[unrenderable]";

/**
 * The account of a value, as the text a surface states it in: a string is its own
 * text, a function is its name, an `Error` is its name and message with no stack,
 * and anything else is its JSON form with the plain string form behind it. A value
 * that refuses both of those forms is stated as the literal rather than allowed to
 * throw.
 *
 * Two surfaces in this framework record a thrown value, and both state one through
 * this rendering: the devtools log stream's entry for a line, and the exception the
 * platform's default mapping records for `/requests`. One definition rather than a
 * copy each, so two surfaces reporting one failure cannot disagree about it, and
 * the literal a value that refuses everything is stated as is the same word on both
 * by construction. A surface that reports something other than a recorded value has
 * a form of its own; the console logger prints one for a terminal reader, and the
 * devtools package's guarded report rows fold a thrown reason to one line.
 *
 * The text is not folded to one line. A string keeps its newlines, because a
 * surface states what happened rather than editing it.
 *
 * It may not throw, whatever it is handed, and the totality is the function's own
 * rather than its callers': this rendering exists to be used where a failure is
 * reported, and the platform reports one by recording the exception from inside a
 * hook whose return value is the response the client receives, through this call
 * and without a guard, so a throw here would replace the application's answer with
 * the engine's own page. The devtools log stream's half of that report is guarded
 * by the platform instead. Every read of the value below is inside the
 * guard except the `typeof` test that answers a string, because `typeof` is the
 * one read that cannot be made to throw; the guard covers the whole of the rest
 * rather than the reads somebody thought of — a `Proxy` refuses `instanceof`,
 * `JSON.stringify` refuses a value that refers to itself or whose `toJSON` throws,
 * and a function's `name` refuses when it is a getter that throws.
 */
export function renderLogValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    if (typeof value === "function") {
      return value.name || "(anonymous)";
    }
    if (value instanceof Error) {
      // The name and the message, never the stack: a stack describes the
      // internals of the running application, and a record a page reads is no
      // place for one.
      return `${value.name}: ${value.message}`;
    }

    return JSON.stringify(value) ?? String(value);
  } catch {
    return plainStringValue(value);
  }
}

/**
 * The plain string form of a value, or the literal when even that refuses.
 *
 * This is the last read the rendering makes, and it is guarded on its own because
 * a value can refuse the plain string form as readily as it refused everything
 * before it. A value whose `toPrimitive` or `toString` throws is a value this
 * release cannot state, and saying so in a literal is the honest account where a
 * throw is a different answer rather than a report of one.
 */
function plainStringValue(value: unknown): string {
  try {
    return String(value);
  } catch {
    return unrenderableValue;
  }
}
