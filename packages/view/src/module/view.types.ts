/**
 * Storage / Rendering interface every template engine implements.
 */
export interface ViewEngine {
  /**
   * Renders a template with provided context data.
   *
   * @param template - Template name or path.
   * @param data - The view model or context data.
   * @param options - Additional render options.
   * @returns HTML string or a web stream.
   */
  render(
    template: string,
    data: Record<string, unknown>,
    options?: { readonly layout?: string },
  ): Promise<string> | string;
}

/** Options for configuring ViewModule. */
export interface ViewModuleOptions {
  /** The root directory for templates; defaults to `views`. */
  readonly rootDir?: string;
  /** Default template engine to use; defaults to `html`. */
  readonly defaultEngine?: string;
  /** Custom view engine instance. */
  readonly engine?: ViewEngine;
  /** Whether to enable in-memory pre-compilation template caching; defaults to true. */
  readonly cache?: boolean;
}
