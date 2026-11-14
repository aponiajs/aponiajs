import { describe, expect, it } from "bun:test";
import { StaticRouteExecutionContext } from "../src/enhancers/static-execution-context.ts";

describe("StaticRouteExecutionContext", () => {
  it("forks one instance per request instead of sharing a mutable pointer", () => {
    class SampleController {
      testMethod(this: void) {}
    }
    const instance = new SampleController();
    const prototype = new StaticRouteExecutionContext(instance, instance.testMethod);

    const req1 = { request: new Request("http://localhost/1") } as any;
    const req2 = { request: new Request("http://localhost/2") } as any;

    const first = prototype.fork(req1);
    const second = prototype.fork(req2);

    expect(first).not.toBe(second);
    expect(first.getContext()).toBe(req1);
    expect(second.getContext()).toBe(req2);
    expect(first.getRequest()).toBe(req1);
    expect(second.getRequest()).toBe(req2);
    expect(first.getClass()).toBe(SampleController);
    expect(second.getHandler()).toBe(instance.testMethod);
    expect(first.switchToHttp()).toBe(first);
    expect(first.getType()).toBe("http");
    expect(first.getRoute()).toEqual({ method: "GET", path: "/" });
    expect(prototype.getContext()).toBeNull();
  });

  it("keeps the route identity across forks and accepts a custom route", () => {
    class SampleController {
      testMethod(this: void) {}
    }
    const instance = new SampleController();
    const customRoute = { method: "POST" as const, path: "/users" };
    const prototype = new StaticRouteExecutionContext(
      SampleController,
      instance.testMethod,
      customRoute,
    );
    const request = { request: new Request("http://localhost/users") } as any;
    const forked = prototype.fork(request);

    expect(forked.getClass()).toBe(SampleController);
    expect(forked.getHandler()).toBe(instance.testMethod);
    expect(forked.getRoute()).toBe(customRoute);
    expect(forked.getContext()).toBe(request);
  });
});
