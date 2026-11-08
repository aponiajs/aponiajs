/** What one library check reports. */
export interface LibraryCheckResult {
  readonly ok: boolean;
  readonly directory: string;
  readonly issues: readonly string[];
}

/** Options the library checker accepts. */
export interface LibraryCheckOptions {
  /** The directory the relative path resolves against. */
  readonly cwd?: string;
  /** The library directory; defaults to the working directory. */
  readonly path?: string;
  /** Require a publishable package. */
  readonly publish?: boolean;
}
