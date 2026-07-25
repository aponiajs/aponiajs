import type { ControllerDefinition } from "./controller.ts";
import type { Provider } from "./provider.ts";
import type { Token } from "./token.ts";

export interface ModuleDefinition {
  readonly id: string;
  readonly imports: readonly ModuleDefinition[];
  readonly controllers: readonly ControllerDefinition[];
  readonly providers: readonly Provider[];
  readonly exports: readonly Token<unknown>[];
}

export interface ModuleOptions {
  readonly id: string;
  readonly imports?: readonly ModuleDefinition[];
  readonly controllers?: readonly ControllerDefinition[];
  readonly providers?: readonly Provider[];
  readonly exports?: readonly Token<unknown>[];
}

export function defineModule<const TOptions extends ModuleOptions>(
  options: TOptions,
): ModuleDefinition & TOptions {
  return Object.freeze({
    ...options,
    imports: Object.freeze([...(options.imports ?? [])]),
    controllers: Object.freeze([...(options.controllers ?? [])]),
    providers: Object.freeze([...(options.providers ?? [])]),
    exports: Object.freeze([...(options.exports ?? [])]),
  });
}
