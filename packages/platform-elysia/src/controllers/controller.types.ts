import type { Constructor, ControllerDefinition, Token, TokenValues } from "@aponiajs/common";
import type { AnyElysia, Elysia } from "elysia";
import type { CompiledElysiaRoute } from "../routing/route-compiler.types.ts";
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

export interface RegisteredElysiaControllerDefinition<
  TController,
  TDependencies extends readonly Token<unknown>[],
> extends ElysiaControllerDefinition<TController, TDependencies, Elysia> {
  readonly path?: string;
  readonly registerRoutes: (application: Elysia, controller: TController) => void;
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
> {
  readonly inject: TDependencies;
  readonly path?: string;
  readonly registerRoutes: (application: Elysia, controller: TController) => void;
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
  readonly registerRoutes?: (application: Elysia, controller: never) => void;
}
