import type { DynamicModule, ModuleClass, ModuleImport } from "@aponiajs/common";

/** Anything `AponiaFactory.create` boots from: a class, a descriptor, or a registration. */
export type AponiaRootModule = ModuleImport;

/**
 * The imports a resolver replaced for modules whose declaration held a Promise.
 *
 * Only modules whose `imports` array contained a thenable appear here; every
 * other module keeps the imports its metadata already states. The compiler reads
 * these maps before the metadata, so a Promise never reaches the synchronous
 * lowering.
 */
export interface ResolvedModuleImports {
  /** The root the resolver produced, with a promised root already awaited. */
  readonly rootModule: AponiaRootModule;
  /** Replacement imports for a module class whose declaration held a Promise. */
  readonly classImports: ReadonlyMap<ModuleClass, readonly ModuleImport[]>;
  /** Replacement imports for a registration whose declaration held a Promise. */
  readonly dynamicImports: ReadonlyMap<DynamicModule, readonly ModuleImport[]>;
}
