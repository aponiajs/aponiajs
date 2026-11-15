import type { ModuleDefinition, Provider } from "@aponiajs/common";

/** One module as the graph projection states it: names, never values. */
export interface ModuleInspection {
  /** The module identity. */
  readonly id: string;
  /** The identities of the modules this module imports. */
  readonly imports: readonly string[];
  /** The controller token names this module mounts. */
  readonly controllers: readonly string[];
  /** The provider token names this module declares. */
  readonly providers: readonly string[];
  /** The exported token names importers may resolve. */
  readonly exports: readonly string[];
}

/** The frozen graph projection `inspect()` returns. */
export interface GraphInspection {
  /** The root identity the walk started from. */
  readonly root: string;
  /** Every reachable module, once each, in post-order. */
  readonly modules: readonly ModuleInspection[];
}

/** The module and provider owning a resolved token. */
export interface ProviderLocation {
  /** The module owning the provider. */
  readonly module: ModuleDefinition;
  /** The provider the token resolved to. */
  readonly provider: Provider;
}
