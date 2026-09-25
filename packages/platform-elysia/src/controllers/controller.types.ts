import type { Constructor, ControllerDefinition, Token, TokenValues } from "@aponiajs/common";
import type { AnyElysia, Elysia } from "elysia";
import type { CompiledElysiaRoute } from "../routing/route-compiler.types.ts";
import type { ElysiaRoutePlan } from "../routing/route-plan.types.ts";
import type { ELYSIA_CONTROLLER } from "./controller.constants.ts";

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

export type ElysiaControllerRegistrationResult = AnyElysia | void;

export type RegisteredElysiaApplication<
  TRegistrationResult extends ElysiaControllerRegistrationResult,
> = TRegistrationResult extends AnyElysia ? TRegistrationResult : Elysia;

export interface RegisteredElysiaControllerDefinition<
  TController,
  TDependencies extends readonly Token<unknown>[],
  TRegistrationResult extends ElysiaControllerRegistrationResult = void,
> extends ElysiaControllerDefinition<
  TController,
  TDependencies,
  RegisteredElysiaApplication<TRegistrationResult>
> {
  readonly path?: string;
  readonly registerRoutes: (application: Elysia, controller: TController) => TRegistrationResult;
}

export interface ElysiaControllerPluginOptions<
  TController,
  TDependencies extends readonly Token<unknown>[],
  TPlugin extends AnyElysia,
> {
  readonly inject: TDependencies;
  readonly buildPlugin: (controller: TController) => TPlugin;
}

export interface ElysiaControllerRegistrationOptions<
  TController,
  TDependencies extends readonly Token<unknown>[],
  TRegistrationResult extends ElysiaControllerRegistrationResult = void,
> {
  readonly inject: TDependencies;
  readonly path?: string;
  readonly registerRoutes: (application: Elysia, controller: TController) => TRegistrationResult;
}

/** What `defineElysiaControllerRoutes` accepts. */
export interface ElysiaControllerRoutesOptions<
  TDependencies extends readonly Token<unknown>[] = readonly Token<unknown>[],
> {
  /** The controller's own path, joined onto each route plan's path. */
  readonly path?: string;
  /** The controller's constructor dependencies, as `defineElysiaController` takes them. */
  readonly inject?: TDependencies;
  /** The routes this controller declares. */
  readonly routes: readonly ElysiaRoutePlan[];
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
export interface DeclaredElysiaControllerDefinition<
  TController,
  TDependencies extends readonly Token<unknown>[],
> extends RegisteredElysiaControllerDefinition<TController, TDependencies> {
  readonly compiledRoutes: readonly CompiledElysiaRoute[];
}

export interface RuntimeElysiaController extends ControllerDefinition {
  readonly kind: typeof ELYSIA_CONTROLLER;
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
   * @internal
   */
  readonly registerRoutes?: (
    application: Elysia,
    controller: never,
  ) => ElysiaControllerRegistrationResult;
}
