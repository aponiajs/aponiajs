import type { ModuleDefinition } from "@aponiajs/common";
import type { AponiaRootModule } from "./module-compiler.types.ts";

/**
 * Build-time generated module descriptors together with the provenance that
 * decides whether the running framework may use them.
 *
 * `aponia build` emits exactly this shape. A declared module is only
 * interchangeable with the decorated class it was lowered from within the
 * framework release that produced it, so the artifact carries what produced it
 * and bootstrap checks it before compiling anything.
 */
export interface AponiaModuleDescriptorArtifact {
  /** The AponiaJS version that generated `modules`. */
  readonly framework: string;
  /**
   * The Elysia version `modules` were generated against, or `null` when `aponia
   * build` could not resolve an installed one. It is reported when an artifact
   * is refused, so the mismatch names both sides.
   */
  readonly elysia: string | null;
  /** Module descriptors keyed by module class name. */
  readonly modules: Readonly<Record<string, ModuleDefinition>>;
}

/**
 * The root module bootstrap compiled, and the release that supplied it.
 *
 * The stamp is the artifact's own `framework`, and `null` whenever no artifact
 * was involved: a descriptor the caller wrote by hand, a dynamic module, or an
 * artifact this release refused. Nothing else can name the release behind a
 * declared graph, so a consumer that reports one reports what the boot read
 * here rather than the release that happens to be running.
 *
 * @internal
 */
export interface AponiaRootModuleSelection {
  /** The root the container compiles: the artifact's descriptor, or the caller's. */
  readonly rootModule: AponiaRootModule;
  /** The AponiaJS release that emitted the adopted descriptor, or `null`. */
  readonly builtBy: string | null;
}
