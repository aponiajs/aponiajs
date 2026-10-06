import {
  Controller,
  Get,
  Reflector,
  SetMetadata,
  createParamDecorator,
  getRouteParameterMetadata,
  type RouteContext,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

const Roles = (...roles: string[]) => SetMetadata("roles", roles);

const CurrentUserId = createParamDecorator<undefined, string>((_data, _ctx) => "user-42");

@Roles("manager")
@Controller("vp-reflector")
class VpReflectorController {
  @Roles("admin")
  @Get("admin")
  getAdmin(this: void, @CurrentUserId() userId: string) {
    return { userId };
  }
}

test("the Vite+ lane retrieves metadata via Reflector", () => {
  const reflector = new Reflector();
  const methodHandler = VpReflectorController.prototype.getAdmin;

  expect(reflector.get("roles", VpReflectorController)).toEqual(["manager"]);
  expect(reflector.get("roles", methodHandler)).toEqual(["admin"]);
  expect(reflector.getAllAndOverride("roles", [methodHandler, VpReflectorController])).toEqual([
    "admin",
  ]);
});

test("the Vite+ lane registers custom parameter decorators", () => {
  const params = getRouteParameterMetadata(VpReflectorController, "getAdmin");
  expect(params.length).toBe(1);
  expect(params[0].kind).toBe("custom");
  expect(params[0].factory?.(undefined, {} as RouteContext)).toBe("user-42");
});
