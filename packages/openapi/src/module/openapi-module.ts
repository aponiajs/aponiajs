import { Module, type DynamicModule } from "@aponiajs/common";
import { PluginModule, provideConfiguration } from "@aponiajs/platform-elysia";
import { createOpenApiPlugin } from "../document/openapi-document.ts";
import type { OpenApiModuleOptions } from "./openapi-module.types.ts";

const defaultKey = "openapi";
const defaultPath = "/openapi";

/**
 * The module an application imports to serve an OpenAPI document for its own
 * routes.
 *
 * ```ts
 * const document = OpenApiModule.register({ configuration: OpenApiConfig });
 *
 * @Module({ imports: [document] })
 * export class AppModule {}
 * ```
 *
 * `aponia build` cannot read a registration: it lowers a module only when every
 * `imports` entry names an entry that resolves to a `@Module()` class in the
 * project's own source, and a `DynamicModule` is not one — inline or held in a
 * `const`, the module that imports it is declined and the committed descriptor
 * artifact holds nothing for it. The application is whole anyway: a boot is
 * handed an artifact holding no declaration for the root module it named, and
 * lowers that root from its decorators instead. What a decline costs is the
 * lowering, not the document.
 *
 * The plugin is the `PluginModule` seam, which is the framework's one path for
 * a native plugin, and it is built through the async form because the document
 * is built from a value the container resolved rather than from a constant this
 * module could hold. Nothing is provided beside the configuration: the plugin
 * is a route, and there is no per-boot state for a service to own.
 */
@Module({})
export class OpenApiModule {
  /**
   * Builds the OpenAPI module for one application.
   *
   * ```ts
   * @Module({ imports: [OpenApiModule.register({ configuration: OpenApiConfig })] })
   * export class AppModule {}
   * ```
   */
  static register(options: OpenApiModuleOptions): DynamicModule {
    const { configuration, source, key, path } = options;
    const documentPath = path ?? defaultPath;

    assertDocumentPath(documentPath);

    // The framework's own seam for a plugin built from an injected value. The
    // plugin is a `PluginModule` because that is what puts it in the module graph
    // and in the application's route table; it is built through the async form
    // because the document's metadata is a validated configuration the container
    // has to resolve first.
    const pluginModule = PluginModule.registerAsync({
      key: key ?? defaultKey,
      inject: [configuration],
      useFactory: (value) => createOpenApiPlugin(value, { configuration, path: documentPath }),
    });

    return Object.freeze({
      ...pluginModule,
      imports: Object.freeze([]),
      // The plugin injects the configuration, so the value is validated before
      // the document is built: metadata the schema refuses fails the boot in the
      // provider pass, naming the configuration and its issues, rather than
      // reaching the guard as an object nobody wrote.
      providers: Object.freeze([
        provideConfiguration(configuration, source === undefined ? undefined : { source }),
        // Never empty in practice — the seam's own factory is always there — but
        // the type says a `DynamicModule` may declare no providers, and reading
        // it as one that always does is the assumption rather than the check.
        ...(pluginModule.providers ?? []),
      ]),
      // Exported so the application that mounted this module reads back the same
      // validated value the document carries, rather than declaring the token a
      // second time.
      exports: Object.freeze([configuration]),
    });
  }
}

/**
 * Refuses a mount path that is not an absolute path, while the registration
 * runs.
 *
 * A `TypeError` rather than an `AponiaError`, and the split is the one the rest
 * of this framework makes: a configuration is data an environment supplies, so
 * refusing it means a code and an issue list a deployment can act on, while a
 * mount path is written in source, where a wrong one is a programming mistake
 * that a stack trace names better than an error code does.
 */
function assertDocumentPath(path: unknown): asserts path is string {
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new TypeError('An OpenAPI document path must be an absolute path such as "/openapi".');
  }
}
