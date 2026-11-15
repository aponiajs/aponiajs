import { describe, expect, test } from "bun:test";
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

interface RequestUser {
  id: number;
  name: string;
  role: string;
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

const RequestHeaderToken = createParamDecorator<string, string | undefined>(
  (headerName, context: RouteContext) => {
    if (!headerName) {
      return undefined;
    }
    return context.request.headers.get(headerName) ?? undefined;
  },
);

class UpperCasePipe implements PipeTransform<string, string> {
  transform(value: string): string {
    return typeof value === "string" ? value.toUpperCase() : value;
  }
}

@Controller("custom-param")
class CustomParamController {
  @Get("full-user")
  getFullUser(@CurrentUser() user: RequestUser) {
    return { user };
  }

  @Get("user-field")
  getUserField(@CurrentUser("name") name: string, @CurrentUser("role") role: string) {
    return { name, role };
  }

  @Get("piped")
  getPipedUserRole(@CurrentUser("role", UpperCasePipe) role: string) {
    return { role };
  }

  @Get("header-token")
  getToken(@RequestHeaderToken("x-custom-token") token: string) {
    return { token };
  }

  @Get("piped-num")
  getPipedNum(@CurrentUser("id", ParseIntPipe) id: number) {
    return { id, type: typeof id };
  }
}

@Module({
  controllers: [CustomParamController],
})
class CustomParamModule {}

describe("Custom parameter decorators in @aponiajs/platform-elysia", () => {
  test("extracts custom parameter without pipes", async () => {
    const app = await AponiaFactory.create(CustomParamModule, {
      logger: false,
      configureNative: (elysia) => {
        return elysia.derive(() => ({
          user: { id: 42, name: "Alice", role: "admin" },
        }));
      },
    });

    const response = await app.handle(new Request("http://localhost/custom-param/full-user"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: RequestUser };
    expect(body.user).toEqual({ id: 42, name: "Alice", role: "admin" });
  });

  test("extracts specific field via custom parameter decorator data argument", async () => {
    const app = await AponiaFactory.create(CustomParamModule, {
      logger: false,
      configureNative: (elysia) => {
        return elysia.derive(() => ({
          user: { id: 42, name: "Alice", role: "admin" },
        }));
      },
    });

    const response = await app.handle(new Request("http://localhost/custom-param/user-field"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { name: string; role: string };
    expect(body).toEqual({ name: "Alice", role: "admin" });
  });

  test("executes parameter pipes after custom parameter factory extraction", async () => {
    const app = await AponiaFactory.create(CustomParamModule, {
      logger: false,
      configureNative: (elysia) => {
        return elysia.derive(() => ({
          user: { id: 42, name: "Alice", role: "admin" },
        }));
      },
    });

    const response = await app.handle(new Request("http://localhost/custom-param/piped"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { role: string };
    expect(body).toEqual({ role: "ADMIN" });
  });

  test("extracts raw native request headers via custom parameter", async () => {
    const app = await AponiaFactory.create(CustomParamModule, {
      logger: false,
    });

    const response = await app.handle(
      new Request("http://localhost/custom-param/header-token", {
        headers: { "x-custom-token": "secret-xyz" },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { token: string };
    expect(body).toEqual({ token: "secret-xyz" });
  });

  test("combines custom parameter extraction with ParseIntPipe", async () => {
    const app = await AponiaFactory.create(CustomParamModule, {
      logger: false,
      configureNative: (elysia) => {
        return elysia.derive(() => ({
          user: { id: "123", name: "Bob", role: "user" },
        }));
      },
    });

    const response = await app.handle(new Request("http://localhost/custom-param/piped-num"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: number; type: string };
    expect(body).toEqual({ id: 123, type: "number" });
  });
});
