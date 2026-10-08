import type { ModuleDefinition } from "@aponiajs/common";
import { compileRootModule } from "../modules/module-compiler.ts";
import type { AponiaRootModule } from "../modules/module-compiler.types.ts";

/**
 * Symbol used to attach compiled module descriptors directly onto class objects in RAM.
 */
export const COMPILED_DESCRIPTOR_SYMBOL: unique symbol = Symbol.for(
  "aponia.compiled.descriptors",
) as typeof COMPILED_DESCRIPTOR_SYMBOL;

/**
 * Compiles a decorated module directly in memory, caching the resulting frozen
 * descriptor on the class using `COMPILED_DESCRIPTOR_SYMBOL`.
 *
 * @param moduleClass - The module class or definition to compile in memory.
 * @returns The frozen module definition.
 */
export function compileModuleInMemory(moduleClass: AponiaRootModule): ModuleDefinition {
  if (
    (typeof moduleClass === "function" || typeof moduleClass === "object") &&
    moduleClass !== null
  ) {
    const target = moduleClass as unknown as Record<PropertyKey, unknown>;
    const cached = target[COMPILED_DESCRIPTOR_SYMBOL];
    if (cached !== undefined) {
      return cached as ModuleDefinition;
    }
  }

  const compiled = compileRootModule(moduleClass);
  Object.defineProperty(moduleClass, COMPILED_DESCRIPTOR_SYMBOL, {
    value: compiled,
    writable: false,
    configurable: false,
    enumerable: false,
  });
  return compiled;
}
