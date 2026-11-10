import type { ViewRenderOptions } from "@aponiajs/common";
import type { ViewEngine } from "../module/view.types.ts";

let defaultEngine: ViewEngine | undefined;

/**
 * Sets the default view engine used by the standalone `view()` helper.
 *
 * @internal
 */
export function setDefaultViewEngine(engine: ViewEngine): void {
  defaultEngine = engine;
}

/**
 * Renders a view template and returns a Web Standard `Response` with HTML content-type.
 *
 * Can be returned directly from any route handler without decorators:
 * ```ts
 * @Get()
 * index() {
 *   return view("users.index", { users });
 * }
 * ```
 *
 * @param template - The template name or co-located file path (e.g. `./index.html` or `users.show`).
 * @param data - The view model or props handed to the template.
 * @param options - Additional layout or rendering options.
 * @returns A Promise resolving to an HTML Response.
 */
export async function view<TData extends Record<string, unknown> = Record<string, unknown>>(
  template: string,
  data?: TData,
  options?: ViewRenderOptions,
): Promise<Response> {
  if (defaultEngine === undefined) {
    const { BladeViewEngine } = await import("../engines/blade-view-engine.ts");
    defaultEngine = new BladeViewEngine();
  }

  const html = await defaultEngine.render(
    template,
    (data ?? {}) as Record<string, unknown>,
    options,
  );
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  });
}
