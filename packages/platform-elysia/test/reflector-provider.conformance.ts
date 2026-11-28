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

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

const Roles = (...roles: readonly string[]) => SetMetadata("roles", roles);

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
}

@Module({
  controllers: [ReflectorController],
  providers: [RoleGuard],
})
class ReflectionModule {}

test("the Vite+ lane resolves Reflector without a module registering it", async () => {
  const application = await AponiaFactory.create(ReflectionModule, { logger: false });

  try {
    expect(application.get(Reflector)).toBeInstanceOf(Reflector);
    expect((await application.handle(new Request("http://localhost/reflector/admin"))).status).toBe(
      200,
    );
    expect(
      (await application.handle(new Request("http://localhost/reflector/editor"))).status,
    ).toBe(403);
  } finally {
    await application.close();
  }
});
