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
 * Checks whether an incoming request is an HTMX request (`HX-Request: true`).
 */
export function isHtmxRequest(request: Request): boolean {
  return request.headers.get("hx-request") === "true";
}

/**
 * Renders a view template and returns a Web Standard `Response` with HTML content-type.
 *
 * If `context` or an incoming `Request` is supplied (or inferred) with `HX-Request: true`,
 * or if `options.fragment` is true, the template is automatically rendered without its
 * outer layout (`@extends`), returning only the inner section content for seamless HTMX swap.
 *
 * ```ts
 * @Get()
 * index() {
 *   return view("articles.index", { articles });
 * }
 * ```
 *
 * @param template - Template name or path (e.g. `./views/index.blade.html` or `articles.index`).
 * @param data - The view model or props handed to the template.
 * @param options - Additional layout, fragment, or render options.
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

/**
 * Returns an immediate HTML fragment response without layouts.
 *
 * Ideal for small inline markup, status messages, or specific HTMX partial swaps:
 * ```ts
 * @Delete(":id")
 * remove() {
 *   return fragment("<p>Item removed</p>");
 * }
 * ```
 *
 * @param html - Raw HTML fragment or template string.
 * @param headers - Optional custom headers (e.g. `HX-Trigger`).
 * @returns A standard Response with `text/html; charset=utf-8`.
 */
export function fragment(html: string, headers?: Record<string, string>): Response {
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...headers,
    },
  });
}
