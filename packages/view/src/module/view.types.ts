import type { ViewEngine } from "@aponiajs/common";

export type { ViewEngine };

/** Options for configuring ViewModule. */
export interface ViewModuleOptions {
  /** The root directory for templates; defaults to `views`. */
  readonly rootDir?: string;
  /** Default template engine to use; `html` or `blade`; defaults to `html`. */
  readonly defaultEngine?: string;
  /** Values every template can read. */
  readonly shared?: Record<string, unknown>;
  /** Custom view engine instance. */
  readonly engine?: ViewEngine;
  /** Whether to enable in-memory pre-compilation template caching; defaults to true. */
  readonly cache?: boolean;
}
