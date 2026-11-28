import { describe, expect, test } from "bun:test";
import { AponiaError } from "../exceptions/aponia-error.ts";
import { Controller, Get, Injectable, Module } from "../decorators/decorators.ts";
import { type ModuleDefinition } from "../interfaces/module.interface.ts";
import { compileRootModule, HttpControllerKind } from "../index.ts";

@Injectable()
class GreetingService {
  greet(): string {
    return "hello";
  }
}

@Controller("greetings")
class GreetingController {
  constructor(private readonly service: GreetingService) {}

  @Get()
  index(): string {
    return this.service.greet();
  }
}

@Module({ controllers: [GreetingController], providers: [GreetingService] })
class AppModule {}

describe("compileRootModule without a platform compiler", () => {
  test("lowers a decorated controller into a neutral descriptor", () => {
    const compiled = compileRootModule(AppModule);
    const [controller] = compiled.controllers;

    expect(controller?.kind).toBe(HttpControllerKind);
    expect(controller?.token).toBe(GreetingController);
    expect(controller?.inject).toEqual([GreetingService]);
    expect(Object.keys(controller ?? {})).not.toContain("compiledRoutes");
  });

  test("refuses a controller the decorator never marked", () => {
    class Undecorated {}
    @Module({ controllers: [Undecorated as never] })
    class BrokenModule {}

    try {
      compileRootModule(BrokenModule);
      throw new Error("Expected the controller to be refused.");
    } catch (error) {
      expect(error).toBeInstanceOf(AponiaError);
      expect((error as AponiaError).code).toBe("INVALID_CONTROLLER");
    }
  });

  test("asks the platform to check routes on a lowered graph, never on precompiled data", () => {
    const checked: ModuleDefinition[] = [];
    compileRootModule(AppModule, { assertRoutes: (root) => checked.push(root) });
    expect(checked).toHaveLength(1);

    const precompiled = Object.freeze({
      [Symbol.for("aponia.compiled.descriptors")]: Object.freeze({ controllers: [] }),
    });
    const skipped: ModuleDefinition[] = [];
    compileRootModule(precompiled as never, { assertRoutes: (root) => skipped.push(root) });
    expect(skipped).toHaveLength(0);
  });
});
