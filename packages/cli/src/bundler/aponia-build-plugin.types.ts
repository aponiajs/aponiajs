/**
 * Options for {@link aponiaBuildPlugin}.
 *
 * Both mirror the matching `aponia build` option, because the plugin runs the
 * same generator the command does.
 */
export interface AponiaBuildPluginOptions {
  /**
   * Directory to resolve the project from. Defaults to the working directory the
   * bundler runs in, which is the project root for a build script.
   */
  readonly cwd?: string;
  /** Select a configured project from `aponia.json`. */
  readonly project?: string;
}
