/** Options a compression registration accepts. */
export interface CompressionModuleOptions {
  /** The minimum body size in bytes; defaults to 1 KiB. */
  readonly thresholdBytes?: number;
  /** The encodings offered, in preference order; defaults to `["br", "gzip"]`. */
  readonly encodings?: readonly ("br" | "gzip")[];
  /** The plugin module identity; defaults to `compression`. */
  readonly key?: string;
}

/** The validated options the plugin reads. */
export interface ResolvedCompressionOptions {
  readonly thresholdBytes: number;
  readonly encodings: readonly ("br" | "gzip")[];
}
