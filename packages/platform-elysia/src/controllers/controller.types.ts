import type {
  Constructor,
  ControllerDefinition,
  InjectionDependency,
  Token,
  TokenMap,
} from "@aponiajs/common";
import type { AnyElysia, Elysia } from "elysia";
import type { CompiledElysiaRoute } from "../routing/route-compiler.types.ts";
import type { RoutePlan } from "../routing/route-plan.types.ts";
import type { CONTROLLER_KIND } from "./controller.constants.ts";

/** A descriptor-first controller carrying a native plugin. */
export interface ControllerDescriptor<
  TController,
  TDependencies extends readonly InjectionDependency[],
  TPlugin extends AnyElysia,
> extends ControllerDefinition {
  readonly kind: typeof CONTROLLER_KIND;
  /** The dependency list the construction resolves. */
  readonly inject: TDependencies;
  readonly useClass: Constructor<TController, TokenMap<TDependencies>>;
  /** Builds the native plugin from the constructed controller. */
  readonly buildPlugin: (controller: TController) => TPlugin;
}

/** What a direct-registration callback returns: a fluent chain, or nothing. */
export type ControllerRegistrationResult = AnyElysia | void;

/** The application a registration callback returns: the chain, or a plain Elysia. */
export type RegisteredApplication<TRegistrationResult extends ControllerRegistrationResult> =
  TRegistrationResult extends AnyElysia ? TRegistrationResult : Elysia;

/** A descriptor-first controller carrying a registration callback. */
export interface RegisteredControllerDefinition<
  TController,
  TDependencies extends readonly InjectionDependency[],
  TRegistrationResult extends ControllerRegistrationResult = void,
> extends ControllerDescriptor<
  TController,
  TDependencies,
  RegisteredApplication<TRegistrationResult>
> {
  /** The controller's own path, joined onto each route it mounts. */
  readonly path?: string;
  /** Mounts the controller's routes on the shared root application. */
  readonly registerRoutes: (application: Elysia, controller: TController) => TRegistrationResult;
}

/** The `defineController` options for a plugin-carrying controller. */
export interface ControllerPluginOptions<
  TController,
  TDependencies extends readonly InjectionDependency[],
  TPlugin extends AnyElysia,
> {
  /** The dependency list the construction resolves. */
  readonly inject: TDependencies;
  /** Builds the native plugin from the constructed controller. */
  readonly buildPlugin: (controller: TController) => TPlugin;
}

/** The `defineController` options for a callback-registered controller. */
export interface ControllerRegistrationOptions<
  TController,
  TDependencies extends readonly InjectionDependency[],
  TRegistrationResult extends ControllerRegistrationResult = void,
> {
  /** The dependency list the construction resolves. */
  readonly inject: TDependencies;
  /** The controller's own path, joined onto each route it mounts. */
  readonly path?: string;
  /** Mounts the controller's routes on the shared root application. */
  readonly registerRoutes: (application: Elysia, controller: TController) => TRegistrationResult;
}

/** What `defineControllerRoutes` accepts. */
export interface ControllerRoutesOptions<
  TDependencies extends readonly InjectionDependency[] = readonly InjectionDependency[],
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

/** A mounted runtime controller: compiled plans plus the registration callback. */
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
