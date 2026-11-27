import { describe, expect, test } from "vite-plus/test";
import { createDto, resolveRouteValidator } from "@aponiajs/common";
import { PartialType } from "@aponiajs/mapped-types";
import { Type } from "typebox";
import { Value } from "typebox/value";

describe("@aponiajs/mapped-types conformance", () => {
  test("PartialType produces an optional TypeBox validator accepted by resolveRouteValidator", () => {
    class BaseDto extends createDto(Type.Object({ name: Type.String() })) {}
    class UpdateDto extends PartialType(BaseDto) {}

    const schema = resolveRouteValidator(UpdateDto) as never;
    expect(Value.Check(schema, {})).toBe(true);
    expect(Value.Check(schema, { name: "alice" })).toBe(true);
  });
});
