import type { ViewEngine } from "../module/view.types.ts";

/**
 * Ultra-fast native template substitution engine.
 *
 * Replaces `{{key}}` or `<%= key %>` tokens in templates with zero external dependencies.
 */
export class HtmlViewEngine implements ViewEngine {
  readonly #cache = new Map<string, string>();
  readonly #useCache: boolean;

  constructor(options: { readonly cache?: boolean } = {}) {
    this.#useCache = options.cache ?? true;
  }

  async render(
    template: string,
    data: Record<string, unknown>,
    _options?: { readonly layout?: string },
  ): Promise<string> {
    let content = this.#cache.get(template);
    if (!content || !this.#useCache) {
      const file = Bun.file(template);
      if (await file.exists()) {
        content = await file.text();
      } else {
        content = template;
      }
      if (this.#useCache) {
        this.#cache.set(template, content);
      }
    }

    const pattern = new RegExp("(?:\\{\\{|<%=\\s*)([a-zA-Z0-9_$.]+)(?:\\}\\}|\\s*%>)", "g");
    return content.replace(pattern, (_match, key) => {
      const val = data[key];
      if (val === undefined || val === null) {
        return "";
      }
      return typeof val === "object"
        ? JSON.stringify(val)
        : String(val as string | number | boolean);
    });
  }
}
