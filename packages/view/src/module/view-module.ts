import { Module, provideFactory, provideValue, type DynamicModule } from "@aponiajs/common";
import { VIEW_ENGINE } from "@aponiajs/common";
import type { ViewEngine, ViewModuleOptions } from "./view.types.ts";
import { HtmlViewEngine } from "../engines/html-view-engine.ts";
import { BladeViewEngine } from "../engines/blade-view-engine.ts";

/**
 * ViewModule provides template rendering services for MVC applications.
 */
@Module({})
export class ViewModule {
  static register(options: ViewModuleOptions = {}): DynamicModule {
    const engine: ViewEngine =
      options.engine ??
      (options.defaultEngine === "blade"
        ? new BladeViewEngine({
            rootDir: options.rootDir,
            shared: options.shared,
            cache: options.cache ?? true,
          })
        : new HtmlViewEngine({ cache: options.cache ?? true }));

    return Object.freeze({
      module: ViewModule,
      id: "ViewModule",
      instanceId: Symbol("ViewModule"),
      global: true,
      imports: Object.freeze([]),
      controllers: Object.freeze([]),
      providers: Object.freeze([
        provideValue(VIEW_ENGINE, engine),
        provideFactory(ViewService, [VIEW_ENGINE], (resolved) => new ViewService(resolved)),
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

  /** Adds one value every subsequent render reads, when the engine supports it. */
  share(key: string, value: unknown): void {
    const share = (this.#engine as { share?: (key: string, value: unknown) => void }).share;
    share?.call(this.#engine, key, value);
  }
}
