import {
  AponiaError,
  getTokenName,
  type ClassToken,
  type Constructor,
  type ControllerDefinition,
  type RouteParameterKind,
  type Token,
  type TokenMap,
} from "@aponiajs/common";
import { Elysia, type AnyElysia } from "elysia";
import { joinPaths, registerCompiledElysiaRoutes } from "../routing/route-compiler.ts";
import type { CompiledElysiaRoute } from "../routing/route-compiler.types.ts";
import type { RoutePlan } from "../routing/route-plan.types.ts";
import { CONTROLLER_KIND } from "./controller.constants.ts";
import { unmountedRouteEnhancers } from "./enhancer-resolver.ts";
import type {
  DeclaredControllerDefinition,
  ControllerRegistrationResult,
  ControllerDescriptor,
  ControllerPluginOptions,
  ControllerRegistrationOptions,
  ControllerRoutesOptions,
  RegisteredControllerDefinition,
  RegisteredApplication,
  RuntimeElysiaController,
} from "./controller.types.ts";

export { CONTROLLER_KIND } from "./controller.constants.ts";

export function defineController<
  TController,
  const TDependencies extends readonly Token<unknown>[],
  const TRegistrationResult extends ControllerRegistrationResult,
>(
  useClass: Constructor<TController, TokenMap<TDependencies>>,
  options: ControllerRegistrationOptions<TController, TDependencies, TRegistrationResult>,
): RegisteredControllerDefinition<TController, TDependencies, TRegistrationResult>;
export function defineController<
  TController,
  const TDependencies extends readonly Token<unknown>[],
  const TPlugin extends AnyElysia,
>(
  useClass: Constructor<TController, TokenMap<TDependencies>>,
  options: ControllerPluginOptions<TController, TDependencies, TPlugin>,
): ControllerDescriptor<TController, TDependencies, TPlugin>;
export function defineController<
  TController,
  const TDependencies extends readonly Token<unknown>[],
  const TPlugin extends AnyElysia,
  const TRegistrationResult extends ControllerRegistrationResult,
>(
  useClass: Constructor<TController, TokenMap<TDependencies>>,
  options:
    | ControllerRegistrationOptions<TController, TDependencies, TRegistrationResult>
    | ControllerPluginOptions<TController, TDependencies, TPlugin>,
):
  | RegisteredControllerDefinition<TController, TDependencies, TRegistrationResult>
  | ControllerDescriptor<TController, TDependencies, TPlugin> {
  return createControllerDefinition(useClass, options);
}

/**
 * Defines a directly registered Elysia controller with native callback
 * inference and no options object.
 */
export function controller<
  TController,
  const TRegistrationResult extends ControllerRegistrationResult,
>(
  useClass: Constructor<TController, readonly []>,
  registerRoutes: (application: Elysia, controller: TController) => TRegistrationResult,
): RegisteredControllerDefinition<TController, readonly [], TRegistrationResult>;
export function controller<
  TController,
  const TDependencies extends readonly Token<unknown>[],
  const TRegistrationResult extends ControllerRegistrationResult,
>(
  useClass: Constructor<TController, TokenMap<TDependencies>>,
  inject: TDependencies,
  registerRoutes: (application: Elysia, controller: TController) => TRegistrationResult,
): RegisteredControllerDefinition<TController, TDependencies, TRegistrationResult>;
export function controller<
  TController,
  const TDependencies extends readonly Token<unknown>[],
  const TRegistrationResult extends ControllerRegistrationResult,
>(
  useClass: Constructor<TController, TokenMap<TDependencies>>,
  injectOrRegisterRoutes:
    | TDependencies
    | ((application: Elysia, controller: TController) => TRegistrationResult),
  registerRoutes?: (application: Elysia, controller: TController) => TRegistrationResult,
): RegisteredControllerDefinition<TController, TDependencies, TRegistrationResult> {
  const usesDependencies = typeof injectOrRegisterRoutes !== "function";
  const resolvedRegisterRoutes = usesDependencies ? registerRoutes : injectOrRegisterRoutes;
  if (!resolvedRegisterRoutes) {
    throw new TypeError("controller requires a route registration callback.");
  }

  const inject = (usesDependencies
    ? injectOrRegisterRoutes
    : Object.freeze([])) as unknown as TDependencies;
  return defineController(useClass, {
    inject,
    registerRoutes: resolvedRegisterRoutes,
  });
}

function createControllerDefinition<
  TController,
  const TDependencies extends readonly Token<unknown>[],
  const TPlugin extends AnyElysia,
  const TRegistrationResult extends ControllerRegistrationResult,
