import type { ModuleDescriptor, ModuleOptions } from "./module.types.ts";

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
