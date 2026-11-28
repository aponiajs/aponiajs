import {
  AponiaError,
  Global,
  Module,
  createToken,
  provideFactory,
  type DynamicModule,
  type Provider,
} from "@aponiajs/common";
import { VIEW_ENGINE } from "@aponiajs/common";
import type { ViewEngine, ViewModuleOptions } from "../interfaces/view.interface.ts";
import { HtmlViewEngine } from "../engines/html-view-engine.ts";
import { BladeViewEngine } from "../engines/blade-view-engine.ts";
import { setDefaultViewEngine } from "../helper/view-response.ts";
import { ViewService } from "./view.service.ts";
import {
  ConfigurableModuleClass,
  MODULE_OPTIONS_TOKEN,
  type ViewModuleExtras,
  type ViewModuleRegistrationAsyncOptions,
  type ViewModuleSyncOptions,
} from "./view.module-definition.ts";

const VIEW_OPTIONS = createToken<ViewModuleOptions>("aponia.view.options");

/**
 * Provides template rendering services for MVC applications.
 */
@Global()
@Module({})
export class ViewModule extends ConfigurableModuleClass {
  /**
   * Builds a view registration.
   *
   * @param options - The engine, template root, shared values, and cache policy.
   * @returns A frozen dynamic module an application imports.
   * @throws An `AponiaError` with `INVALID_CONFIGURATION_VALUE` when an option is invalid.
   */
  static forRoot(options: ViewModuleSyncOptions = {}): DynamicModule {
    resolveOptions(options);
    assertExtras(options);
    return registration(super.register(options));
  }

  /**
   * Builds a view registration whose options a factory, a class, or an existing
   * provider resolves.
   *
   * The options are resolved once when the options token first resolves, and
   * validated then, so a refused boot names the same issues `forRoot` reports.
   *
   * @param options - The imports, injected tokens, factory, extras, and extra providers.
   * @returns A frozen dynamic module an application imports.
   */
  static forRootAsync(options: ViewModuleRegistrationAsyncOptions): DynamicModule {
    assertExtras(options);
    return registration(super.registerAsync(options), options.extraProviders);
  }

  /**
   * Builds a view registration.
   *
   * @deprecated Use {@link ViewModule.forRoot}; retained for the beta line.
   */
  static override register(options: ViewModuleSyncOptions = {}): DynamicModule {
    return ViewModule.forRoot(options);
  }

  /**
   * Builds a view registration whose options a factory resolves.
   *
   * @deprecated Use {@link ViewModule.forRootAsync}; retained for the beta line.
   */
  static override registerAsync(options: ViewModuleRegistrationAsyncOptions): DynamicModule {
    return ViewModule.forRootAsync(options);
  }
}

function registration(
  definition: DynamicModule,
  extraProviders: readonly Provider[] = [],
): DynamicModule {
  return Object.freeze({
    ...definition,
    module: ViewModule,
    global: definition.global ?? true,
    imports: Object.freeze([...(definition.imports ?? [])]),
    controllers: Object.freeze([...(definition.controllers ?? [])]),
    providers: Object.freeze([
      ...(definition.providers ?? []),
      provideFactory(VIEW_OPTIONS, [MODULE_OPTIONS_TOKEN], (options: ViewModuleOptions) =>
        resolveOptions(options),
      ),
      provideFactory(VIEW_ENGINE, [VIEW_OPTIONS], (options: ViewModuleOptions) => {
        const engine: ViewEngine =
          options.engine ??
          (options.defaultEngine === "blade"
            ? new BladeViewEngine({
                rootDir: options.rootDir,
                shared: options.shared,
                cache: options.cache ?? true,
              })
            : new HtmlViewEngine({ cache: options.cache ?? true }));
        // The standalone `view()` helper reads one process-wide engine; the
        // registration installs the engine it built so a boot without
        // `application.get(VIEW_ENGINE)` renders through the same one.
        setDefaultViewEngine(engine);
        return engine;
      }),
      provideFactory(ViewService, [VIEW_ENGINE], (engine: ViewEngine) => new ViewService(engine)),
      ...extraProviders,
    ]),
    exports: Object.freeze([MODULE_OPTIONS_TOKEN, VIEW_ENGINE, ViewService]),
  });
}

function assertExtras(options: Partial<ViewModuleExtras>): void {
  if (options.isGlobal !== undefined && typeof options.isGlobal !== "boolean") {
    throw new AponiaError(
      "INVALID_CONFIGURATION_VALUE",
      "The view registration is invalid: isGlobal must be a boolean.",
      { configuration: "view", issues: Object.freeze(["isGlobal must be a boolean"]) },
    );
  }
}

function resolveOptions(options: ViewModuleOptions): ViewModuleOptions {
  const issues: string[] = [];

  if (options.rootDir !== undefined && typeof options.rootDir !== "string") {
    issues.push("rootDir must be a string");
  }
  if (
    options.defaultEngine !== undefined &&
    options.defaultEngine !== "html" &&
    options.defaultEngine !== "blade"
  ) {
    issues.push('defaultEngine must be "html" or "blade"');
  }
  if (options.cache !== undefined && typeof options.cache !== "boolean") {
    issues.push("cache must be a boolean");
  }
  if (
    options.engine !== undefined &&
    (typeof options.engine !== "object" ||
      options.engine === null ||
      typeof options.engine.render !== "function")
  ) {
    issues.push("engine must implement render()");
  }
  if (
    options.shared !== undefined &&
    (typeof options.shared !== "object" || options.shared === null)
  ) {
    issues.push("shared must be an object");
  }
  if (issues.length > 0) {
    throw new AponiaError(
      "INVALID_CONFIGURATION_VALUE",
      `The view registration is invalid: ${issues.join("; ")}.`,
      { configuration: "view", issues: Object.freeze(issues) },
    );
  }

  return Object.freeze({ ...options });
}
