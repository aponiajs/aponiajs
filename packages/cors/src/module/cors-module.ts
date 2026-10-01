import { Module, type DynamicModule } from "@aponiajs/common";
import { PluginModule, provideConfiguration } from "@aponiajs/platform-elysia";
import { buildCorsPlugin } from "../policy/cors-policy.ts";
import type { CorsModuleOptions } from "./cors-module.types.ts";

const defaultKey = "cors";

/**
 * The module an application imports to answer cross-origin requests.
 *
 * ```ts
 * const cors = CorsModule.register({ configuration: CorsConfig });
 *
 * @Module({ imports: [cors] })
 * export class AppModule {}
 * ```
 *
 * `aponia build` cannot read a registration: it lowers a module only when every
 * `imports` entry names an entry that resolves to a `@Module()` class in the
 * project's own source, and a `DynamicModule` is not one — held in a `const`,
 * the module that imports it is declined and the committed descriptor artifact
 * holds nothing for it. The application is whole anyway: a boot is
 * handed an artifact holding no declaration for the root module it named, and
 * lowers that root from its decorators instead. What a decline costs is the
 * lowering, not the policy.
 *
 * There is no plugin value to export beside this module, the way
 * `@aponiajs/devtools` exports its own. That package can, because its plugin is
 * built from options fixed in source; this one's plugin is built from a value
 * the container resolves, so it exists only inside a boot. An application that
 * needs the route table untouched by a registration mounts the raw
 * `@elysia/cors` plugin through `AponiaApplicationOptions.plugins`, and gives up
 * the module and its validation to do it.
 *
 * The plugin is the `PluginModule` seam, which is the framework's one path for
 * a native plugin, and it is built through the async form because the policy is
 * built from a value the container resolved rather than from a constant this
 * module could hold. Nothing is provided beside the configuration: the plugin
 * is a hook over the application's own routes, and there is no per-boot state
 * for a service to own.
 */
@Module({})
export class CorsModule {
  /**
   * Builds the CORS module for one application.
   *
   * ```ts
   * @Module({ imports: [CorsModule.register({ configuration: CorsConfig })] })
   * export class AppModule {}
   * ```
   */
  static register(options: CorsModuleOptions): DynamicModule {
    const { configuration, source, key } = options;

    // The framework's own seam for a plugin built from an injected value. The
    // plugin is a `PluginModule` because that is what puts it in the module graph
    // and in the application's route table; it is built through the async form
    // because the policy is a validated configuration the container has to
    // resolve first.
    const pluginModule = PluginModule.registerAsync({
      key: key ?? defaultKey,
      inject: [configuration],
      useFactory: (value) => buildCorsPlugin(value, configuration),
    });

    return Object.freeze({
      ...pluginModule,
      imports: Object.freeze([]),
      // The plugin injects the configuration, so the value is validated before
      // the policy is built: a configuration the schema refuses fails the boot in
      // the provider pass, naming the configuration and its issues, rather than
      // reaching the guard as an object nobody wrote.
      providers: Object.freeze([
        provideConfiguration(configuration, source === undefined ? undefined : { source }),
        // Never empty in practice — the seam's own factory is always there — but
        // the type says a `DynamicModule` may declare no providers, and reading
        // it as one that always does is the assumption rather than the check.
        ...(pluginModule.providers ?? []),
      ]),
      // Exported so the application that mounted this module reads back the same
      // validated value the policy carries, rather than declaring the token a
      // second time.
      exports: Object.freeze([configuration]),
    });
  }
}
