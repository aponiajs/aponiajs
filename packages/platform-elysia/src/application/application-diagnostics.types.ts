import type { ClassToken, EnhancerMetadata, ModuleDefinition } from "@aponiajs/common";
import type { InterceptorHalves } from "../controllers/enhancer-resolver.ts";
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
 * Which AponiaJS release supplied each artifact a boot adopted.
 *
 * This is the one fact a boot cannot state as a verdict. An accepted artifact
 * says generated binding served the application, and a declared graph says the
 * container compiled data — neither says *who wrote* that data, and the release
 * that did is the answer a consumer reports. `null` therefore means "no
 * artifact was involved": none supplied, one refused, or, for `descriptors`, a
 * descriptor the caller wrote by hand, which no build ever emitted.
 *
 * @internal
 */
export interface AponiaArtifactProvenance {
  /** The release that emitted the adopted invokers, or `null`. */
  readonly invokers: string | null;
  /** The release that emitted the adopted module descriptors, or `null`. */
  readonly descriptors: string | null;
}

/**
 * One compiled route plan, with the two names that say where it mounted and the
 * binding that answers it.
 *
 * The plan is the one a controller mounts from, so it carries the schema slots
 * as declared — a `@Validation()` model class included — and the enhancers the
 * route declares. Both are unrecoverable from the mounted application: a slot
 * is lowered to a validator while the route mounts, and a declaration is merged
 * into one compiled hook.
 *
 * `source` is the one fact the plan itself does not carry. Which binding serves
 * a route is settled while it mounts, when the supplied invoker map either
 * covers the handler's property key or does not, and the mounted application
 * cannot answer it afterwards: a supplied invoker and the platform's own
 * generated handler are both plain functions on the route. The boot therefore
 * records the decision rather than leaving a consumer to re-apply the
 * selector's rule.
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
  /** Which binding serves the route: a build-time invoker, or the boot's own compilation. */
  readonly source: "generated" | "compiled";
}

/**
 * One route a controller mounted itself rather than from a compiled plan.
 *
 * A controller that carries no plan mounts through the callback it was defined
 * with — a direct registration callback, or the plugin a low-level descriptor
 * builds — and those routes are the controller's own: the mounted application
 * keeps a method and a path for each, and neither the module nor the controller
 * that declared them. Its entries know no class property either, which is why an
 * entry states no handler. This is the slice of the mounted route table the
 * controller added, observed while it was added — the same slice the boot
 * reports on the `RoutesResolver` channel — because those two names exist
 * nowhere else once the boot returns.
 *
 * `source` is always `"compiled"` on an entry of this kind: an invoker artifact
 * binds only the routes the platform compiles, so no build-time invoker can
 * serve one a callback built. The state is declared rather than left to be
 * inferred so a consumer joins both kinds of entry with one rule.
 *
 * @internal
 */
export interface AponiaCallbackRouteDiagnostics {
  /** The id of the module whose controller mounted the route. */
  readonly module: string;
  /** The name of the controller token whose callback registered it. */
  readonly controller: string;
  /** Which binding serves the route: the running platform's, never a build's. */
  readonly source: "compiled";
  /** The method the mounted application reports, so a callback's own verbs arrive as they are. */
  readonly method: string;
  /** The path the mounted application reports. */
  readonly path: string;
}

/**
 * What one boot decided and mounted, attached to the native application it
 * returned under a symbol-keyed, non-enumerable property.
 *
 * This is a seam rather than a public contract: only
 * `bootstrapAponiaApplication` produces one, `readApplicationDiagnostics` is
 * the only reader, and an application no boot produced reads as `undefined`.
 * Each fact is one bootstrap already decided — the graph the root selector
 * served, the invoker artifact's verdict, the release each adopted artifact came
 * from, the compiled root, the plans the controllers mounted from and the routes
 * they mounted themselves, the application's own enhancer declaration, and which
 * halves of the interceptor lifecycle each resolved interceptor class implements
 * — so a consumer reports what the runtime did instead of re-applying its rules.
 *
 * @internal
 */
export interface AponiaApplicationDiagnostics {
  /** The AponiaJS release that booted the application. */
  readonly framework: string;
  /**
   * Which root the container compiled: `"declared"` when that root is a
   * `ModuleDefinition` — the artifact's descriptor, or one the caller passed —
   * and `"decorated"` when it is a class or a dynamic module, both of which the
   * boot lowers.
   */
  readonly graph: "declared" | "decorated";
  /** The boot's verdict on the generated invoker artifact. */
  readonly invokers: AponiaInvokerDiagnostics;
  /** The release that supplied each artifact the boot adopted, or `null`. */
  readonly artifacts: AponiaArtifactProvenance;
  /** The root `compileRootModule` returned, as the container compiled it. */
  readonly rootModule: ModuleDefinition;
  /**
   * Every compiled plan the boot's controllers mounted, in module graph order
   * and then declaration order. A controller mounted through the low-level
   * descriptor path builds its routes in a callback, so it contributes none.
   */
  readonly routes: readonly AponiaCompiledRouteDiagnostics[];
  /**
   * Every route a controller mounted itself, in module graph order and then
   * mount order — a direct registration callback's routes, or a plugin a
   * low-level descriptor built. Those controllers carry no compiled plan, so
   * this is the other half of the mounted table: the routes the platform
   * compiled nothing for, and whose declaring module and controller exist only
   * while the mount runs.
   */
  readonly callbackRoutes: readonly AponiaCallbackRouteDiagnostics[];
  /**
   * The application's own enhancer declaration, before any route's own. A plan
   * states only what its route declares, while the hook the route runs merges
   * both, so the declaration is the half a consumer cannot read from a plan.
   */
  readonly globalEnhancers: EnhancerMetadata;
  /**
   * The exception the boot's default mapping answered each unhandled failure
   * with, keyed by the request object the mapping saw.
   *
   * It is the exception and not the sentence the mapping answered with: that
   * sentence is one fixed `detail` for every unhandled failure, so repeating it
   * would tell a reader nothing the status does not, while the exception's own
   * one-line account is what this field is named for.
   *
   * Live rather than copied, and the one field of this record that is: what it
   * holds is not a decision the boot made but a fact the boot keeps producing,
   * exactly like the mounted route table. It is therefore per boot — two
   * applications built from one module class never share one — and it holds an
   * entry only for the requests the mapping itself answered. A reader that finds
   * no such field, which is what a copy of this platform older than this release
   * leaves behind, reads no exception: the answer it gave before the field
   * existed.
   */
  readonly mappedExceptions: WeakMap<Request, string>;
  /**
   * Which halves of the interceptor lifecycle each resolved interceptor class
   * implements, keyed by the class token the plans name it by.
   *
   * A class token is the whole key because a class resolved once serves every
   * route that names it: an interceptor is one singleton instance whatever
   * route, scope, or module declared it, so the two booleans it answers are one
   * fact about the class rather than one per route. The halves are read from the
   * instance the container resolved, which is the object the platform calls —
   * a half declared as a class field is an own property no token can be read
   * for, and this field is where that shape survives the mount.
   *
   * It is copied rather than published as the boot held it, for the reason every
   * other fact here is copied: the boot fills one map while its controllers
   * mount, and a record may never be a handle on a collection its writer still
   * owns. A reader that finds no such field — a copy of this platform older than
   * this release — must read it as "no halves were recorded" rather than as "no
   * halves were declared": the class may well implement both, and only the
   * record that states them is missing.
   */
  readonly interceptorHalves: ReadonlyMap<ClassToken<unknown>, InterceptorHalves>;
}
