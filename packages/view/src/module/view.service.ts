import type { ViewEngine } from "../interfaces/view.interface.ts";

/**
 * Service to execute template rendering from controllers or services.
 */
export class ViewService {
  readonly #engine: ViewEngine;

  constructor(engine: ViewEngine) {
    this.#engine = engine;
  }

  render(
    template: string,
    data: Record<string, unknown> = {},
    options?: { readonly layout?: string },
  ): Promise<string> | string {
    return this.#engine.render(template, data, options);
  }

  /** Adds one value every subsequent render reads, when the engine supports it. */
  share(key: string, value: unknown): void {
    const share = (this.#engine as { share?: (key: string, value: unknown) => void }).share;
    share?.call(this.#engine, key, value);
  }
}
