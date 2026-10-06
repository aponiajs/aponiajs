import {
  Controller,
  Get,
  Injectable,
  Module,
  UseGuards,
  type ExecutionContext,
} from "@aponiajs/common";
import { AponiaFactory, AuthGuard } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

@Injectable()
class ConformanceAuthGuard extends AuthGuard {
  protected override validateToken(token: string, _context: ExecutionContext): boolean {
    return token === "secret";
  }
}

@Controller("test-guard")
@UseGuards(ConformanceAuthGuard)
class TestGuardController {
  @Get()
  get(): { success: boolean } {
    return { success: true };
  }
}

@Module({
  controllers: [TestGuardController],
  providers: [ConformanceAuthGuard],
})
class ConformanceModule {}

test("AuthGuard functions correctly in Vite+ lane", async () => {
  const app = await AponiaFactory.create(ConformanceModule, { logger: false });

  const denied = await app.handle(new Request("http://localhost/test-guard"));
  expect(denied.status).toBe(401);

  const allowed = await app.handle(
    new Request("http://localhost/test-guard", {
      headers: { authorization: "Bearer secret" },
    }),
  );
  expect(allowed.status).toBe(200);
  expect(await allowed.json()).toEqual({ success: true });

  await app.close();
});
