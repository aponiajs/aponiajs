import { describe, expect, test } from "bun:test";
import { Deprecated, getDeprecationMetadata } from "../src/index.ts";

describe("@Deprecated", () => {
  test("records a sunset date and a replacement link", () => {
    @Deprecated({ sunset: "2027-01-01T00:00:00Z", link: "https://api.example.com/v2/users" })
    class LegacyController {}

    expect(getDeprecationMetadata(LegacyController)).toEqual({
      sunset: "Fri, 01 Jan 2027 00:00:00 GMT",
      link: "https://api.example.com/v2/users",
    });
    expect(Object.isFrozen(getDeprecationMetadata(LegacyController))).toBe(true);
  });

  test("lets a handler override a controller declaration", () => {
    @Deprecated()
    class Controller {
      read(): string {
        return "value";
      }
    }
    Deprecated({ link: "https://api.example.com/v2" })(
      Controller.prototype,
      "read",
      Object.getOwnPropertyDescriptor(Controller.prototype, "read")!,
    );

    expect(getDeprecationMetadata(Controller)).toEqual({});
    expect(getDeprecationMetadata(Controller.prototype, "read")).toEqual({
      link: "https://api.example.com/v2",
    });
    expect(getDeprecationMetadata(Controller.prototype, "missing")).toBeUndefined();
  });

  test("refuses a malformed policy", () => {
    expect(() => Deprecated({ sunset: "not a date" })).toThrow(TypeError);
    expect(() => Deprecated({ link: " " })).toThrow(TypeError);
    expect(() => Deprecated("no" as never)).toThrow(TypeError);
  });
});
