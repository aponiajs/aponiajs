import type { ModuleDefinition } from "@aponiajs/common";
import { ELYSIA_DESCRIPTOR_CACHE_SYMBOL } from "./descriptor-cache.ts";
import { compileRootModule, compileRootModuleAsync } from "../modules/module-compiler.ts";
import type { AponiaRootModule } from "@aponiajs/common";

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
  const cached = readCachedDescriptor(moduleClass);
  if (cached !== undefined) {
    return cached;
  }

  const compiled = compileRootModule(moduleClass);
  cacheDescriptor(moduleClass, compiled);
  return compiled;
}

/**
 * Compiles a module graph that may hold asynchronous registrations.
 *
 * A module may declare `imports: [Something.forRoot()]` where `forRoot()` is
 * `async`, as Nest's `ConfigModule.forRoot()` is. This awaits those registrations
 * before lowering, then caches the descriptor the same way the synchronous
 * compiler does.
 *
 * @param moduleClass - The module class, descriptor, or registration to compile.
 * @returns The frozen module definition.
 */
export async function compileModuleInMemoryAsync(
  moduleClass: AponiaRootModule,
): Promise<ModuleDefinition> {
  const cached = readCachedDescriptor(moduleClass);
  if (cached !== undefined) {
    return cached;
  }

  const compiled = await compileRootModuleAsync(moduleClass);
  cacheDescriptor(moduleClass, compiled);
  return compiled;
}

function readCachedDescriptor(moduleClass: AponiaRootModule): ModuleDefinition | undefined {
  const target = descriptorHost(moduleClass);
  if (target !== undefined) {
    const cached = (target as Record<PropertyKey, unknown>)[COMPILED_DESCRIPTOR_SYMBOL];
    if (cached !== undefined) {
      return cached as ModuleDefinition;
    }
  }
  return undefined;
}

function cacheDescriptor(moduleClass: AponiaRootModule, compiled: ModuleDefinition): void {
  const target = descriptorHost(moduleClass);
  if (target !== undefined && Object.isExtensible(target)) {
    Object.defineProperty(target, COMPILED_DESCRIPTOR_SYMBOL, {
      value: compiled,
      writable: false,
      configurable: false,
      enumerable: false,
    });
  }
}

/**
 * The object a descriptor may be cached on.
 *
 * A synchronous compile receives a class, a descriptor, or a registration;
 * an asynchronous registration is a thenable and has no compiled graph to
 * store, so it is not a host. Telling the two apart here keeps a promise out of
 * the cache path entirely.
 */
function descriptorHost(moduleClass: AponiaRootModule): object | undefined {
  if (typeof moduleClass === "function") {
    return moduleClass;
  }
  if (typeof moduleClass !== "object" || moduleClass === null) {
    return undefined;
  }
  if (typeof (moduleClass as { readonly then?: unknown }).then === "function") {
    return undefined;
  }
  return moduleClass;
}
