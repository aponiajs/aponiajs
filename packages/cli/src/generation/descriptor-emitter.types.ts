import type { AnalyzedModuleDescriptors } from "./module-descriptors.types.ts";
import type { AnalyzedController } from "./controller-routes.types.ts";
import type { SourceImports } from "./source-imports.types.ts";

/**
 * One source file, with everything the analysis read from it.
 *
 * The route analysis and the module analysis read the same file separately — a
 * controller's routes come from one and its constructor dependencies from the
 * other — so the emitter takes both together and joins them by class name. The
 * file's own resolvable names travel with them, because every expression the
 * emitter copies has to be imported from where that file imported it.
 */
export interface DescriptorSourceFile {
  /** The file's absolute path, which is what a resolved relative import points at. */
  readonly file: string;
  /** The names the file can read, from `readSourceImports`. */
  readonly imports: SourceImports;
  readonly descriptors: AnalyzedModuleDescriptors;
  readonly controllers: readonly AnalyzedController[];
}

/** A module the emitter left out of the generated module, and why. */
export interface DeclinedModuleDescriptor {
  readonly kind: "module";
  /** The module class name exactly as declared. */
  readonly module: string;
  readonly reason: string;
}

/** A route the emitter could not declare, and why. */
export interface DeclinedRouteDescriptor {
  readonly kind: "route";
  readonly module: string;
  /** The controller that declares the route. */
  readonly controller: string;
  /** The handler the route is declared on. */
  readonly method: string;
  readonly reason: string;
}

/**
 * One declaration the emitter declined.
 *
 * A declined route also sinks the module that declares it: a controller is
 * declared whole, so emitting it without a route would leave the application
 * answering the platform's 404 where it used to answer with the handler. The
 * route is reported anyway, because it is the declaration the application has to
 * change before the next build can generate the module.
 */
export type DeclinedDescriptor = DeclinedModuleDescriptor | DeclinedRouteDescriptor;

/**
 * A generated descriptor module, or the reasons nothing could be generated.
 *
 * `source` is `undefined` when no module could be emitted, in which case the
 * command writes no descriptor module at all. That is a supported state: the
 * application keeps booting from its decorators, which is the same fallback a
 * declined route leaves behind.
 */
export interface EmittedModuleDescriptors {
  readonly source: string | undefined;
  /** Every module and route the emitter declined, in the order it met them. */
  readonly declined: readonly DeclinedDescriptor[];
}
