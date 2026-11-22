/** One directory of files a platform serves beside the application's routes. */
export interface StaticAssetsOptions {
  /** The public path the files mount under; `"/"` serves them at the root. */
  readonly prefix: string;
  /** The directory the files are read from. */
  readonly root: string;
  /** The file a directory request answers; defaults to `index.html`. */
  readonly index?: string;
  /** The `cache-control` max age in seconds, when the application states one. */
  readonly maxAge?: number;
}
