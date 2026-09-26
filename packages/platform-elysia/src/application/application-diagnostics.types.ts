import type { EnhancerMetadata, ModuleDefinition } from "@aponiajs/common";
import type { CompiledElysiaRoute } from "../routing/route-compiler.types.ts";

/**
 * What one boot decided about the invoker artifact.
 *
 * @internal
 */
export interface AponiaInvokerDiagnostics {
  /** Whether the boot adopted generated invokers rather than compiling its own. */
  readonly accepted: boolean;
  /** Why the artifact was refused, or `undefined` when it was adopted. */
  readonly reason: string | undefined;
}

/**
 * One compiled route plan, with the two names that say where it mounted.
 *
 * The plan is the one a controller mounts from, so it carries the schema slots
 * as declared — a `@Validation()` model class included — and the enhancers the
 * route declares. Both are unrecoverable from the mounted application: a slot
 * is lowered to a validator while the route mounts, and a declaration is merged
 * into one compiled hook.
 *
 * @internal
 */
export interface AponiaCompiledRouteDiagnostics {
  /** The id of the module whose controller declares the route. */
  readonly module: string;
  /** The name of the controller token that mounts it. */
  readonly controller: string;
  /** The plan the route mounted from. */
  readonly route: CompiledElysiaRoute;
}

/**
 * What one boot decided and mounted, attached to the native application it
 * returned under a symbol-keyed, non-enumerable property.
 *
 * This is a seam rather than a public contract: only
 * `bootstrapAponiaApplication` produces one, `readApplicationDiagnostics` is
 * the only reader, and an application no boot produced reads as `undefined`.
 * Each fact is one bootstrap already decided — the graph the root selector
 * served, the invoker artifact's verdict, the compiled root, the plans the
 * controllers mounted from, and the application's own enhancer declaration —
 * so a consumer reports what the runtime did instead of re-applying its rules.
 *
 * @internal
 */
export interface AponiaApplicationDiagnostics {
  /** The AponiaJS release that booted the application. */
  readonly framework: string;
  /**
   * Which root the container compiled: `"declared"` when the boot served data
   * — a descriptor artifact, a descriptor root, or a dynamic module — and
   * `"decorated"` when it lowered the module class the caller passed.
   */
  readonly graph: "declared" | "decorated";
  /** The boot's verdict on the generated invoker artifact. */
  readonly invokers: AponiaInvokerDiagnostics;
  /** The root `compileRootModule` returned, as the container compiled it. */
  readonly rootModule: ModuleDefinition;
  /**
   * Every compiled plan the boot's controllers mounted, in module graph order
   * and then declaration order. A controller mounted through the low-level
   * descriptor path builds its routes in a callback, so it contributes none.
   */
  readonly routes: readonly AponiaCompiledRouteDiagnostics[];
  /**
   * The application's own enhancer declaration, before any route's own. A plan
   * states only what its route declares, while the hook the route runs merges
   * both, so the declaration is the half a consumer cannot read from a plan.
   */
  readonly globalEnhancers: EnhancerMetadata;
}
