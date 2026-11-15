import {
  compileRootModule as compilePlatformRootModule,
  isModuleDefinition,
  type AponiaRootModule,
} from "@aponiajs/platform-core";
import type { ModuleDefinition } from "@aponiajs/common";
import { compileDecoratedController } from "./controller-lowering.ts";
import { assertUniqueElysiaRoutes } from "./route-uniqueness.ts";

export { isModuleDefinition };

/**
 * Lowers a root module into the frozen descriptor the graph compiles.
 *
 * The lowering itself is `@aponiajs/platform-core`'s; this wrapper supplies the
 * two halves only this platform can state — how one decorated controller lowers
 * onto this runtime, and the duplicate-route check that reads the compiled plan.
 *
 * @param rootModule - The root class, descriptor, or descriptor artifact selection.
 * @returns The frozen root descriptor the container builds from.
 * @throws An `AponiaError` with the graph or route code naming the invalid declaration.
 *
 * @example
 * ```ts
 * const root = compileRootModule(AppModule);
 * ```
 */
export function compileRootModule(rootModule: AponiaRootModule): ModuleDefinition {
  return compilePlatformRootModule(rootModule, {
    compileController: compileDecoratedController,
    assertRoutes: assertUniqueElysiaRoutes,
  });
}
