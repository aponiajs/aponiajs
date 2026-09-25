import type { ClassToken } from "@aponiajs/common";
import type { AponiaControllerInvokerFactory } from "./route-compiler.types.ts";

/**
 * Build-time generated route invokers together with the provenance that decides
 * whether the running framework may use them.
 *
 * `aponia build` emits exactly this shape. The invokers are only interchangeable
 * with the platform's own compilation within one framework release, so the
 * artifact carries what produced it and bootstrap checks it before mounting
 * anything.
 */
export interface AponiaInvokerArtifact {
  /** The AponiaJS version that generated `invokers`. */
  readonly framework: string;
  /**
   * The Elysia version `invokers` were generated against, or `null` when `aponia
   * build` could not resolve an installed one. It is reported when an artifact
   * is refused, so the mismatch names both sides.
   */
  readonly elysia: string | null;
  /** Invokers keyed by controller class token. */
  readonly invokers: ReadonlyMap<ClassToken<unknown>, AponiaControllerInvokerFactory>;
}
