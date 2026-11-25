import {
  getModuleMetadata,
  isForwardRef,
  type DynamicModule,
  type ModuleClass,
  type ModuleImport,
} from "@aponiajs/common";
import { isModuleDefinition } from "./module-definition.ts";
import type {
  AponiaRootModule,
  ResolvedModuleImports,
} from "../interfaces/module-compiler.interface.ts";
import { isThenableModuleImport as isThenable } from "./module-thenable.ts";

/**
 * Awaits every `Promise` a module graph declares in an `imports` list.
 *
 * Nest lets a dynamic registration be asynchronous at declaration time, so a
 * module writes `imports: [ConfigModule.forRoot()]` and the boot awaits the
 * registration before it lowers the graph. This resolver is that await: it walks
 * the reachable declarations once, replaces each thenable with its value, and
 * records a replacement list only for a module that actually held one.
 *
 * A module the graph reaches twice is resolved once. A `forwardRef` is left
 * untouched, because the compiler already unwraps it lazily and eagerly
 * following one would defeat the cycle it exists to break.
 *
 * @param rootModule - The root class, descriptor, or registration.
 * @returns The resolved root plus the import replacements the compiler applies.
 *
 * @example
 * ```ts
 * const resolved = await resolveModuleImports(rootModule);
 * const compiled = compileRootModule(resolved.rootModule, { resolvedImports: resolved });
 * ```
 */
export async function resolveModuleImports(
  rootModule: AponiaRootModule,
): Promise<ResolvedModuleImports> {
  const classImports = new Map<ModuleClass, readonly ModuleImport[]>();
  const dynamicImports = new Map<DynamicModule, readonly ModuleImport[]>();
  const resolving = new Set<ModuleClass | DynamicModule>();

  const replaceImports = async (
    imports: readonly ModuleImport[],
    record: (resolved: readonly ModuleImport[]) => void,
  ): Promise<void> => {
    if (imports.length === 0) {
      return;
    }
    const resolved: ModuleImport[] = [];
    let changed = false;
    for (const entry of imports) {
      const value = await resolveEntry(entry);
      if (value !== entry) {
        changed = true;
      }
      resolved.push(value);
    }
    if (changed) {
      record(Object.freeze(resolved));
    }
  };

  const resolveEntry = async (entry: ModuleImport): Promise<ModuleImport> => {
    if (isThenable(entry)) {
      return await resolveEntry((await entry) as ModuleImport);
    }
    if (isForwardRef(entry)) {
      return entry;
    }
    if (typeof entry === "function") {
      await resolveClass(entry);
      return entry;
    }
    if (isModuleDefinition(entry)) {
      return entry;
    }
    await resolveDynamic(entry);
    return entry;
  };

  const resolveClass = async (moduleClass: ModuleClass): Promise<void> => {
    if (resolving.has(moduleClass)) {
      return;
    }
    resolving.add(moduleClass);
    try {
      const metadata = getModuleMetadata(moduleClass);
      await replaceImports(metadata?.imports ?? [], (resolved) =>
        classImports.set(moduleClass, resolved),
      );
    } finally {
      resolving.delete(moduleClass);
    }
  };

  const resolveDynamic = async (dynamicModule: DynamicModule): Promise<void> => {
    if (resolving.has(dynamicModule)) {
      return;
    }
    resolving.add(dynamicModule);
    try {
      // A registration's graph is the metadata its class declares plus the one
      // the registration states, and the compiler merges the two. Resolving the
      // merged list is what lets the replacement stand in for both halves.
      const metadata = getModuleMetadata(dynamicModule.module);
      const merged = [...(metadata?.imports ?? []), ...(dynamicModule.imports ?? [])];
      await replaceImports(merged, (resolved) => dynamicImports.set(dynamicModule, resolved));
    } finally {
      resolving.delete(dynamicModule);
    }
  };

  const resolvedRoot = await resolveEntry(rootModule);
  return Object.freeze({ rootModule: resolvedRoot, classImports, dynamicImports });
}
