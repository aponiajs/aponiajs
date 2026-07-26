import {
  Module,
  createToken,
  provideFactory,
  provideValue,
  type DynamicModule,
  type ModuleDefinition,
  type ModuleImport,
  type Token,
  type TokenValues,
} from "@aponiajs/common";
import type { AponiaContainer } from "@aponiajs/core";
import type { Elysia } from "elysia";

export type NativeElysiaPlugin = Parameters<Elysia["use"]>[0];

const ELYSIA_PLUGIN = createToken<NativeElysiaPlugin>("aponia.elysia.native-plugin");

const keyedModuleIdentityPrefix = "aponia.elysia.plugin-module:";

export interface ElysiaPluginModuleOptions {
  readonly key?: string;
}

export interface AsyncElysiaPluginModuleOptions<
  TDependencies extends readonly Token<unknown>[],
  TPlugin extends NativeElysiaPlugin,
> extends ElysiaPluginModuleOptions {
  readonly imports?: readonly ModuleImport[];
  readonly inject: TDependencies;
  readonly useFactory: (...dependencies: TokenValues<TDependencies>) => TPlugin;
}

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
