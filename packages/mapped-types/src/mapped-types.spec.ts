import { describe, expect, test } from "bun:test";
import {
  AponiaError,
  createDto,
  getValidationMetadata,
  resolveRouteValidator,
} from "@aponiajs/common";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { IntersectionType, OmitType, PartialType, PickType } from "./index.ts";

describe("@aponiajs/mapped-types", () => {
  test("derives PartialType, PickType, OmitType, and IntersectionType schemas from TypeBox DTOs", () => {
    class CreateUserDto extends createDto(
      Type.Object({
        id: Type.String(),
        email: Type.String(),
        password: Type.String(),
      }),
    ) {}

    class UpdateUserDto extends PartialType(CreateUserDto) {}
    class LoginDto extends PickType(CreateUserDto, ["email", "password"] as const) {}
    class PublicUserDto extends OmitType(CreateUserDto, ["password"] as const) {}
    class ExtraDto extends createDto(Type.Object({ role: Type.String() })) {}
    class FullUserDto extends IntersectionType(PublicUserDto, ExtraDto) {}

    const partialSchema = resolveRouteValidator(UpdateUserDto) as never;
    expect(Value.Check(partialSchema, {})).toBe(true);
    expect(Value.Check(partialSchema, { email: "a@b.c" })).toBe(true);
    expect(Value.Check(partialSchema, { email: 123 })).toBe(false);

    const pickSchema = resolveRouteValidator(LoginDto) as never;
    expect(Value.Check(pickSchema, { email: "a@b.c", password: "secret" })).toBe(true);
    expect(Value.Check(pickSchema, { email: "a@b.c" })).toBe(false);

    const omitSchema = resolveRouteValidator(PublicUserDto) as never;
    expect(Value.Check(omitSchema, { id: "1", email: "a@b.c" })).toBe(true);
    expect(Value.Check(omitSchema, { id: "1" })).toBe(false);

    const intersectionSchema = resolveRouteValidator(FullUserDto) as never;
    expect(Value.Check(intersectionSchema, { id: "1", email: "a@b.c", role: "admin" })).toBe(true);
    expect(Value.Check(intersectionSchema, { id: "1", email: "a@b.c" })).toBe(false);
  });

  test("supports plain classes without validation metadata and rejects mismatched intersections", () => {
    class PlainBase {
      name = "base";
    }
    class PlainPartial extends PartialType(PlainBase) {}
    class PlainPick extends PickType(PlainBase, ["name"] as const) {}
    class PlainOmit extends OmitType(PlainBase, ["name"] as const) {}
    class PlainMerged extends IntersectionType(PlainBase, PlainBase) {}

    expect(getValidationMetadata(PlainPartial as never)).toBeUndefined();
    expect(getValidationMetadata(PlainPick as never)).toBeUndefined();
    expect(getValidationMetadata(PlainOmit as never)).toBeUndefined();
    expect(getValidationMetadata(PlainMerged as never)).toBeUndefined();

    class SchemaDto extends createDto(Type.Object({ a: Type.String() })) {}
    expect(() => IntersectionType(SchemaDto, PlainBase)).toThrow(AponiaError);
  });
});
