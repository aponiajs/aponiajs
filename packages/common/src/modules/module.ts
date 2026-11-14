import type { DynamicModule, DynamicModuleOptions } from "../decorators/decorators.types.ts";
import { normalizeProvider } from "../providers/provider.ts";
import type { ModuleDescriptor, ModuleOptions } from "./module.types.ts";

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
