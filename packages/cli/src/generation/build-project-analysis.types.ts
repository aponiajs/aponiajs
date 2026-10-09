import type { AnalyzedController } from "./controller-routes.types.ts";
import type {
  ControllerInvokerProvenance,
  EmittedControllerInvokers,
} from "./controller-invokers.types.ts";
import type { EmittedModuleDescriptors } from "./descriptor-emitter.types.ts";

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
  readonly provenance: ControllerInvokerProvenance;
  readonly invokers: EmittedControllerInvokers;
  readonly descriptors: EmittedModuleDescriptors;
}
