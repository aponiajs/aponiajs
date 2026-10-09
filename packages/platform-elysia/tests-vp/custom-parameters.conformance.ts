import {
  Controller,
  createParamDecorator,
  Get,
  Module,
  ParseIntPipe,
  type PipeTransform,
  type RouteContext,
} from "@aponiajs/common";
import { AponiaFactory } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

interface RequestUser {
  id: number;
  name: string;
}

const CurrentUser = createParamDecorator<keyof RequestUser | undefined, unknown>(
  (data, context: RouteContext) => {
    const user = (context as { user?: RequestUser }).user;
    if (user === undefined) {
      return undefined;
    }
    return data ? user[data] : user;
  },
);

class PrefixPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    return typeof value === "string" ? `hello-${value}` : value;
  }
}

@Controller("vp-custom")
class VpCustomParamController {
  @Get("me")
  getMe(@CurrentUser() user: RequestUser) {
    return { user };
  }

  @Get("piped")
  getPiped(@CurrentUser("name", PrefixPipe) name: string) {
    return { name };
  }

  @Get("int")
  getInt(@CurrentUser("id", ParseIntPipe) id: number) {
    return { id, type: typeof id };
  }
}

@Module({
  controllers: [VpCustomParamController],
})
class VpCustomParamModule {}

test("resolves custom parameters on route dispatch in Vite+ lane", async () => {
  const app = await AponiaFactory.create(VpCustomParamModule, {
    logger: false,
    configureNative: (elysia) => {
      return elysia.derive(() => ({
        user: { id: 7, name: "Charlie" },
      }));
    },
  });

  const response = await app.handle(new Request("http://localhost/vp-custom/me"));
  expect(response.status).toBe(200);
  const body = (await response.json()) as { user: RequestUser };
  expect(body.user).toEqual({ id: 7, name: "Charlie" });
});

test("runs pipe transforms on custom parameters in Vite+ lane", async () => {
  const app = await AponiaFactory.create(VpCustomParamModule, {
    logger: false,
    configureNative: (elysia) => {
      return elysia.derive(() => ({
        user: { id: "99", name: "World" },
      }));
    },
  });

  const resPiped = await app.handle(new Request("http://localhost/vp-custom/piped"));
  expect(resPiped.status).toBe(200);
  expect(await resPiped.json()).toEqual({ name: "hello-World" });

  const resInt = await app.handle(new Request("http://localhost/vp-custom/int"));
  expect(resInt.status).toBe(200);
  expect(await resInt.json()).toEqual({ id: 99, type: "number" });
});
