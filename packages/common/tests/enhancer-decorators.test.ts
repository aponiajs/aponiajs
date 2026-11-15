import { describe, expect, test } from "bun:test";
import {
  Catch,
  UseFilters,
  UseGuards,
  UseInterceptors,
  getCatchMetadata,
  getEnhancerMetadata,
} from "../src/index.ts";

class AuthGuard {}
class OwnerGuard {}
class AuditGuard {}
class TimingInterceptor {}

class NotFoundError extends Error {}

@Catch(NotFoundError)
class NotFoundFilter {}

@UseGuards(AuthGuard)
@UseInterceptors(TimingInterceptor)
class GuardedController {
  @UseGuards(OwnerGuard)
  @UseFilters(NotFoundFilter)
  read(): string {
    return "read";
  }

  unguarded(): string {
    return "unguarded";
  }
}

describe("enhancer decorators", () => {
  test("records guards declared on the controller", () => {
    const metadata = getEnhancerMetadata(GuardedController);

    expect(metadata.guards).toEqual([AuthGuard]);
  });

  test("records method enhancers against the method's own key", () => {
    const metadata = getEnhancerMetadata(GuardedController, "read");

    expect(metadata.guards).toEqual([OwnerGuard]);
    expect(metadata.filters).toEqual([NotFoundFilter]);
  });

  test("records the error types @Catch named on the filter class itself", () => {
    expect(getCatchMetadata(NotFoundFilter)).toEqual([NotFoundError]);
  });

  test("reports an empty catch list for a filter that declares none", () => {
    class CatchAllFilter {}

    expect(getCatchMetadata(CatchAllFilter)).toEqual([]);
  });

  test("reports empty collections for a method that declares none", () => {
    const metadata = getEnhancerMetadata(GuardedController, "unguarded");

    expect(metadata).toEqual({ guards: [], interceptors: [], filters: [] });
  });

  test("reports empty collections for a class that declares none", () => {
    class Plain {}

    expect(getEnhancerMetadata(Plain)).toEqual({ guards: [], interceptors: [], filters: [] });
  });

  test("rejects a value that is not a class", () => {
    expect(() => UseGuards("not a class" as never)).toThrow(TypeError);
  });

  test("rejects a call with no arguments", () => {
    expect(() => UseGuards()).toThrow(TypeError);
  });
});

describe("enhancer decorator metadata edges", () => {
  test("accumulates repeated declarations on one holder in application order", () => {
    class AccumulatingController {
      read(): string {
        return "read";
      }
    }

    UseGuards(AuthGuard)(AccumulatingController);
    UseGuards(OwnerGuard)(AccumulatingController);
    UseInterceptors(TimingInterceptor, AuditGuard)(
      AccumulatingController.prototype,
      "read",
      Object.getOwnPropertyDescriptor(AccumulatingController.prototype, "read")!,
    );

    expect(getEnhancerMetadata(AccumulatingController).guards).toEqual([AuthGuard, OwnerGuard]);
    expect(getEnhancerMetadata(AccumulatingController, "read").interceptors).toEqual([
      TimingInterceptor,
      AuditGuard,
    ]);
  });

  test("keeps a subclass from inheriting the enhancers its parent declared", () => {
    class ParentController {
      read(): string {
        return "read";
      }
    }
    class ChildController extends ParentController {}

    UseGuards(AuthGuard)(ParentController);
    UseGuards(OwnerGuard)(
      ParentController.prototype,
      "read",
      Object.getOwnPropertyDescriptor(ParentController.prototype, "read")!,
    );

    expect(getEnhancerMetadata(ParentController)).toEqual({
      guards: [AuthGuard],
      interceptors: [],
      filters: [],
    });
    expect(getEnhancerMetadata(ChildController)).toEqual({
      guards: [],
      interceptors: [],
      filters: [],
    });
    expect(getEnhancerMetadata(ChildController, "read")).toEqual({
      guards: [],
      interceptors: [],
      filters: [],
    });
  });

  test("treats @Catch() with no arguments as catching anything", () => {
    @Catch()
    class CatchEverythingFilter {}

    expect(getCatchMetadata(CatchEverythingFilter)).toEqual([]);
  });

  test("returns frozen enhancer collections and catch lists", () => {
    const metadata = getEnhancerMetadata(GuardedController);
    const exceptions = getCatchMetadata(NotFoundFilter);

    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.isFrozen(metadata.guards)).toBe(true);
    expect(Object.isFrozen(metadata.interceptors)).toBe(true);
    expect(Object.isFrozen(metadata.filters)).toBe(true);
    expect(Object.isFrozen(exceptions)).toBe(true);
  });

  test("rejects a non-class argument to @Catch", () => {
    expect(() => Catch("not a class" as never)).toThrow(TypeError);
  });
});
