import { describe, expect, it } from "bun:test";
import { isMethodSynchronous } from "../src/routing/ast-sync-analyzer.ts";

describe("AST Synchronous Analyzer", () => {
  it("identifies synchronous class methods as synchronous", () => {
    class Controller {
      syncMethod(this: void) {
        return "hello";
      }
    }
    expect(isMethodSynchronous(Controller.prototype.syncMethod)).toBe(true);
  });

  it("identifies synchronous regular functions and arrow functions as synchronous", () => {
    function regularFn() {
      return 42;
    }
    const arrowFn = () => "ok";

    expect(isMethodSynchronous(regularFn)).toBe(true);
    expect(isMethodSynchronous(arrowFn)).toBe(true);
  });

  it("identifies async class methods as not synchronous", () => {
    class Controller {
      async asyncMethod(this: void) {
        return "async";
      }
    }
    expect(isMethodSynchronous(Controller.prototype.asyncMethod)).toBe(false);
  });

  it("identifies async regular functions and async arrow functions as not synchronous", () => {
    async function regularAsyncFn() {
      return 42;
    }
    const arrowAsyncFn = async () => "ok";

    expect(isMethodSynchronous(regularAsyncFn)).toBe(false);
    expect(isMethodSynchronous(arrowAsyncFn)).toBe(false);
  });

  it("identifies async generator functions as not synchronous", () => {
    async function* asyncGen() {
      yield 1;
    }
    expect(isMethodSynchronous(asyncGen)).toBe(false);
  });

  it("identifies functions containing await tokens as not synchronous", () => {
    const fnWithAwait = {
      handler(this: void) {
        return "await result";
      },
    };
    expect(isMethodSynchronous(fnWithAwait.handler)).toBe(false);
  });

  it("handles non-function inputs gracefully", () => {
    expect(isMethodSynchronous(null as unknown as Function)).toBe(false);
    expect(isMethodSynchronous(undefined as unknown as Function)).toBe(false);
    expect(isMethodSynchronous({} as unknown as Function)).toBe(false);
  });
});
