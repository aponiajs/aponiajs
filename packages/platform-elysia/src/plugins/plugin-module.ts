import {
  Module,
  createToken,
  provideFactory,
  provideValue,
  type DynamicModule,
  type ModuleDefinition,
  type Token,
} from "@aponiajs/common";
import type { AponiaContainer } from "@aponiajs/core";
import type { AnyElysia } from "elysia";
import type {
  AsyncPluginModuleOptions,
  PluginImport,
  PluginModuleOptions,
  ElysiaPlugin,
} from "./plugin.types.ts";

/**
 * The private token marking a provider as carrying a native Elysia plugin to mount.
 * @internal
 */
export const ELYSIA_PLUGIN = createToken<ElysiaPlugin>("aponia.elysia.native-plugin");

const keyedModuleIdentityPrefix = "aponia.elysia.plugin-module:";

/**
 * The framework's one path for a native plugin to join the module graph.
 *
 * `register` mounts an existing plugin value; `registerAsync` builds one from
 * container values once per boot. The boot recognizes the module by its
 * private plugin token, which only this seam provides.
 */
@Module({})
export class PluginModule {
  /**
   * Mounts an existing plugin value as a module import.
   *
   * The value must exist when the module is evaluated; a plugin built from
   * something the container resolves needs `registerAsync` instead.
   *
   * @param plugin - The native plugin to mount.
   * @param options - The module identity; `key` defaults to a fresh symbol.
   * @returns A frozen module import the application's `imports` accepts.
   *
   * @example
   * ```ts
   * const policy = PluginModule.register(cors({ origin: ["https://app.example"] }), { key: "cors" });
   * ```
   */
  static register<const TPlugin extends ElysiaPlugin>(
    plugin: TPlugin,
    options: PluginModuleOptions = {},
  ): DynamicModule {
    return createPluginModule(
      {
        providers: [provideValue(ELYSIA_PLUGIN, plugin)],
      },
      options.key,
    );
  }

  /**
   * Mounts a plugin built from container values as a module import.
   *
   * The framework's one seam for a plugin that does not exist until the
   * container has built one: the factory runs once per boot, after the
   * providers it names exist. The boot recognizes the module by its private
   * `ELYSIA_PLUGIN` token, which only this seam provides.
   *
   * @param options - The key, imports, injected tokens, and factory building the plugin.
   * @returns A frozen module import the application's `imports` accepts.
   *
   * @example
   * ```ts
   * const pluginModule = PluginModule.registerAsync({
   *   key: "cors",
   *   inject: [CorsConfig],
   *   useFactory: (value) => buildCorsPlugin(value, CorsConfig),
   * });
   * ```
   */
  static registerAsync<
    const TDependencies extends readonly Token<unknown>[],
    const TPlugin extends ElysiaPlugin,
  >(options: AsyncPluginModuleOptions<TDependencies, TPlugin>): DynamicModule {
    return createPluginModule(
      {
        imports: options.imports,
        providers: [provideFactory(ELYSIA_PLUGIN, options.inject, options.useFactory)],
      },
      options.key,
    );
  }
}

/**
 * Converts a native Elysia plugin into a module import for either `@Module` or
 * `defineModule. The result doubles as the plugin type an
 * `HandlerContext` reads.
 *
 * Exporting the result as a value beside a same-named type lets an annotation
 * drop `typeof`; TypeScript has no other way to name a value in a type
 * position.
 *
 * @param plugin - The native plugin to mount.
 * @param options - The module identity; `key` defaults to a fresh symbol.
 * @returns A frozen import carrying the plugin as a real `plugin` property.
 *
 * @example
 * ```ts
 * export const clock = definePlugin(new Elysia({ name: "clock" }), { key: "clock" });
 * export type clock = typeof clock;
 * ```
 */
export function definePlugin<const TPlugin extends AnyElysia>(
  plugin: TPlugin,
  options: PluginModuleOptions = {},
): PluginImport<TPlugin> {
  const pluginProvider = provideValue(ELYSIA_PLUGIN, plugin);
  const module = createPluginModule(
    {
      providers: [pluginProvider],
    },
    options.key,
  );

  return Object.freeze({
    ...module,
    imports: Object.freeze([] as const),
    controllers: Object.freeze([] as const),
    providers: Object.freeze([pluginProvider]),
    exports: Object.freeze([] as const),
    plugin,
  });
}

/**
 * Answers whether a module carries the private plugin token this seam provides.
 *
 * @param module - The module to test.
 * @returns `true` when the module was built through this seam.
 *
 * @internal
 */
export function isPluginModule(module: ModuleDefinition): boolean {
  return module.providers.some((provider) => provider.provide === ELYSIA_PLUGIN);
}

/**
 * Reads the native plugin a plugin module carries, through its owning module.
 *
 * @param container - The container the boot built.
 * @param module - The plugin module to read.
 * @returns The native plugin to mount.
 *
 * @internal
 */
export function getElysiaPlugin(
  container: AponiaContainer,
  module: ModuleDefinition,
): ElysiaPlugin {
  return container.resolveModuleProvider(module, ELYSIA_PLUGIN);
}

function createPluginModule(
  metadata: Pick<DynamicModule, "imports" | "providers">,
  key: string | undefined,
): DynamicModule {
  if (key !== undefined && key.trim().length === 0) {
    throw new TypeError("Elysia plugin module key must not be empty.");
  }

  const hasStableKey = key !== undefined;
  const id = hasStableKey ? `PluginModule[${key}]` : "PluginModule";
  const instanceId = hasStableKey ? Symbol.for(`${keyedModuleIdentityPrefix}${key}`) : Symbol(id);

  return Object.freeze({
    module: PluginModule,
    id,
    instanceId,
    imports: Object.freeze([...(metadata.imports ?? [])]),
    providers: Object.freeze([...(metadata.providers ?? [])]),
  });
}
