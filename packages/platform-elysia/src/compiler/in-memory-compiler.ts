import type { ModuleDefinition } from "@aponiajs/common";
import { ELYSIA_DESCRIPTOR_CACHE_SYMBOL } from "./descriptor-cache.ts";
import { compileRootModule } from "../modules/module-compiler.ts";
import type { AponiaRootModule } from "@aponiajs/platform-core";

/**
 * Symbol used to attach compiled module descriptors directly onto class objects in RAM.
 *
 * The key is platform-scoped: an Elysia descriptor lowers controllers onto
 * Elysia's kind, and a cache slot shared with another platform would make that
 * platform's boot read a graph it cannot mount. One class can be booted on more
 * than one platform in one process, and each keeps its own compiled graph.
 */
export const COMPILED_DESCRIPTOR_SYMBOL: unique symbol =
  ELYSIA_DESCRIPTOR_CACHE_SYMBOL as typeof COMPILED_DESCRIPTOR_SYMBOL;

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
  if (
    (typeof moduleClass === "function" || typeof moduleClass === "object") &&
    moduleClass !== null &&
    Object.isExtensible(moduleClass)
  ) {
    Object.defineProperty(moduleClass, COMPILED_DESCRIPTOR_SYMBOL, {
      value: compiled,
      writable: false,
      configurable: false,
      enumerable: false,
    });
  }
  return compiled;
}
