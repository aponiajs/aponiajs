import { describe, expect, test } from "bun:test";
import { getSerializeOptions, SerializeOptions } from "./serialize-options.ts";

describe("SerializeOptions", () => {
  test("records frozen options on both controllers and handler methods", () => {
    @SerializeOptions({
      excludeExtraneousValues: true,
      excludePrefixes: ["_"],
      strategy: "excludeAll",
    })
    class UsersController {
      @SerializeOptions({ groups: ["public"] })
      list(): void {}

      plain(): void {}
    }

    const classOptions = getSerializeOptions(UsersController);
    expect(classOptions).toEqual({
      excludeExtraneousValues: true,
      excludePrefixes: ["_"],
      strategy: "excludeAll",
    });
    expect(Object.isFrozen(classOptions)).toBe(true);
    expect(Object.isFrozen(classOptions?.excludePrefixes)).toBe(true);

    const methodOptions = getSerializeOptions(UsersController.prototype, "list");
    expect(methodOptions).toEqual({ groups: ["public"] });
    expect(Object.isFrozen(methodOptions?.groups)).toBe(true);

    expect(getSerializeOptions(UsersController.prototype, "plain")).toBeUndefined();
  });
});
