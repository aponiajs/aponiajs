import { describe, expect, it } from "bun:test";
import type { PluginBuilder } from "bun";
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

  it("registers Bun plugin and provides setup hook", async () => {
    expect(aponiaCompilerPlugin.name).toBe("aponia-in-memory-compiler");
    const fakeBuilder = {} as unknown as PluginBuilder;
    await aponiaCompilerPlugin.setup(fakeBuilder);
    expect(typeof aponiaCompilerPlugin.setup).toBe("function");
  });
});
