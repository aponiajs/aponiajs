import {
  Module,
  createToken,
  provideFactory,
  provideValue,
  type DynamicModule,
  type Provider,
  type Token,
} from "@aponiajs/common";
import { providePlatformModule, type PlatformModuleAdapter } from "@aponiajs/common";
import type { AnyElysia } from "elysia";
import type {
  AsyncPluginModuleOptions,
  PluginImport,
  PluginModuleOptions,
  ElysiaPlugin,
} from "./plugin.types.ts";

/**
 * The private token carrying the native Elysia plugin a registration mounted.
 * @internal
 */
export const ELYSIA_PLUGIN = createToken<ElysiaPlugin>("aponia.elysia.native-plugin");

/**
 * The private token carrying the mount that installs the plugin above.
 * @internal
 */
export const ELYSIA_PLUGIN_ADAPTER = createToken<PlatformModuleAdapter<AnyElysia>>(
  "aponia.elysia.plugin-adapter",
);

const keyedModuleIdentityPrefix = "aponia.elysia.plugin-module:";

/**
 * The framework's one path for a native plugin to join the module graph.
 *
 * `register` mounts an existing plugin value; `registerAsync` builds one from
 * container values once per boot. Both state the platform declaration the
 * neutral boot reads, so the plugin mounts through the same seam a package
 * using any other platform does.
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
   * providers it names exist.
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
  assertPluginKey(options.key);
  const providers = Object.freeze([
    provideValue(ELYSIA_PLUGIN, plugin),
    ...elysiaPluginProviders(options.key ?? "PluginModule"),
  ]);
  const module = createPluginModule({ providers }, options.key);

  return Object.freeze({
    ...module,
    imports: Object.freeze([] as const),
    controllers: Object.freeze([] as const),
    providers,
    exports: Object.freeze([] as const),
    plugin,
  });
}

/** The mount that installs whatever `ELYSIA_PLUGIN` carries, plus its declaration. */
function elysiaPluginProviders(key: string): readonly Provider[] {
  return Object.freeze([
    provideFactory(ELYSIA_PLUGIN_ADAPTER, [ELYSIA_PLUGIN], (plugin: ElysiaPlugin) => {
      return (application: AnyElysia): void => {
        application.use(plugin);
      };
    }),
    providePlatformModule({
      key,
      platforms: ["elysia"],
      adapters: { elysia: ELYSIA_PLUGIN_ADAPTER },
    }),
  ]);
}

/** Refuses an empty identity before anything is built from it. */
function assertPluginKey(key: string | undefined): void {
  if (key !== undefined && key.trim().length === 0) {
    throw new TypeError("Elysia plugin module key must not be empty.");
  }
}

/**
 * The providers that make a native plugin value mount through the neutral seam.
 *
 * @param key - The module identity a refusal names.
 * @returns The mount provider and the platform declaration.
 *
 * @internal
 */
export function provideElysiaPlugin(key: string): readonly Provider[] {
  return elysiaPluginProviders(key);
}

function createPluginModule(
  metadata: Pick<DynamicModule, "imports" | "providers">,
  key: string | undefined,
): DynamicModule {
  assertPluginKey(key);

  const hasStableKey = key !== undefined;
  const id = hasStableKey ? `PluginModule[${key}]` : "PluginModule";
  const instanceId = hasStableKey ? Symbol.for(`${keyedModuleIdentityPrefix}${key}`) : Symbol(id);

  return Object.freeze({
    module: PluginModule,
    id,
    instanceId,
    imports: Object.freeze([...(metadata.imports ?? [])]),
    providers: Object.freeze([
      ...(metadata.providers ?? []),
      ...elysiaPluginProviders(key ?? "PluginModule"),
    ]),
  });
}
