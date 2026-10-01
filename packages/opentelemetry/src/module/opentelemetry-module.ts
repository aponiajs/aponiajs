import { Module, provideValue, type DynamicModule } from "@aponiajs/common";
import { PluginModule, provideConfiguration } from "@aponiajs/platform-elysia";
import { OpentelemetryShutdown } from "../tracing/opentelemetry-shutdown.ts";
import {
  buildOpentelemetryPlugin,
  type OpentelemetryRuntimeOptions,
} from "../tracing/opentelemetry-tracing.ts";
import type { OpentelemetryModuleOptions } from "./opentelemetry-module.types.ts";

const defaultKey = "opentelemetry";

/**
 * The module an application imports to trace its routes with OpenTelemetry.
 *
 * ```ts
 * const tracing = OpentelemetryModule.register({ configuration: OpentelemetryConfig });
 *
 * @Module({ imports: [tracing] })
 * export class AppModule {}
 * ```
 *
 * `aponia build` cannot read a registration: it lowers a module only when every
 * `imports` entry names an entry that resolves to a `@Module()` class in the
 * project's own source, and a `DynamicModule` is not one — held in a `const`,
 * the module that imports it is declined and the committed descriptor artifact
 * holds nothing for it. The application is whole anyway: a boot is handed an
 * artifact holding no declaration for the root module it named, and lowers that
 * root from its decorators instead. What a decline costs is the lowering, not
 * the tracing.
 *
 * There is no plugin value to export beside this module, the way
 * `@aponiajs/devtools` exports its own. That package can, because its plugin is
 * built from options fixed in source; this one's plugin is built from a value the
 * container resolves, so it exists only inside a boot. An application that needs
 * the route table untouched by a registration mounts the raw
 * `@elysia/opentelemetry` plugin through `AponiaApplicationOptions.plugins`, and
 * gives up the module and its validation to do it.
 *
 * The plugin is the `PluginModule` seam, which is the framework's one path for a
 * native plugin, and it is built through the async form because the policy is
 * built from a value the container resolved rather than from a constant this
 * module could hold.
 *
 * **One registration per process is the supported shape.** The plugin's `NodeSDK`
 * is process-global, and the first registration in a process owns it; see
 * `buildOpentelemetryPlugin` for what a second one does and does not get.
 */
@Module({})
export class OpentelemetryModule {
  /**
   * Builds the OpenTelemetry module for one application.
   *
   * ```ts
   * @Module({ imports: [OpentelemetryModule.register({ configuration: OpentelemetryConfig })] })
   * export class AppModule {}
   * ```
   */
  static register(options: OpentelemetryModuleOptions): DynamicModule {
    const { configuration, source, key, ...runtime } = options;
    const runtimeOptions: Readonly<OpentelemetryRuntimeOptions> = Object.freeze({ ...runtime });

    // The framework's own seam for a plugin built from an injected value. The
    // plugin is a `PluginModule` because that is what puts it in the module graph
    // and in the application's route table; it is built through the async form
    // because the policy is a validated configuration the container has to
    // resolve first.
    const pluginModule = PluginModule.registerAsync({
      key: key ?? defaultKey,
      inject: [configuration],
      useFactory: (value) => buildOpentelemetryPlugin(runtimeOptions, value, configuration),
    });

    return Object.freeze({
      ...pluginModule,
      imports: Object.freeze([]),
      // The plugin injects the configuration, so the value is validated before
      // the policy is built: a configuration the schema refuses fails the boot in
      // the provider pass, naming the configuration and its issues, rather than
      // reaching the plugin as an object nobody wrote.
      providers: Object.freeze([
        provideConfiguration(configuration, source === undefined ? undefined : { source }),
        // The one piece of per-boot state this package owns. The wrapped plugin's
        // `NodeSDK` is a closure inside the plugin and no lifecycle hook reaches
        // it, so what the module can still stop is the span processors the
        // application declared — and stopping them is a provider hook, which is
        // the only place the framework runs it. `cors` and `openapi` provide
        // nothing here because they own no state; this package does.
        provideValue(
          OpentelemetryShutdown,
          new OpentelemetryShutdown(runtimeOptions.spanProcessors ?? []),
        ),
        // Never empty in practice — the seam's own factory and the value above
        // are always there — but the type says a `DynamicModule` may declare no
        // providers, and reading it as one that always does is the assumption
        // rather than the check.
        ...(pluginModule.providers ?? []),
      ]),
      // Exported so the application that mounted this module reads back the same
      // validated value the policy carries, rather than declaring the token a
      // second time.
      exports: Object.freeze([configuration]),
    });
  }
}
