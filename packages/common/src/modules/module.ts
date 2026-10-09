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
    providers: Object.freeze([...(options.providers ?? [])]),
    exports: Object.freeze([...(options.exports ?? [])]),
  }) as ModuleDescriptor<TOptions>;
}
