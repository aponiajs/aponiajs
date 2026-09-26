import type { ModuleDefinition } from "@aponiajs/common";

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
