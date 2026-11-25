import {
  createToken,
  type ClassToken,
  type EnhancerMetadata,
  type ModuleDefinition,
} from "@aponiajs/common";
import type { AponiaContainer } from "@aponiajs/core";
import type { CompiledRoute } from "../interfaces/compiled-route.interface.ts";

/**
 * One compiled route plan a boot mounted, with the names around it.
 * @internal
 */
export interface AponiaRouteDiagnostics {
  /** The id of the module whose controller declares the route. */
  readonly module: string;
  /** The name of the controller token that mounts it. */
  readonly controller: string;
  /** The plan the route mounted from. */
  readonly route: CompiledRoute;
  /** Which binding serves the route. */
  readonly source: "generated" | "compiled";
}

/**
 * One route a controller mounted itself rather than from a compiled plan.
 * @internal
 */
export interface AponiaCallbackRouteDiagnostics {
  readonly module: string;
  readonly controller: string;
  readonly source: "compiled";
  readonly method: string;
  readonly path: string;
}

/**
 * The neutral facts one boot states about itself.
 *
 * Every platform publishes this record, so a consumer (the devtools surface)
 * projects one shape instead of the platform's native route table. Fields a
 * platform cannot state are `null` rather than guessed.
 * @internal
 */
export interface AponiaBootDiagnostics {
  /** The framework release that booted the application, when the platform states one. */
  readonly framework: string | null;
  /** Which root the container compiled. */
  readonly graph: "declared" | "decorated" | null;
  /** The root module, as the container compiled it. */
  readonly rootModule: ModuleDefinition | undefined;
  /** Every compiled module, in graph order. */
  readonly modules: readonly ModuleDefinition[];
  /** Every plan a controller mounted, in module then declaration order. */
  readonly routes: readonly AponiaRouteDiagnostics[];
  /** Every route a controller's own callback mounted. */
  readonly callbackRoutes: readonly AponiaCallbackRouteDiagnostics[];
  /** The application's own enhancer declaration. */
  readonly globalEnhancers: EnhancerMetadata;
  /** Which interceptor halves each resolved class declares, when the boot knows. */
  readonly interceptorHalves: ReadonlyMap<ClassToken<unknown>, { before: boolean; after: boolean }>;
  /** Which artifacts the boot adopted, and the release each came from. */
  readonly artifacts: {
    readonly invokers: string | null;
    readonly descriptors: string | null;
  } | null;
  /** The boot's verdict on a generated invoker artifact. */
  readonly invokers: { readonly accepted: boolean; readonly reason: string | undefined } | null;
  /** The exception the default mapping answered each failure with, when published. */
  readonly mappedExceptions: WeakMap<Request, string> | null;
}

/** The holder a boot fills once its graph is mounted. @internal */
export interface BootDiagnosticsRef {
  current?: AponiaBootDiagnostics | undefined;
}

/** The token carrying the boot's diagnostics reference. @internal */
export const BOOT_DIAGNOSTICS = createToken<BootDiagnosticsRef>("aponia.boot.diagnostics");

/** Creates the holder a boot fills. @internal */
export function createBootDiagnosticsRef(): BootDiagnosticsRef {
  return {};
}

/** Reads the record a boot published, or `undefined` for no boot. @internal */
export function readBootDiagnostics(container: AponiaContainer): AponiaBootDiagnostics | undefined {
  try {
    return container.get(BOOT_DIAGNOSTICS)?.current;
  } catch {
    return undefined;
  }
}
