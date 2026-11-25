import type { AnalyzedController } from "./controller-routes.interface.ts";
import type { AnalyzedModule } from "./module-descriptors.interface.ts";
import type {
  ControllerInvokerProvenance,
  EmittedControllerInvokers,
} from "./controller-invokers.interface.ts";
import type { EmittedModuleDescriptors } from "./descriptor-emitter.interface.ts";

/** Selects the same working directory and named project as `aponia build`. */
export interface AnalyzeBuildProjectOptions {
  readonly cwd?: string;
  readonly project?: string;
}

/** Frozen read-only source analysis and emitter decisions, with no filesystem writes. */
export interface BuildProjectAnalysis {
  readonly projectRoot: string;
  readonly sourceRoot: string;
  readonly invokerPath: string;
  readonly descriptorPath: string;
  readonly controllers: readonly AnalyzedController[];
  /** Every module declaration the analysis read, across all source files. */
  readonly modules: readonly AnalyzedModule[];
  readonly provenance: ControllerInvokerProvenance;
  readonly invokers: EmittedControllerInvokers;
  readonly descriptors: EmittedModuleDescriptors;
}
