import { describe, expect, test } from "bun:test";
import {
  Controller,
  Get,
  Injectable,
  Module,
  Scope,
  UseFilters,
  UseGuards,
  UseInterceptors,
  type ArgumentsHost,
  type CanActivate,
  type ExceptionFilter,
  type ExecutionContext,
  type Interceptor,
} from "@aponiajs/common";
import {
  AponiaFactory,
  RequestContextModule,
  RequestContextService,
  httpErrors,
} from "../src/index.ts";

let guardInstances = 0;
let interceptorInstances = 0;

@Injectable({ scope: Scope.REQUEST })
class RequestScopedGuardDependency {
  readonly id = ++guardInstances;

  constructor(readonly requestContext: RequestContextService) {}
}

@Injectable()
class ScopedGuard implements CanActivate {
  constructor(private readonly dependency: RequestScopedGuardDependency) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await new Promise((resolve) => setTimeout(resolve, 5));
    context.switchToHttp().getRequest().set.headers["x-guard"] = String(this.dependency.id);
    return true;
  }
}

@Injectable({ scope: Scope.REQUEST })
class ScopedInterceptor implements Interceptor {
  readonly id = ++interceptorInstances;

  interceptBefore(context: ExecutionContext): void {
    context.switchToHttp().getRequest().set.headers["x-interceptor"] = String(this.id);
  }

  interceptAfter(_context: ExecutionContext, response: unknown): unknown {
    return { wrapped: response };
  }
}

@Injectable({ scope: Scope.REQUEST })
class ScopedFilter implements ExceptionFilter {
  catch(_exception: unknown, host: ArgumentsHost): Response {
    // The transport switches are reachable from a filter even on an HTTP route.
    host.switchToRpc().getData();
    host.switchToWs().getData();
    return new Response("filtered", { status: 418 });
  }
}

@Controller("scoped")
@UseGuards(ScopedGuard)
@UseInterceptors(ScopedInterceptor)
class ScopedController {
  @Get("ok")
  ok(): { readonly ok: boolean } {
    return { ok: true };
  }

  @Get("fail")
  @UseFilters(ScopedFilter)
  fail(): string {
    throw httpErrors.badRequest("refused");
  }
}

@Module({
  imports: [RequestContextModule.forRoot()],
  controllers: [ScopedController],
  providers: [RequestScopedGuardDependency, ScopedGuard, ScopedInterceptor, ScopedFilter],
})
class ScopedModule {}

describe("request-scoped enhancers", () => {
  test("resolve a request-scoped guard, interceptor, and filter per request", async () => {
    const application = await AponiaFactory.create(ScopedModule, { logger: false });

    try {
      const [first, second] = await Promise.all([
        application.handle(new Request("http://localhost/scoped/ok")),
        application.handle(new Request("http://localhost/scoped/ok")),
      ]);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(await first.json()).toEqual({ wrapped: { ok: true } });
      expect(await second.json()).toEqual({ wrapped: { ok: true } });

      const firstId = first.headers.get("x-guard");
      const secondId = second.headers.get("x-guard");
      expect(firstId).not.toBeNull();
      expect(secondId).not.toBeNull();
      expect(firstId).not.toBe(secondId);

      const interceptorIds = new Set([
        first.headers.get("x-interceptor"),
        second.headers.get("x-interceptor"),
      ]);
      expect(interceptorIds.size).toBe(2);

      const filtered = await application.handle(new Request("http://localhost/scoped/fail"));
      expect(filtered.status).toBe(418);
      expect(await filtered.text()).toBe("filtered");
    } finally {
      await application.close();
    }
  });
});
