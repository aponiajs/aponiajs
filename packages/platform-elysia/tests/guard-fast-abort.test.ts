import { describe, expect, it } from "bun:test";
import {
  Controller,
  Get,
  Injectable,
  Module,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from "@aponiajs/common";
import { AponiaFactory } from "../src/index.ts";

describe("Fast-Abort Guards End-to-End", () => {
  const auditLog: string[] = [];

  @Injectable()
  class FastDenyGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      auditLog.push(`deny:${context.getRoute().path}`);
      return false;
    }
  }

  @Injectable()
  class FastAllowGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      auditLog.push(`allow:${context.getRoute().path}`);
      return true;
    }
  }

  @Controller("fast-guard")
  class FastGuardController {
    @Get("protected")
    @UseGuards(FastDenyGuard)
    secret(): string {
      auditLog.push("secret-invoked");
      return "secret";
    }

    @Get("allowed")
    @UseGuards(FastAllowGuard)
    open(): string {
      auditLog.push("open-invoked");
      return "open";
    }
  }

  @Module({
    controllers: [FastGuardController],
    providers: [FastDenyGuard, FastAllowGuard],
  })
  class GuardTestModule {}

  it("fast-aborts on refusal with 403 without invoking handler", async () => {
    auditLog.length = 0;
    const app = await AponiaFactory.create(GuardTestModule, { logger: false });

    const response = await app.handle(new Request("http://localhost/fast-guard/protected"));
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(auditLog).toEqual(["deny:/fast-guard/protected"]);
    await app.close();
  });

  it("allows requests when guard returns true", async () => {
    auditLog.length = 0;
    const app = await AponiaFactory.create(GuardTestModule, { logger: false });

    const response = await app.handle(new Request("http://localhost/fast-guard/allowed"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("open");
    expect(auditLog).toEqual(["allow:/fast-guard/allowed", "open-invoked"]);
    await app.close();
  });
});
