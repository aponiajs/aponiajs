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
 * joins `[redacted]`, `[truncated]`, and `[unserializable]` as the family of
 * literals this framework states in a value's place.
 */
export const unrenderableValue = "[unrenderable]";