>(
  useClass: Constructor<TController, TokenMap<TDependencies>>,
  options:
    | ControllerRegistrationOptions<TController, TDependencies, TRegistrationResult>
    | ControllerPluginOptions<TController, TDependencies, TPlugin>,
):
  | RegisteredControllerDefinition<TController, TDependencies, TRegistrationResult>
  | ControllerDescriptor<TController, TDependencies, TPlugin> {
  const common = {
    kind: CONTROLLER_KIND,
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
        return plugin as RegisteredApplication<TRegistrationResult>;
      },
    });
  }

  return Object.freeze({
    ...common,
    buildPlugin: options.buildPlugin,
  });
}

/**
 * Defines a controller whose routes are declared as data.
 *
 * This is the descriptor path's counterpart to decorating a class with
 * `@Controller()` and its route decorators, and it is what build-time descriptor
 * generation emits: the application keeps its decorators as the authoring
 * surface, while the generated module supplies the same routes without anyone
 * reading `reflect-metadata` at startup.
 *
 * The plans are lowered through the platform's own route compiler, so a
 * controller defined this way reaches the same native version guard, the same
 * duplicate-route check, the same startup logging, and the same
 * `AponiaApplicationOptions.invokers` lookup a decorated one does.
 */
export function defineControllerRoutes<
  TController,
  const TDependencies extends readonly Token<unknown>[] = readonly [],
>(
  useClass: Constructor<TController, TokenMap<TDependencies>>,
  options: ControllerRoutesOptions<TDependencies>,
): DeclaredControllerDefinition<TController, TDependencies> {
  const controllerPath = options.path ?? "";
  const routes = Object.freeze(
    options.routes.map((plan) => compileRoutePlan(plan, controllerPath)),
  );
  const registerRoutes = (application: Elysia, instance: unknown): void => {
    // A registration callback states the routes a caller mounts on its own, and
    // bootstrap mounts a controller that carries `compiledRoutes` itself. The
    // only caller left is this definition's own `buildPlugin`, which resolves
    // nothing, so the plan's enhancer declarations stay unmounted there.
    registerCompiledElysiaRoutes(
      application,
      useClass as ClassToken<unknown>,
      instance,
      routes,
      unmountedRouteEnhancers,
    );
  };

  return Object.freeze({
    kind: CONTROLLER_KIND,
    token: useClass,
    inject: Object.freeze([...(options.inject ?? [])]) as unknown as TDependencies,
    useClass,
    path: joinPaths(controllerPath, ""),
    compiledRoutes: routes,
    registerRoutes,
    buildPlugin: (controller: TController) => {
      const plugin = new Elysia();
      registerRoutes(plugin, controller);
      return plugin;
    },
  });
}

/**
 * Lowers one declared plan into the plan a decorated controller compiles to.
 *
 * `declaredParameterCount` is synthesized rather than left undefined because the
 * runtime's whole-context fallback reads it: a positive count or a zero count
 * settles the decision outright, while `undefined` sends it to reading the
 * handler's own source, which is the inference this path exists to remove.
 */
function compileRoutePlan(plan: RoutePlan, controllerPath: string): CompiledElysiaRoute {
  const parameters = plan.parameters ?? [];
  const takesContext = parameters.length === 0 && plan.takesContext === true;
  const capabilities: readonly RouteParameterKind[] =
    parameters.length === 0
      ? takesContext
        ? ["context"]
        : []
      : parameters.map((parameter) => parameter.kind);

  return Object.freeze({
    method: plan.method,
    path: joinPaths(controllerPath, plan.path),
    propertyKey: plan.propertyKey,
    parameters: Object.freeze([...parameters]),
    capabilities: Object.freeze([...new Set(capabilities)]),
    schema: plan.schema,
    declaredParameterCount: takesContext ? 1 : parameters.length,
    declaredReturnKind: plan.promiseCapable === false ? "synchronous" : "promise",
    enhancers: Object.freeze({
      guards: Object.freeze([...(plan.guards ?? [])]),
      interceptors: Object.freeze([...(plan.interceptors ?? [])]),
      filters: Object.freeze([...(plan.filters ?? [])]),
    }),
  });
}

export function isElysiaController(
  controller: ControllerDefinition,
): controller is RuntimeElysiaController {
  return controller.kind === CONTROLLER_KIND;
}

/**
 * Registers a low-level controller on the shared root application while
 * preserving the same-instance invariant required for native Elysia typing.
 *
 * The callback this calls mounts routes the platform never compiled, so it owns
 * their hooks and there is no enhancer resolution for bootstrap to merge: a
 * controller the platform does compile carries a plan, and bootstrap mounts the
 * plan itself.
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
    getTokenName(controller.token),
    registerRoutes,
    application,
    instance as never,
  );
}

function registerRoutesOnApplication<TController>(
  controllerName: string,
  registerRoutes: (application: Elysia, controller: TController) => ControllerRegistrationResult,
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
