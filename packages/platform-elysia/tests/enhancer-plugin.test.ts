import { describe, expect, test } from "bun:test";
import {
  Controller,
  Get,
  Injectable,
  Module,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from "@aponiajs/common";
import { AponiaFactory } from "../src/application/aponia-factory.ts";
import { createEnhancerPlugin } from "../src/plugins/enhancer-plugin.ts";

@Injectable()
class SecurityGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const authHeader = context.switchToHttp().getRequest().headers["authorization"];
    return authHeader === "Bearer secret-token";
  }
}

const SecurityModule = createEnhancerPlugin({
  name: "security",
  guards: [SecurityGuard],
});

@Controller("secure")
class SecureController {
  @Get("/")
  @UseGuards(SecurityGuard)
  getSecure(): string {
    return "secret data";
  }
}

describe("createEnhancerPlugin", () => {
  test("exports guards and mounts them seamlessly with forRoot", async () => {
    @Module({
      controllers: [SecureController],
      imports: [SecurityModule.forRoot()],
    })
    class AppModule {}

    const app = await AponiaFactory.create(AppModule, { logger: false });

    try {
      // 1. Without auth -> 403 Forbidden
      const unauthRes = await app.handle(new Request("http://localhost/secure"));
      expect(unauthRes.status).toBe(403);

      // 2. With auth -> 200 OK
      const authRes = await app.handle(
        new Request("http://localhost/secure", {
          headers: { authorization: "Bearer secret-token" },
        }),
      );
      expect(authRes.status).toBe(200);
      expect(await authRes.text()).toBe("secret data");
    } finally {
      await app.close();
    }
  });

  test("supports asynchronous configuration with forRootAsync", async () => {
    @Module({
      controllers: [SecureController],
      imports: [
        SecurityModule.forRootAsync({
          useFactory: () => ({ enabled: true }),
        }),
      ],
    })
    class AppModule {}

    const app = await AponiaFactory.create(AppModule, { logger: false });

    try {
      const authRes = await app.handle(
        new Request("http://localhost/secure", {
          headers: { authorization: "Bearer secret-token" },
        }),
      );
      expect(authRes.status).toBe(200);
    } finally {
      await app.close();
    }
  });
});
