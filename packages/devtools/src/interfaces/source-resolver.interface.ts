/**
 * The extracted source code result for a requested target entity.
 */
export interface SourceCodeResult {
  /** The requested target identifier (e.g. "UsersService" or "UsersController.findOne"). */
  readonly target: string;
  /** Absolute or project-relative path to the source file. */
  readonly filePath: string;
  /** 1-indexed starting line number of the target. */
  readonly lineStart: number;
  /** 1-indexed ending line number of the target. */
  readonly lineEnd: number;
  /** The extracted TypeScript/JavaScript source code. */
  readonly code: string;
}

/**
 * Options configuring source code resolution.
 */
export interface SourceResolverOptions {
  /** Explicit source files to search in, or defaults to discovering project files. */
  readonly sourceFiles?: readonly string[];
  /** The project root directory; defaults to current working directory. */
  readonly cwd?: string;
}
