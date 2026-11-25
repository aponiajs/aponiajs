import type { DynamicModule, DynamicModuleOptions } from "../interfaces/decorators.interface.ts";
import { normalizeProvider } from "../providers/provider.ts";
import type { Provider } from "../interfaces/provider.interface.ts";
import type { ModuleDescriptor, ModuleOptions } from "../interfaces/module.interface.ts";

/**
 * Declares a module descriptor by hand, without decorators.
 *
 * Omitted collections normalize to frozen empty tuples; declared ones keep
 * their exact tuple types rather than widening to arrays.
 *
 * @param options - The module's imports, controllers, providers, and exports.
 * @returns A frozen module descriptor the graph compiles.
 *
 * @example
 * ```ts
 * const app = defineModule({ id: "app", providers: [provideValue(NAME, "api")] });
 * ```
 */
export function defineModule<const TOptions extends ModuleOptions>(
  options: TOptions,
): ModuleDescriptor<TOptions> {
  return Object.freeze({
    ...options,
    imports: Object.freeze([...(options.imports ?? [])]),
    controllers: Object.freeze([...(options.controllers ?? [])]),
    providers: Object.freeze(
      [...(options.providers ?? [])].map((provider) => normalizeProvider(provider)),
    ),
    exports: Object.freeze([...(options.exports ?? [])]),
  }) as ModuleDescriptor<TOptions>;
}

/**
 * Builds a module registration, deriving the identity a Nest-style
 * `forRoot()` would otherwise have to state.
 *
 * The class name is the default `id`; a fresh symbol is the default
 * `instanceId`, which keeps two registrations of one class distinct in the
 * graph. The returned value is frozen.
 *
 * @param options - The class, optional identity, and the collections the graph
 * compiles.
 * @returns A frozen registration an `imports` array accepts.
 *
 * @example
 * ```ts
 * static forRoot(): DynamicModule {
 *   return dynamicModule({ module: UsersModule, providers: [provideValue(NAME, "users")] });
 * }
 * ```
 */
export function dynamicModule(options: DynamicModuleOptions): DynamicModule {
  const id = options.id ?? options.module.name;
  return Object.freeze({
    ...options,
    id,
    instanceId: options.instanceId ?? Symbol(id),
  });
}

/**
 * Appends the providers an asynchronous registration supplied beside the ones a
 * plugin module already declares.
 *
 * A module that builds its registration through a helper (a plugin seam, a
 * generated module) has no way to accept `extraProviders` itself, so the plugin
 * merges them here. The input module is never mutated, and an empty list is the
 * module unchanged.
 *
 * @param module - The registration the helper built.
 * @param providers - The extra providers the caller supplied, if any.
 * @returns A frozen registration carrying the extra providers.
 */
export function withModuleProviders(
  module: DynamicModule,
  providers: readonly Provider[] | undefined,
): DynamicModule {
  if (providers === undefined || providers.length === 0) {
    return module;
  }
  return Object.freeze({
    ...module,
    providers: Object.freeze([...(module.providers ?? []), ...providers]),
  });
}
