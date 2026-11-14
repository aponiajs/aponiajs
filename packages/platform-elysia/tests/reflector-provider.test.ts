import { describe, expect, test } from "bun:test";
import {
  Controller,
  Get,
  Injectable,
  Module,
  Reflector,
  SetMetadata,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from "@aponiajs/common";
import { AponiaFactory } from "../src/index.ts";

const Roles = (...roles: readonly string[]) => SetMetadata("roles", roles);

/** A guard that reads route metadata through a `Reflector` it never registers. */
@Injectable()
class RoleGuard implements CanActivate {
  constructor(readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<readonly string[]>("roles", [
      context.getHandler(),
      context.getClass(),
    ]);
    return roles === undefined || roles.includes("admin");
  }
}

@Controller("reflector")
@UseGuards(RoleGuard)
class ReflectorController {
  @Get("admin")
  @Roles("admin")
  admin(): { ok: boolean } {
    return { ok: true };
  }

  @Get("editor")
  @Roles("editor")
  editor(): { ok: boolean } {
    return { ok: true };
  }

  @Get("open")
  open(): { ok: boolean } {
    return { ok: true };
  }
}

@Module({
  controllers: [ReflectorController],
  providers: [RoleGuard],
})
class ReflectionModule {}

describe("Reflector as a predefined provider", () => {
  test("a guard resolves Reflector without a module registering it", async () => {
    const application = await AponiaFactory.create(ReflectionModule, { logger: false });

    try {
      expect(application.get(Reflector)).toBeInstanceOf(Reflector);

      const admin = await application.handle(new Request("http://localhost/reflector/admin"));
      expect(admin.status).toBe(200);

      const editor = await application.handle(new Request("http://localhost/reflector/editor"));
      expect(editor.status).toBe(403);

      const open = await application.handle(new Request("http://localhost/reflector/open"));
      expect(open.status).toBe(200);
    } finally {
      await application.close();
    }
  });
});
