import { describe, expect, it } from "bun:test";
import { StaticRouteExecutionContext } from "../src/enhancers/static-execution-context.ts";

describe("StaticRouteExecutionContext", () => {
  it("reuses a single instance and updates rawContext pointer without allocations", () => {
    class SampleController {
      testMethod(this: void) {}
    }
    const instance = new SampleController();
    const execCtx = new StaticRouteExecutionContext(instance, instance.testMethod);

    const req1 = { request: new Request("http://localhost/1") } as any;
    execCtx.swap(req1);
    expect(execCtx.getContext()).toBe(req1);
    expect(execCtx.getClass()).toBe(SampleController);
    expect(execCtx.getHandler()).toBe(instance.testMethod);

    const req2 = { request: new Request("http://localhost/2") } as any;
    execCtx.swap(req2);
    expect(execCtx.getContext()).toBe(req2);
    expect(execCtx.getRequest()).toBe(req2);
    expect(execCtx.switchToHttp()).toBe(execCtx);
    expect(execCtx.getType()).toBe("http");
    expect(execCtx.getRoute()).toEqual({ method: "GET", path: "/" });

    const customRoute = { method: "POST" as const, path: "/users" };
    const customCtx = new StaticRouteExecutionContext(
      SampleController,
      instance.testMethod,
      customRoute,
    );
    expect(customCtx.getClass()).toBe(SampleController);
    expect(customCtx.getRoute()).toBe(customRoute);
  });
});
