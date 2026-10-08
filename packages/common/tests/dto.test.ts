import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { createDto, type Infer } from "../src/routing/dto.ts";
import { Post, getRouteMetadata, resolveRouteValidator } from "../src/index.ts";

describe("createDto & Standard Schema Ergonomics", () => {
  it("derives class constructor with validation token from Standard Schema", () => {
    const UserSchema = z.object({
      email: z.string().email(),
      name: z.string().min(2),
    });

    class UserDto extends createDto(UserSchema) {}
    type User = Infer<typeof UserSchema>;

    const BaseClass = createDto(UserSchema);
    const baseInstance = new BaseClass();
    expect(baseInstance).toBeDefined();

    const instance = new UserDto();
    expect(instance).toBeDefined();
    expect(Reflect.getMetadata(Symbol.for("aponia.validation.metadata"), UserDto)).toBe(UserSchema);
    expect(UserDto.schema).toBe(UserSchema);

    const user: User = { email: "alice@example.com", name: "Alice" };
    expect(user.email).toBe("alice@example.com");
  });

  it("allows passing raw Standard Schema directly into route decorator", () => {
    const RawSchema = z.object({ id: z.string() });

    class TestController {
      @Post("/", { body: RawSchema })
      submit() {}
    }

    const [route] = getRouteMetadata(TestController);
    expect(route?.schema?.body).toBe(RawSchema);
  });

  it("resolves route validators for both DTO classes and raw Standard Schema", () => {
    const UserSchema = z.object({ id: z.string() });
    class UserDto extends createDto(UserSchema) {}
    class ExtendedUserDto extends UserDto {}

    expect(resolveRouteValidator(UserDto)).toBe(UserSchema);
    expect(resolveRouteValidator(ExtendedUserDto)).toBe(UserSchema);
    expect(resolveRouteValidator(UserSchema)).toBe(UserSchema);
  });

  it("supports DTO classes directly in route schemas", () => {
    const UserSchema = z.object({ name: z.string() });
    class UserDto extends createDto(UserSchema) {}

    class UserController {
      @Post("/users", { body: UserDto })
      create() {}
    }

    const [route] = getRouteMetadata(UserController);
    expect(route?.schema?.body).toBe(UserDto);
  });
});
