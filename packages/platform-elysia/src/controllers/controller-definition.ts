import {
  AponiaError,
  tokenName,
  type Constructor,
  type ControllerDefinition,
  type Token,
  type TokenValues,
} from "@aponiajs/common";
import { Elysia, type AnyElysia } from "elysia";
import { ELYSIA_CONTROLLER } from "./controller.constants.ts";
import type {
  ElysiaControllerRegistrationResult,
  ElysiaControllerDefinition,
  ElysiaControllerPluginOptions,
  ElysiaControllerRegistrationOptions,
  RegisteredElysiaControllerDefinition,
  RegisteredElysiaApplication,
  RuntimeElysiaController,
} from "./controller.types.ts";

export { ELYSIA_CONTROLLER } from "./controller.constants.ts";

export function defineElysiaController<
  TController,
  const TDependencies extends readonly Token<unknown>[],
  const TRegistrationResult extends ElysiaControllerRegistrationResult,
>(
  useClass: Constructor<TController, TokenValues<TDependencies>>,
  options: ElysiaControllerRegistrationOptions<TController, TDependencies, TRegistrationResult>,
): RegisteredElysiaControllerDefinition<TController, TDependencies, TRegistrationResult>;
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
  const TRegistrationResult extends ElysiaControllerRegistrationResult,
>(
  useClass: Constructor<TController, TokenValues<TDependencies>>,
  options:
    | ElysiaControllerRegistrationOptions<TController, TDependencies, TRegistrationResult>
    | ElysiaControllerPluginOptions<TController, TDependencies, TPlugin>,
):
  | RegisteredElysiaControllerDefinition<TController, TDependencies, TRegistrationResult>
  | ElysiaControllerDefinition<TController, TDependencies, TPlugin> {
  return createElysiaControllerDefinition(useClass, options);
}

/**
 * Defines a directly registered Elysia controller with native callback
 * inference and no options object.
 */
export function elysiaController<
  TController,
  const TRegistrationResult extends ElysiaControllerRegistrationResult,
>(
  useClass: Constructor<TController, readonly []>,
  registerRoutes: (application: Elysia, controller: TController) => TRegistrationResult,
): RegisteredElysiaControllerDefinition<TController, readonly [], TRegistrationResult>;
export function elysiaController<
  TController,
  const TDependencies extends readonly Token<unknown>[],
  const TRegistrationResult extends ElysiaControllerRegistrationResult,
>(
  useClass: Constructor<TController, TokenValues<TDependencies>>,
  inject: TDependencies,
  registerRoutes: (application: Elysia, controller: TController) => TRegistrationResult,
): RegisteredElysiaControllerDefinition<TController, TDependencies, TRegistrationResult>;
export function elysiaController<
  TController,
  const TDependencies extends readonly Token<unknown>[],
  const TRegistrationResult extends ElysiaControllerRegistrationResult,
>(
  useClass: Constructor<TController, TokenValues<TDependencies>>,
  injectOrRegisterRoutes:
    | TDependencies
    | ((application: Elysia, controller: TController) => TRegistrationResult),
  registerRoutes?: (application: Elysia, controller: TController) => TRegistrationResult,
): RegisteredElysiaControllerDefinition<TController, TDependencies, TRegistrationResult> {
  const usesDependencies = typeof injectOrRegisterRoutes !== "function";
  const resolvedRegisterRoutes = usesDependencies ? registerRoutes : injectOrRegisterRoutes;
  if (!resolvedRegisterRoutes) {
    throw new TypeError("elysiaController requires a route registration callback.");
  }

  const inject = (usesDependencies
    ? injectOrRegisterRoutes
    : Object.freeze([])) as unknown as TDependencies;
  return defineElysiaController(useClass, {
    inject,
    registerRoutes: resolvedRegisterRoutes,
  });
}

function createElysiaControllerDefinition<
  TController,
  const TDependencies extends readonly Token<unknown>[],
  const TPlugin extends AnyElysia,
  const TRegistrationResult extends ElysiaControllerRegistrationResult,
>(
  useClass: Constructor<TController, TokenValues<TDependencies>>,
  options:
    | ElysiaControllerRegistrationOptions<TController, TDependencies, TRegistrationResult>
    | ElysiaControllerPluginOptions<TController, TDependencies, TPlugin>,
):
  | RegisteredElysiaControllerDefinition<TController, TDependencies, TRegistrationResult>
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
        registerRoutesOnApplication(useClass.name, registerRoutes, plugin, controller);
        return plugin as RegisteredElysiaApplication<TRegistrationResult>;
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

/**
 * Registers a low-level controller on the shared root application while
 * preserving the same-instance invariant required for native Elysia typing.
 *
 * @internal
 */
export function registerElysiaControllerRoutes(
  controller: RuntimeElysiaController,
  application: Elysia,
  instance: unknown,
): void {
  const registerRoutes = controller.registerRoutes;
  if (!registerRoutes) {
    return;
  }

  registerRoutesOnApplication(
    tokenName(controller.token),
    registerRoutes,
    application,
    instance as never,
  );
}

function registerRoutesOnApplication<TController>(
  controllerName: string,
  registerRoutes: (
    application: Elysia,
    controller: TController,
  ) => ElysiaControllerRegistrationResult,
  application: Elysia,
  controller: TController,
): void {
  const registeredApplication = registerRoutes(application, controller);
  if (registeredApplication !== undefined && registeredApplication !== application) {
    throw new AponiaError(
      "INVALID_CONTROLLER",
      `Route registration for "${controllerName}" must return the Elysia application it receives.`,
      { controller: controllerName },
    );
  }
}
