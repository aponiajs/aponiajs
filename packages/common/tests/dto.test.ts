import { describe, expect, it } from "bun:test";
import { Type } from "typebox";
import { z } from "zod";
import { createDto, type Infer } from "../src/routing/dto.ts";
import { Post, getRouteMetadata, resolveRouteValidator } from "../src/index.ts";

describe("createDto & Standard Schema / TypeBox Ergonomics", () => {
  it("derives class constructor with validation token from Standard Schema (Zod)", () => {
    const UserSchema = z.object({
      email: z.string().email(),
      name: z.string().min(2),
    });

    class UserDto extends createDto(UserSchema) {}
    type User = Infer<typeof UserDto>;

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

  it("derives class constructor directly from TypeBox schema without wrappers", () => {
    const ItemSchema = Type.Object({
      id: Type.Number(),
      title: Type.String(),
    });

    class ItemDto extends createDto(ItemSchema) {}
    type Item = Infer<typeof ItemDto>;

    const BaseItemClass = createDto(ItemSchema);
    const baseInstance = new BaseItemClass();
    expect(baseInstance).toBeDefined();

    const instance = new ItemDto();
    expect(instance).toBeDefined();
    expect(Reflect.getMetadata(Symbol.for("aponia.validation.metadata"), ItemDto)).toBe(ItemSchema);
    expect(ItemDto.schema).toBe(ItemSchema);

    const item: Item = { id: 10, title: "Anvil" };
    expect(item.id).toBe(10);
    expect(item.title).toBe("Anvil");

    expect(resolveRouteValidator(ItemDto)).toBe(ItemSchema);
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

  it("allows passing raw TypeBox schema directly into route decorator", () => {
    const RawTypeBoxSchema = Type.Object({ count: Type.Number() });

    class TestController {
      @Post("/", { body: RawTypeBoxSchema })
      submit() {}
    }

    const [route] = getRouteMetadata(TestController);
    expect(route?.schema?.body).toBe(RawTypeBoxSchema);
  });

  it("resolves route validators for both DTO classes and raw schemas", () => {
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
