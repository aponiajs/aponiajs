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
  AsyncElysiaPluginModuleOptions,
  ElysiaPluginImport,
  ElysiaPluginModuleOptions,
  NativeElysiaPlugin,
} from "./plugin.types.ts";

const ELYSIA_PLUGIN = createToken<NativeElysiaPlugin>("aponia.elysia.native-plugin");

const keyedModuleIdentityPrefix = "aponia.elysia.plugin-module:";

@Module({})
export class ElysiaPluginModule {
  static register<const TPlugin extends NativeElysiaPlugin>(
    plugin: TPlugin,
    options: ElysiaPluginModuleOptions = {},
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
    const TPlugin extends NativeElysiaPlugin,
  >(options: AsyncElysiaPluginModuleOptions<TDependencies, TPlugin>): DynamicModule {
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
 * `ElysiaRouteContext` reads:
 *
 * ```ts
 * export const clock = defineElysiaPlugin(new Elysia({ name: "clock" }), { key: "clock" });
 * export type clock = typeof clock;
 * ```
 */
export function defineElysiaPlugin<const TPlugin extends AnyElysia>(
  plugin: TPlugin,
  options: ElysiaPluginModuleOptions = {},
): ElysiaPluginImport<TPlugin> {
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

export function isElysiaPluginModule(module: ModuleDefinition): boolean {
  return module.providers.some((provider) => provider.provide === ELYSIA_PLUGIN);
}

export function getElysiaPlugin(
  container: AponiaContainer,
  module: ModuleDefinition,
): NativeElysiaPlugin {
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
  const id = hasStableKey ? `ElysiaPluginModule[${key}]` : "ElysiaPluginModule";
  const instanceId = hasStableKey ? Symbol.for(`${keyedModuleIdentityPrefix}${key}`) : Symbol(id);

  return Object.freeze({
    module: ElysiaPluginModule,
    id,
    instanceId,
    imports: Object.freeze([...(metadata.imports ?? [])]),
    providers: Object.freeze([...(metadata.providers ?? [])]),
  });
}
