import { describe, expect, test } from "bun:test";
import { AponiaError, type AponiaErrorCode } from "@aponiajs/common";
// The loader is package-private and `defineConfiguration` always supplies a
// description, so the name fallback is reachable only by calling it directly.
import { loadConfiguration } from "./configuration-loader.ts";

function codeOf(error: unknown): AponiaErrorCode | undefined {
  return error instanceof AponiaError ? error.code : undefined;
}

describe("loadConfiguration", () => {
  test("names a token a JavaScript caller built by hand", () => {
    const handBuilt = {
      schema: {
        "~standard": {
          version: 1,
          vendor: "test",
          validate: () => ({ issues: [{ message: "refused" }] }),
        },
      },
    };

    let thrown: unknown;
    try {
      loadConfiguration(handBuilt as never, { source: {} });
    } catch (error) {
      thrown = error;
    }

    expect(codeOf(thrown)).toBe("INVALID_CONFIGURATION_VALUE");
    expect((thrown as AponiaError).details).toMatchObject({ configuration: "configuration" });
  });
});
