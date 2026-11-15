import { describe, expect, test } from "bun:test";
import { Serialize, getResponseSerializer } from "../src/index.ts";

describe("@Serialize", () => {
  test("records a class serializer and a method serializer", () => {
    const classSerializer = (value: unknown) => ({ class: value });
    const methodSerializer = (value: unknown) => ({ method: value });

    class Controller {
      read(): string {
        return "value";
      }
    }

    Serialize(classSerializer)(Controller);
    Serialize(methodSerializer)(
      Controller.prototype,
      "read",
      Object.getOwnPropertyDescriptor(Controller.prototype, "read")!,
    );

    expect(getResponseSerializer(Controller)).toBe(classSerializer);
    expect(getResponseSerializer(Controller.prototype, "read")).toBe(methodSerializer);
    expect(getResponseSerializer(Controller.prototype, "missing")).toBeUndefined();
  });

  test("rejects a value that is not a function", () => {
    expect(() => Serialize(1 as never)).toThrow(TypeError);
  });
});
