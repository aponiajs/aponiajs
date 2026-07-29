import type { ModuleDefinition, Provider } from "@aponiajs/common";

export interface ModuleInspection {
  readonly id: string;
  readonly imports: readonly string[];
  readonly controllers: readonly string[];
  readonly providers: readonly string[];
  readonly exports: readonly string[];
}

export interface GraphInspection {
  readonly root: string;
  readonly modules: readonly ModuleInspection[];
}

export interface ProviderLocation {
  readonly module: ModuleDefinition;
  readonly provider: Provider;
}
