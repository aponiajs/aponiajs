import type { Constructor, ControllerDefinition, Token, TokenValues } from "@aponiajs/common";
import { Elysia, type AnyElysia } from "elysia";
import { ELYSIA_CONTROLLER } from "./controller.constants.ts";
import type {
  ElysiaControllerDefinition,
  ElysiaControllerPluginOptions,
  ElysiaControllerRegistrationOptions,
  RegisteredElysiaControllerDefinition,
  RuntimeElysiaController,
} from "./controller.types.ts";

export { ELYSIA_CONTROLLER } from "./controller.constants.ts";

export function defineElysiaController<
  TController,
  const TDependencies extends readonly Token<unknown>[],
>(
  useClass: Constructor<TController, TokenValues<TDependencies>>,
  options: ElysiaControllerRegistrationOptions<TController, TDependencies>,
): RegisteredElysiaControllerDefinition<TController, TDependencies>;
export function defineElysiaController<
  TController,
  const TDependencies extends readonly Token<unknown>[],
  const TPlugin extends AnyElysia,
>(
  useClass: Constructor<TController, TokenValues<TDependencies>>,
  options: ElysiaControllerPluginOptions<TController, TDependencies, TPlugin>,
): ElysiaControllerDefinition<TController, TDependencies, TPlugin>;
export function defineElysiaController<
  TController,
  const TDependencies extends readonly Token<unknown>[],
  const TPlugin extends AnyElysia,
>(
  useClass: Constructor<TController, TokenValues<TDependencies>>,
  options:
    | ElysiaControllerRegistrationOptions<TController, TDependencies>
    | ElysiaControllerPluginOptions<TController, TDependencies, TPlugin>,
):
  | RegisteredElysiaControllerDefinition<TController, TDependencies>
  | ElysiaControllerDefinition<TController, TDependencies, TPlugin> {
  return createElysiaControllerDefinition(useClass, options);
}

function createElysiaControllerDefinition<
  TController,
  const TDependencies extends readonly Token<unknown>[],
  const TPlugin extends AnyElysia,
>(
  useClass: Constructor<TController, TokenValues<TDependencies>>,
  options:
    | ElysiaControllerRegistrationOptions<TController, TDependencies>
    | ElysiaControllerPluginOptions<TController, TDependencies, TPlugin>,
):
  | RegisteredElysiaControllerDefinition<TController, TDependencies>
  | ElysiaControllerDefinition<TController, TDependencies, TPlugin> {
  const common = {
    kind: ELYSIA_CONTROLLER,
    token: useClass,
    inject: Object.freeze([...options.inject]) as unknown as TDependencies,
    useClass,
  } as const;
  if ("registerRoutes" in options) {
    const registerRoutes = options.registerRoutes;
    return Object.freeze({
      ...common,
      path: options.path,
      registerRoutes,
      buildPlugin: (controller: TController) => {
        const plugin = new Elysia();
        registerRoutes(plugin, controller);
        return plugin;
      },
    });
  }

  return Object.freeze({
    ...common,
    buildPlugin: options.buildPlugin,
  });
}

export function isElysiaController(
  controller: ControllerDefinition,
): controller is RuntimeElysiaController {
  return controller.kind === ELYSIA_CONTROLLER;
}
