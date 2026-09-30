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

const ELYSIA_PLUGIN = createToken<ElysiaPlugin>("aponia.elysia.native-plugin");

const keyedModuleIdentityPrefix = "aponia.elysia.plugin-module:";

@Module({})
export class PluginModule {
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
 * Convert a native Elysia plugin into a module import for either `@Module` or
 * `defineModule`. The result doubles as the plugin type an
 * `HandlerContext` reads:
 *
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

export function isPluginModule(module: ModuleDefinition): boolean {
  return module.providers.some((provider) => provider.provide === ELYSIA_PLUGIN);
}

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
