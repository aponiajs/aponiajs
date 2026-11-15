import "reflect-metadata";
import { createToken } from "../tokens/token.ts";
import type { InjectionToken } from "../tokens/token.types.ts";

/** Options for rendering a view template. */
export interface ViewRenderOptions {
  readonly layout?: string;
  readonly engine?: string;
  /**
   * When true, strips the master layout and renders only the inner section/content.
   * Ideal for HTMX, Turbo, or modal partial HTML updates.
   */
  readonly fragment?: boolean;
}

/** The rendering contract every view engine implements. */
export interface ViewEngine {
  /**
   * Renders a template with its view model.
   *
   * @param template - The template name or path.
   * @param data - The view model handed to the template.
   * @param options - Layout or engine options the route declared.
   * @returns The rendered markup, or a promise of it.
   */
  render(
    template: string,
    data: Record<string, unknown>,
    options?: { readonly layout?: string },
  ): Promise<string> | string;
}

/** The injection token under which the active view engine is provided. */
export const VIEW_ENGINE: InjectionToken<ViewEngine> = createToken<ViewEngine>("AponiaViewEngine");

const viewTemplateMetadataKey = Symbol.for("aponia.view-template.metadata");
const viewOptionsMetadataKey = Symbol.for("aponia.view-options.metadata");

/**
 * Declares a template view to render for one route handler.
 *
 * The return value of the decorated route handler is handed as the view model /
 * context to the configured ViewEngine. The response is automatically served with
 * `Content-Type: text/html; charset=utf-8`.
 *
 * @param template - The template name or path to render.
 * @param options - Optional layout or engine override.
 * @returns A method decorator recording the view template.
 */
export function Render(template: string, options?: ViewRenderOptions): MethodDecorator {
  if (typeof template !== "string" || template.trim() === "") {
    throw new TypeError("Render() requires a non-empty template string.");
  }

  return (target: object, propertyKey: string | symbol): void => {
    Reflect.defineMetadata(viewTemplateMetadataKey, template, target, propertyKey);
    if (options !== undefined) {
      Reflect.defineMetadata(
        viewOptionsMetadataKey,
        Object.freeze({ ...options }),
        target,
        propertyKey,
      );
    }
  };
}

/**
 * Reads the view template a route handler declares.
 *
 * @param target - The controller prototype.
 * @param propertyKey - The handler method key.
 * @returns The template string, or undefined when none is declared.
 */
export function getViewTemplate(target: object, propertyKey: string | symbol): string | undefined {
  return Reflect.getMetadata(viewTemplateMetadataKey, target, propertyKey);
}

/**
 * Reads the view options a route handler declares.
 *
 * @param target - The controller prototype.
 * @param propertyKey - The handler method key.
 * @returns The options object, or undefined when none was supplied.
 */
export function getViewOptions(
  target: object,
  propertyKey: string | symbol,
): ViewRenderOptions | undefined {
  return Reflect.getMetadata(viewOptionsMetadataKey, target, propertyKey);
}
