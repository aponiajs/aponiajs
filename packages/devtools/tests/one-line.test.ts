import { expect, test } from "bun:test";
// The one-line rendering both of this package's guarded reports build their
// sentences with, imported from its own module because it is internal and
// deliberately kept off the barrel — the same arrangement `isLoopbackHost` has in
// `server.test.ts` and `isRecordableLogger` in `logs.test.ts`.
import { oneLine } from "../src/logging/one-line.ts";
// The rendering the two recorded surfaces state a thrown value through, imported
// from the package's barrel because the last case below is the one place in this
// suite that compares the two renderings rather than reading this one.
import { renderLogValue } from "@aponiajs/common";

/**
 * The one-line form of a thrown reason.
 *
 * Its contract is the shape of a log row rather than a rendering policy: a
 * reason arrives wrapped or padded, and the row it is embedded in is one line.
 * The cases below pin the fold and the trim, then the read that has to answer
 * when a value refuses to be read at all — that one is load-bearing rather than
 * cosmetic, because the sentence is built as an argument to a guarded report and
 * is therefore built before that guard runs — and finally the one word this
 * rendering shares with the framework's own.
 */

test("reads a thrown reason as one trimmed line", () => {
  expect(oneLine(new Error("  the connection \n was refused  "))).toBe(
    "the connection was refused",
  );
  expect(oneLine("a reason that is not an error")).toBe("a reason that is not an error");
});

test("states a value that refuses to be read as unrenderable rather than throwing", () => {
  // Two shapes, because the plain form makes two reads: `instanceof` walks the
  // value's prototype chain, and `String` converts a value that is not an error.
  // Either refusal is answered with the word rather than thrown, because a throw
  // out of here is the failure the sentence it feeds exists to report.
  const refusingPrototype = new Proxy(
    {},
    {
      getPrototypeOf: () => {
        throw new TypeError("this value has no prototype to walk");
      },
    },
  );
  const refusingConversion = {
    [Symbol.toPrimitive]: () => {
      throw new TypeError("this value refuses to be converted");
    },
  };

  expect(oneLine(refusingPrototype)).toBe("[unrenderable]");
  expect(oneLine(refusingConversion)).toBe("[unrenderable]");
});

test("states the same literal as the framework's rendering for a value that refuses every read", () => {
  // This case pins the literal both state for a value that refuses every read:
  // `oneLine` answers it for a refusal at either read it makes, and
  // `renderLogValue` for a value it cannot state. Nothing here is asserted about a
  // value that refuses less than everything.
  const refusal: Record<string, unknown> = {};
  refusal.self = refusal;
  Object.defineProperty(refusal, Symbol.toPrimitive, {
    value: () => {
      throw new TypeError("this value refuses to be stated");
    },
  });
  const refusingEveryRead = new Proxy(refusal, {
    getPrototypeOf: () => {
      throw new TypeError("this value has no prototype to walk");
    },
  });

  expect(oneLine(refusingEveryRead)).toBe("[unrenderable]");
  expect(renderLogValue(refusingEveryRead)).toBe("[unrenderable]");
  expect(oneLine(refusingEveryRead)).toBe(renderLogValue(refusingEveryRead));
});

test("states the literal for a refusal the shared rendering still states", () => {
  // The divergence the published documents name: a value that refuses the read
  // the plain string form makes and nothing else is stated by the shared
  // rendering and answered with the literal by this one. Until this case, that
  // sentence was asserted in four documents and pinned by no test.
  const refusingConversion = {
    [Symbol.toPrimitive]: () => {
      throw new TypeError("this value refuses to be converted");
    },
  };

  expect(renderLogValue(refusingConversion)).toBe("{}");
  expect(oneLine(refusingConversion)).toBe("[unrenderable]");
});
