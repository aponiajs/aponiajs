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

/**
 * What the boot may use, and why when it may use nothing.
 *
 * The reason is the decision's own words rather than a second explanation
 * written by a consumer: the selector is the only place the refusal rules
 * exist, so it is the only place that can state why one applied, and the boot
 * reports the same sentence on its log channel and in the record it publishes.
 *
 * @internal
 */
export interface AponiaInvokerSelection {
  /** The invokers the boot may use, or `undefined` when it compiles its own. */
  readonly invokers: ReadonlyMap<ClassToken<unknown>, AponiaControllerInvokerFactory> | undefined;
  /** Why the artifact was refused, or `undefined` when it was adopted. */
  readonly reason: string | undefined;
}
