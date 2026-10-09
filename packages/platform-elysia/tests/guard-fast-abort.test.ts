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
import { compileGuardsHook, compileUnrolledGuards } from "../src/enhancers/enhancer-pipeline.ts";
import { StaticRouteExecutionContext } from "../src/enhancers/static-execution-context.ts";

describe("compileUnrolledGuards", () => {
  it("returns undefined when guards array is empty", () => {
    const execCtx = new StaticRouteExecutionContext({}, () => {});
    const hook = compileUnrolledGuards([], execCtx, "forbidden");
    expect(hook).toBeUndefined();
  });

  it("exports compileGuardsHook as an alias", () => {
    expect(compileGuardsHook).toBe(compileUnrolledGuards);
  });

  it("handles a single synchronous guard that allows", () => {
    const execCtx = new StaticRouteExecutionContext({}, () => {});
    const guard: CanActivate = {
      canActivate: (ctx) => {
        expect(ctx.getContext()).toBe(fakeContext);
        return true;
      },
    };
    const hook = compileUnrolledGuards([guard], execCtx, { error: "forbidden" });
    expect(hook).toBeDefined();

    const fakeContext = { set: { status: 200 } } as any;
    const result = hook!(fakeContext);
    expect(result).toBeUndefined();
    expect(fakeContext.set.status).toBe(200);
  });

  it("handles a single synchronous guard that fast-aborts", () => {
    const execCtx = new StaticRouteExecutionContext({}, () => {});
    const guard: CanActivate = {
      canActivate: () => false,
    };
    const hook = compileUnrolledGuards([guard], execCtx, { error: "forbidden" });

    const fakeContext = { set: { status: 200 } } as any;
    const result = hook!(fakeContext);
    expect(result).toEqual({ error: "forbidden" });
    expect(fakeContext.set.status).toBe(403);
  });

  it("handles a single asynchronous guard that allows", async () => {
    const execCtx = new StaticRouteExecutionContext({}, () => {});
    const guard: CanActivate = {
      canActivate: async () => true,
    };
    const hook = compileUnrolledGuards([guard], execCtx, "denied");

    const fakeContext = { set: { status: 200 } } as any;
    const result = await hook!(fakeContext);
    expect(result).toBeUndefined();
    expect(fakeContext.set.status).toBe(200);
  });

  it("handles a single asynchronous guard that fast-aborts", async () => {
    const execCtx = new StaticRouteExecutionContext({}, () => {});
    const guard: CanActivate = {
      canActivate: async () => false,
    };
    const hook = compileUnrolledGuards([guard], execCtx, "denied");

    const fakeContext = { set: { status: 200 } } as any;
    const result = await hook!(fakeContext);
    expect(result).toBe("denied");
    expect(fakeContext.set.status).toBe(403);
  });

  it("handles two guards: first refuses so second is never called", () => {
    const execCtx = new StaticRouteExecutionContext({}, () => {});
    let secondCalled = false;
    const g1: CanActivate = { canActivate: () => false };
    const g2: CanActivate = {
      canActivate: () => {
        secondCalled = true;
        return true;
      },
    };

    const hook = compileUnrolledGuards([g1, g2], execCtx, "blocked");
    const fakeContext = { set: { status: 200 } } as any;
    const result = hook!(fakeContext);

    expect(result).toBe("blocked");
    expect(fakeContext.set.status).toBe(403);
    expect(secondCalled).toBe(false);
  });

  it("handles two guards: first allows and second refuses", () => {
    const execCtx = new StaticRouteExecutionContext({}, () => {});
    const g1: CanActivate = { canActivate: () => true };
    const g2: CanActivate = { canActivate: () => false };

    const hook = compileUnrolledGuards([g1, g2], execCtx, "blocked");
    const fakeContext = { set: { status: 200 } } as any;
    const result = hook!(fakeContext);

    expect(result).toBe("blocked");
    expect(fakeContext.set.status).toBe(403);
  });

  it("handles two guards: both synchronous allow", () => {
    const execCtx = new StaticRouteExecutionContext({}, () => {});
    const g1: CanActivate = { canActivate: () => true };
    const g2: CanActivate = { canActivate: () => true };

    const hook = compileUnrolledGuards([g1, g2], execCtx, "blocked");
    const fakeContext = { set: { status: 200 } } as any;
    const result = hook!(fakeContext);

    expect(result).toBeUndefined();
    expect(fakeContext.set.status).toBe(200);
  });

  it("handles two guards: first async allows and second sync allows", async () => {
    const execCtx = new StaticRouteExecutionContext({}, () => {});
    const g1: CanActivate = { canActivate: async () => true };
    const g2: CanActivate = { canActivate: () => true };

    const hook = compileUnrolledGuards([g1, g2], execCtx, "blocked");
    const fakeContext = { set: { status: 200 } } as any;
    const result = await hook!(fakeContext);

    expect(result).toBeUndefined();
    expect(fakeContext.set.status).toBe(200);
  });

  it("handles two guards: first async allows and second sync refuses", async () => {
    const execCtx = new StaticRouteExecutionContext({}, () => {});
    const g1: CanActivate = { canActivate: async () => true };
    const g2: CanActivate = { canActivate: () => false };

    const hook = compileUnrolledGuards([g1, g2], execCtx, "blocked");
    const fakeContext = { set: { status: 200 } } as any;
    const result = await hook!(fakeContext);

    expect(result).toBe("blocked");
    expect(fakeContext.set.status).toBe(403);
  });

  it("handles two guards: first sync allows and second async refuses", async () => {
    const execCtx = new StaticRouteExecutionContext({}, () => {});
    const g1: CanActivate = { canActivate: () => true };
    const g2: CanActivate = { canActivate: async () => false };

    const hook = compileUnrolledGuards([g1, g2], execCtx, "blocked");
    const fakeContext = { set: { status: 200 } } as any;
    const result = await hook!(fakeContext);

    expect(result).toBe("blocked");
    expect(fakeContext.set.status).toBe(403);
  });

  it("handles three guards where first allows and second async refuses", async () => {
    const execCtx = new StaticRouteExecutionContext({}, () => {});
    let g3Called = false;
    const g1: CanActivate = { canActivate: () => true };
    const g2: CanActivate = { canActivate: async () => false };
    const g3: CanActivate = {
      canActivate: () => {
        g3Called = true;
        return true;
      },
    };

    const hook = compileUnrolledGuards([g1, g2, g3], execCtx, "blocked");
    const fakeContext = { set: { status: 200 } } as any;
    const result = await hook!(fakeContext);

    expect(result).toBe("blocked");
    expect(fakeContext.set.status).toBe(403);
    expect(g3Called).toBe(false);
  });

  it("handles three guards with mixed sync and async execution", async () => {
    const execCtx = new StaticRouteExecutionContext({}, () => {});
    let g3Called = false;
    const g1: CanActivate = { canActivate: () => true };
    const g2: CanActivate = { canActivate: async () => true };
    const g3: CanActivate = {
      canActivate: () => {
        g3Called = true;
        return false;
      },
    };

    const hook = compileUnrolledGuards([g1, g2, g3], execCtx, "blocked");
    const fakeContext = { set: { status: 200 } } as any;
    const result = await hook!(fakeContext);

    expect(result).toBe("blocked");
    expect(fakeContext.set.status).toBe(403);
    expect(g3Called).toBe(true);
  });

  it("handles two guards: first async refuses", async () => {
    const execCtx = new StaticRouteExecutionContext({}, () => {});
    const g1: CanActivate = { canActivate: async () => false };
    const g2: CanActivate = { canActivate: () => true };

    const hook = compileUnrolledGuards([g1, g2], execCtx, "blocked");
    const fakeContext = { set: { status: 200 } } as any;
    const result = await hook!(fakeContext);

    expect(result).toBe("blocked");
    expect(fakeContext.set.status).toBe(403);
  });

  it("handles two guards: first async allows and second async refuses", async () => {
    const execCtx = new StaticRouteExecutionContext({}, () => {});
    const g1: CanActivate = { canActivate: async () => true };
    const g2: CanActivate = { canActivate: async () => false };

    const hook = compileUnrolledGuards([g1, g2], execCtx, "blocked");
    const fakeContext = { set: { status: 200 } } as any;
    const result = await hook!(fakeContext);

    expect(result).toBe("blocked");
    expect(fakeContext.set.status).toBe(403);
  });

  it("handles two guards: both async allow", async () => {
    const execCtx = new StaticRouteExecutionContext({}, () => {});
    const g1: CanActivate = { canActivate: async () => true };
    const g2: CanActivate = { canActivate: async () => true };

    const hook = compileUnrolledGuards([g1, g2], execCtx, "blocked");
    const fakeContext = { set: { status: 200 } } as any;
    const result = await hook!(fakeContext);

    expect(result).toBeUndefined();
    expect(fakeContext.set.status).toBe(200);
  });

  it("handles two guards: first sync allows and second async allows", async () => {
    const execCtx = new StaticRouteExecutionContext({}, () => {});
    const g1: CanActivate = { canActivate: () => true };
    const g2: CanActivate = { canActivate: async () => true };

    const hook = compileUnrolledGuards([g1, g2], execCtx, "blocked");
    const fakeContext = { set: { status: 200 } } as any;
    const result = await hook!(fakeContext);

    expect(result).toBeUndefined();
    expect(fakeContext.set.status).toBe(200);
  });

  it("handles three guards all synchronous that allow", () => {
    const execCtx = new StaticRouteExecutionContext({}, () => {});
    const g1: CanActivate = { canActivate: () => true };
    const g2: CanActivate = { canActivate: () => true };
    const g3: CanActivate = { canActivate: () => true };

    const hook = compileUnrolledGuards([g1, g2, g3], execCtx, "blocked");
    const fakeContext = { set: { status: 200 } } as any;
    const result = hook!(fakeContext);

    expect(result).toBeUndefined();
    expect(fakeContext.set.status).toBe(200);
  });

  it("handles three guards synchronous where second refuses", () => {
    const execCtx = new StaticRouteExecutionContext({}, () => {});
    let g3Called = false;
    const g1: CanActivate = { canActivate: () => true };
    const g2: CanActivate = { canActivate: () => false };
    const g3: CanActivate = {
      canActivate: () => {
        g3Called = true;
        return true;
      },
    };

    const hook = compileUnrolledGuards([g1, g2, g3], execCtx, "blocked");
    const fakeContext = { set: { status: 200 } } as any;
    const result = hook!(fakeContext);

    expect(result).toBe("blocked");
    expect(fakeContext.set.status).toBe(403);
    expect(g3Called).toBe(false);
  });

  it("handles multiple guards with chained async continuations that pass", async () => {
    const execCtx = new StaticRouteExecutionContext({}, () => {});
    const g1: CanActivate = { canActivate: () => true };
    const g2: CanActivate = { canActivate: async () => true };
    const g3: CanActivate = { canActivate: async () => true };
    const g4: CanActivate = { canActivate: () => true };

    const hook = compileUnrolledGuards([g1, g2, g3, g4], execCtx, "blocked");
    const fakeContext = { set: { status: 200 } } as any;
    const result = await hook!(fakeContext);

    expect(result).toBeUndefined();
    expect(fakeContext.set.status).toBe(200);
  });

  it("handles multiple guards with chained async continuation where later sync refuses", async () => {
    const execCtx = new StaticRouteExecutionContext({}, () => {});
    const g1: CanActivate = { canActivate: () => true };
    const g2: CanActivate = { canActivate: async () => true };
    const g3: CanActivate = { canActivate: () => false };

    const hook = compileUnrolledGuards([g1, g2, g3], execCtx, "blocked");
    const fakeContext = { set: { status: 200 } } as any;
    const result = await hook!(fakeContext);

    expect(result).toBe("blocked");
    expect(fakeContext.set.status).toBe(403);
  });

  it("clones a Response if forbiddenResponse is a Response instance", () => {
    const execCtx = new StaticRouteExecutionContext({}, () => {});
    const responseTemplate = new Response("Forbidden Message", {
      status: 403,
      headers: { "Content-Type": "application/problem+json" },
    });
    const g1: CanActivate = { canActivate: () => false };

    const hook = compileUnrolledGuards([g1], execCtx, responseTemplate);
    const fakeContext = { set: { status: 200 } } as any;

    const res1 = hook!(fakeContext) as Response;
    expect(res1).toBeInstanceOf(Response);
    expect(res1).not.toBe(responseTemplate);
    expect(fakeContext.set.status).toBe(403);

    const res2 = hook!(fakeContext) as Response;
    expect(res2).toBeInstanceOf(Response);
    expect(res2).not.toBe(responseTemplate);
  });
});

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
