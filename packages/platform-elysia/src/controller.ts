import type { Constructor, ControllerDefinition, Token, TokenValues } from "@aponiajs/common";
import type { AnyElysia } from "elysia";

export const ELYSIA_CONTROLLER = "aponia.elysia.controller";

export interface ElysiaControllerDefinition<
  TController,
  TDependencies extends readonly Token<unknown>[],
  TPlugin extends AnyElysia,
> extends ControllerDefinition {
  readonly kind: typeof ELYSIA_CONTROLLER;
  readonly inject: TDependencies;
  readonly useClass: Constructor<TController, TokenValues<TDependencies>>;
  readonly buildPlugin: (controller: TController) => TPlugin;
}

export function defineElysiaController<
  TController,
  const TDependencies extends readonly Token<unknown>[],
  const TPlugin extends AnyElysia,
>(
  useClass: Constructor<TController, TokenValues<TDependencies>>,
  options: {
    readonly inject: TDependencies;
    readonly buildPlugin: (controller: TController) => TPlugin;
  },
): ElysiaControllerDefinition<TController, TDependencies, TPlugin> {
  return Object.freeze({
    kind: ELYSIA_CONTROLLER,
    token: useClass,
    inject: Object.freeze([...options.inject]) as unknown as TDependencies,
    useClass,
    buildPlugin: options.buildPlugin,
  });
}

export interface RuntimeElysiaController extends ControllerDefinition {
  readonly kind: typeof ELYSIA_CONTROLLER;
  readonly path?: string;
  readonly buildPlugin: (controller: never) => AnyElysia;
}

export function isElysiaController(
  controller: ControllerDefinition,
): controller is RuntimeElysiaController {
  return controller.kind === ELYSIA_CONTROLLER;
}
