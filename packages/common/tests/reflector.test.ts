import { describe, expect, test } from "bun:test";
import {
  Controller,
  createParamDecorator,
  getCustomMetadata,
  getRouteParameterMetadata,
  Get,
  Reflector,
  SetMetadata,
  type RouteContext,
} from "../src/index.ts";

const ROLES_KEY = "roles";
const Roles = (...roles: readonly string[]) => SetMetadata(ROLES_KEY, roles);

const IS_PUBLIC_KEY = "isPublic";
const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

const CurrentUser = createParamDecorator<string | undefined, unknown>((prop, _ctx) => {
  const user = { id: "123", name: "Alice", email: "alice@example.com" };
  return prop ? (user as Record<string, unknown>)[prop] : user;
});

@Roles("user")
@Controller("test")
class SampleController {
  @Roles("admin", "superadmin")
  @Get("admin")
  adminOnly(this: void, @CurrentUser() user: unknown, @CurrentUser("email") email: string) {
    return { user, email };
  }

  @Public()
  @Get("public")
  publicRoute(this: void) {
    return "ok";
  }
}

describe("SetMetadata and Reflector in @aponiajs/common", () => {
  const reflector = new Reflector();

  test("retrieves metadata on class and method via getCustomMetadata", () => {
    const classRoles = getCustomMetadata<readonly string[]>(ROLES_KEY, SampleController);
    expect(classRoles).toEqual(["user"]);

    const methodRoles = getCustomMetadata<readonly string[]>(
      ROLES_KEY,
      SampleController.prototype,
      "adminOnly",
    );
    expect(methodRoles).toEqual(["admin", "superadmin"]);
  });

  test("Reflector.get returns metadata on class or method target", () => {
    expect(reflector.get<readonly string[]>(ROLES_KEY, SampleController)).toEqual(["user"]);
    expect(
      reflector.get<readonly string[]>(ROLES_KEY, SampleController.prototype.adminOnly),
    ).toEqual(["admin", "superadmin"]);
  });

  test("Reflector.getAllAndOverride prioritizes method over class", () => {
    const methodHandler = SampleController.prototype.adminOnly;
    const resolvedRoles = reflector.getAllAndOverride<readonly string[]>(ROLES_KEY, [
      methodHandler,
      SampleController,
    ]);
    expect(resolvedRoles).toEqual(["admin", "superadmin"]);

    const publicHandler = SampleController.prototype.publicRoute;
    const resolvedPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      publicHandler,
      SampleController,
    ]);
    expect(resolvedPublic).toBe(true);

    const publicRoles = reflector.getAllAndOverride<readonly string[]>(ROLES_KEY, [
      publicHandler,
      SampleController,
    ]);
    expect(publicRoles).toEqual(["user"]);
  });

  test("Reflector.getAllAndMerge merges arrays across targets", () => {
    const methodHandler = SampleController.prototype.adminOnly;
    const mergedRoles = reflector.getAllAndMerge<readonly string[]>(ROLES_KEY, [
      methodHandler,
      SampleController,
    ]);
    expect(mergedRoles).toEqual(["admin", "superadmin", "user"]);
  });

  test("createParamDecorator records parameter metadata with factory", () => {
    const parameters = getRouteParameterMetadata(SampleController, "adminOnly");
    expect(parameters.length).toBe(2);

    expect(parameters[0].kind).toBe("custom");
    expect(parameters[0].index).toBe(0);
    expect(typeof parameters[0].factory).toBe("function");
    expect(parameters[0].data).toBeUndefined();

    expect(parameters[1].kind).toBe("custom");
    expect(parameters[1].index).toBe(1);
    expect(typeof parameters[1].factory).toBe("function");
    expect(parameters[1].data).toBe("email");

    const mockCtx = {} as RouteContext;
    const userVal = parameters[0].factory!(undefined, mockCtx);
    expect(userVal).toEqual({ id: "123", name: "Alice", email: "alice@example.com" });

    const emailVal = parameters[1].factory!("email", mockCtx);
    expect(emailVal).toBe("alice@example.com");
  });
});
