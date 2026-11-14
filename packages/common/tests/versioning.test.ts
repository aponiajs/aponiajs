import { describe, expect, test } from "bun:test";
import { VERSION_NEUTRAL, Version, getVersionMetadata, versionPathSegment } from "../src/index.ts";

describe("@Version", () => {
  test("records a controller and a method version", () => {
    class Controller {
      read(): string {
        return "value";
      }
    }

    Version("1")(Controller);
    Version("2")(
      Controller.prototype,
      "read",
      Object.getOwnPropertyDescriptor(Controller.prototype, "read")!,
    );

    expect(getVersionMetadata(Controller)).toBe("1");
    expect(getVersionMetadata(Controller.prototype, "read")).toBe("2");
    expect(getVersionMetadata(Controller.prototype, "missing")).toBeUndefined();
  });

  test("normalizes the URI segment and rejects an empty or slashed version", () => {
    expect(versionPathSegment("1")).toBe("v1");
    expect(versionPathSegment("v2")).toBe("v2");
    expect(versionPathSegment("2.0")).toBe("v2.0");
    expect(() => Version("")).toThrow(TypeError);
    expect(() => Version("1/2")).toThrow(TypeError);
  });

  test("records the neutral marker as a version a route can declare", () => {
    class NeutralController {}

    Version(VERSION_NEUTRAL)(NeutralController);

    expect(getVersionMetadata(NeutralController)).toBe(VERSION_NEUTRAL);
  });
});
