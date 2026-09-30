import type { Constructor, ControllerDefinition, Token, TokenMap } from "@aponiajs/common";
import type { AnyElysia, Elysia } from "elysia";
import type { CompiledElysiaRoute } from "../routing/route-compiler.types.ts";
import type { RoutePlan } from "../routing/route-plan.types.ts";
import type { CONTROLLER_KIND } from "./controller.constants.ts";

export interface ControllerDescriptor<
  TController,
  TDependencies extends readonly Token<unknown>[],
  TPlugin extends AnyElysia,
> extends ControllerDefinition {
  readonly kind: typeof CONTROLLER_KIND;
  readonly inject: TDependencies;
  readonly useClass: Constructor<TController, TokenMap<TDependencies>>;
  readonly buildPlugin: (controller: TController) => TPlugin;
}

export type ControllerRegistrationResult = AnyElysia | void;

export type RegisteredApplication<TRegistrationResult extends ControllerRegistrationResult> =
  TRegistrationResult extends AnyElysia ? TRegistrationResult : Elysia;

export interface RegisteredControllerDefinition<
  TController,
  TDependencies extends readonly Token<unknown>[],
  TRegistrationResult extends ControllerRegistrationResult = void,
> extends ControllerDescriptor<
  TController,
  TDependencies,
  RegisteredApplication<TRegistrationResult>
> {
  readonly path?: string;
  readonly registerRoutes: (application: Elysia, controller: TController) => TRegistrationResult;
}

export interface ControllerPluginOptions<
  TController,
  TDependencies extends readonly Token<unknown>[],
  TPlugin extends AnyElysia,
> {
  readonly inject: TDependencies;
  readonly buildPlugin: (controller: TController) => TPlugin;
}

export interface ControllerRegistrationOptions<
  TController,
  TDependencies extends readonly Token<unknown>[],
  TRegistrationResult extends ControllerRegistrationResult = void,
> {
  readonly inject: TDependencies;
  readonly path?: string;
  readonly registerRoutes: (application: Elysia, controller: TController) => TRegistrationResult;
}

/** What `defineControllerRoutes` accepts. */
export interface ControllerRoutesOptions<
  TDependencies extends readonly Token<unknown>[] = readonly Token<unknown>[],
> {
  /** The controller's own path, joined onto each route plan's path. */
  readonly path?: string;
  /** The controller's constructor dependencies, as `defineController` takes them. */
  readonly inject?: TDependencies;
  /** The routes this controller declares. */
  readonly routes: readonly RoutePlan[];
}

/**
 * A controller defined from route plans instead of decorators.
 *
 * `compiledRoutes` is what lets bootstrap register the controller with the same
 * path a decorated one takes — including preferring a generated invoker for each
 * handler — rather than through `registerRoutes` or `buildPlugin`.
 *
 * @internal
 */
export interface DeclaredControllerDefinition<
  TController,
  TDependencies extends readonly Token<unknown>[],
> extends RegisteredControllerDefinition<TController, TDependencies> {
  readonly compiledRoutes: readonly CompiledElysiaRoute[];
}

export interface RuntimeElysiaController extends ControllerDefinition {
  readonly kind: typeof CONTROLLER_KIND;
  readonly path?: string;
  readonly buildPlugin: (controller: never) => AnyElysia;
  /**
   * Route plans retained for diagnostics and future build-time emitters.
   *
   * @internal
   */
  readonly compiledRoutes?: readonly CompiledElysiaRoute[];
  /**
   * Registers a compiled controller directly on the root application.
   *
   * The signature is the registration callback a caller writes, because this is
   * what a definition's own `buildPlugin` mounts through: a plugin built outside
   * a boot has no container to resolve enhancers against, so the routes it
   * carries mount with the validators their schemas declare and no enhancer
   * hooks. Bootstrap mounts a controller that carries `compiledRoutes` itself,
   * where the resolution exists.
   *
   * @internal
   */
  readonly registerRoutes?: (
    application: Elysia,
    controller: never,
  ) => ControllerRegistrationResult;
}
