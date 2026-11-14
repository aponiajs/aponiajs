import { describe, expect, it } from "bun:test";
import type { OnLoadArgs } from "bun";
import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory } from "../src/application/aponia-factory.ts";
import {
  COMPILED_DESCRIPTOR_SYMBOL,
  compileModuleInMemory,
} from "../src/compiler/in-memory-compiler.ts";
import { aponiaCompilerPlugin } from "../src/compiler/register.ts";
import { compileRootModule } from "../src/modules/module-compiler.ts";

describe("In-Memory Compiler", () => {
  it("compiles decorated module directly in RAM and attaches frozen descriptor symbol", () => {
    class SampleService {}
    class SampleModule {}

    Reflect.defineMetadata(
      Symbol.for("aponia.module.metadata"),
      { providers: [SampleService] },
      SampleModule,
    );

    const compiled = compileModuleInMemory(SampleModule);
    expect(compiled).toBeDefined();
    expect(
      (SampleModule as unknown as Record<PropertyKey, unknown>)[COMPILED_DESCRIPTOR_SYMBOL],
    ).toBe(compiled);

    // Calling it again returns the cached descriptor without re-compilation
    const cached = compileModuleInMemory(SampleModule);
    expect(cached).toBe(compiled);

    // compileRootModule also honors the cached descriptor on the class
    expect(compileRootModule(SampleModule)).toBe(compiled);
  });

  it("boots via AponiaFactory.create using in-memory compiled module", async () => {
    @Controller("/jit")
    class JitController {
      @Get("/hello")
      hello(): string {
        return "hello from jit";
      }
    }

    @Module({ controllers: [JitController] })
    class JitAppModule {}

    // Pre-compile in memory
    const compiled = compileModuleInMemory(JitAppModule);
    expect(
      (JitAppModule as unknown as Record<PropertyKey, unknown>)[COMPILED_DESCRIPTOR_SYMBOL],
    ).toBe(compiled);

    // AponiaFactory.create uses the cached descriptor directly
    const app = await AponiaFactory.create(JitAppModule, { logger: false });
    const response = await app.handle(new Request("http://localhost/jit/hello"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello from jit");
    await app.close();
  });

  it("registers Bun plugin and onLoad hook filters and loads module files", async () => {
    expect(aponiaCompilerPlugin.name).toBe("aponia-in-memory-compiler");

    let registeredFilter: RegExp | undefined;
    let registeredCallback: ((args: OnLoadArgs) => unknown) | undefined;

    const fakeBuilder = {
      onLoad(
        options: { filter: RegExp },
        callback: (args: { path: string }) => Promise<{ contents: string; loader: string }>,
      ): void {
        registeredFilter = options.filter;
        registeredCallback = callback as (args: OnLoadArgs) => unknown;
      },
    };

    aponiaCompilerPlugin.setup(fakeBuilder);
    expect(registeredFilter).toBeDefined();
    expect(registeredFilter?.test("app.module.ts")).toBe(true);
    expect(registeredFilter?.test("users.controller.ts")).toBe(true);
    expect(registeredFilter?.test("users.service.ts")).toBe(false);

    expect(registeredCallback).toBeDefined();
    // Execute onLoad callback against a known file
    const result = (await registeredCallback!({
      path: import.meta.path,
      namespace: "file",
      loader: "ts",
      defer: async (): Promise<void> => {},
    })) as { readonly contents: string; readonly loader: string } | undefined;

    expect(result).toBeDefined();
    expect(result?.loader).toBe("ts");
    expect(result?.contents).toContain("In-Memory Compiler");
  });
});
