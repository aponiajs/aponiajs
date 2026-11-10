import { Module, provideClass, provideValue, type DynamicModule } from "@aponiajs/common";
import { VIEW_ENGINE } from "./view.constants.ts";
import type { ViewEngine, ViewModuleOptions } from "./view.types.ts";
import { HtmlViewEngine } from "../engines/html-view-engine.ts";

/**
 * ViewModule provides template rendering services for MVC applications.
 */
@Module({})
export class ViewModule {
  static register(options: ViewModuleOptions = {}): DynamicModule {
    const engine: ViewEngine =
      options.engine ?? new HtmlViewEngine({ cache: options.cache ?? true });

    return Object.freeze({
      module: ViewModule,
      id: "ViewModule",
      instanceId: Symbol("ViewModule"),
      imports: Object.freeze([]),
      controllers: Object.freeze([]),
      providers: Object.freeze([
        provideValue(VIEW_ENGINE, engine),
        provideClass(ViewService, [VIEW_ENGINE]),
      ]),
      exports: Object.freeze([VIEW_ENGINE, ViewService]),
    });
  }
}

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
}
