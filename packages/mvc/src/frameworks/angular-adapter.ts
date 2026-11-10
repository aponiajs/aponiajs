/** Minimal contract for Angular CommonEngine. */
export interface AngularCommonEngine {
  render(options: {
    bootstrap?: unknown;
    document?: string;
    url?: string;
    publicPath?: string;
  }): Promise<string>;
}

/**
 * Creates an Angular SSR renderer handler.
 *
 * @param engine - The Angular CommonEngine instance.
 * @param options - Bootstrap module or component and base HTML document.
 * @returns A handler rendering Angular application to HTML Response.
 */
export function createAngularHandler(
  engine: AngularCommonEngine,
  options: { readonly bootstrap?: unknown; readonly document?: string } = {},
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const html = await engine.render({
      bootstrap: options.bootstrap,
      document: options.document ?? "<app-root></app-root>",
      url: request.url,
    });

    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  };
}
