import type { RequestMethod } from "../decorators/decorators.types.ts";
import type { RouteContext } from "../routing/route-schema.types.ts";
import type { ClassToken } from "../tokens/token.types.ts";

/**
 * An HTTP route target specified for middleware binding or exclusion.
 */
export type RouteTarget =
  | string
  | ClassToken<unknown>
  | { readonly path: string; readonly method?: RequestMethod };

/**
 * Contract implemented by Aponia middleware classes or objects.
 */
export interface AponiaMiddleware {
  /**
   * Processes the incoming request context ahead of route matching and handler execution.
   *
   * @param context - The incoming route context.
   * @param next - Function to invoke the next middleware or proceed into the request lifecycle.
   * @returns The handler response or a promise resolving to it.
   */
  use(context: RouteContext, next: () => Promise<unknown>): unknown;
}

/**
 * Fluent proxy configuring route target inclusion and exclusion for applied middleware.
 */
export interface MiddlewareConfigProxy {
  /**
   * Excludes specific paths or methods from being processed by the applied middleware.
   *
   * @param routes - Route strings or path/method descriptors to exclude.
   * @returns This config proxy for chaining.
   */
  exclude(
    ...routes: readonly (string | { readonly path: string; readonly method?: RequestMethod })[]
  ): MiddlewareConfigProxy;

  /**
   * Mounts the applied middleware onto the specified route paths, controllers, or route descriptors.
   *
   * @param routes - Controller classes, route strings, or route descriptors to target.
   * @returns The parent middleware consumer to allow chaining further apply calls.
   */
  forRoutes(...routes: readonly RouteTarget[]): MiddlewareConsumer;
}

/**
 * Consumer interface passed into module configure() lifecycle hooks.
 */
export interface MiddlewareConsumer {
  /**
   * Selects one or more middleware classes or instances to configure.
   *
   * @param middleware - The middleware classes or instances to apply.
   * @returns A configuration proxy to specify target and excluded routes.
   */
  apply(
    ...middleware: readonly (ClassToken<AponiaMiddleware> | AponiaMiddleware)[]
  ): MiddlewareConfigProxy;
}

/**
 * Optional lifecycle contract implemented by module classes that configure middleware.
 */
export interface AponiaModule {
  /**
   * Configures route middleware bindings using the supplied consumer.
   *
   * @param consumer - The middleware consumer for declaring route mappings.
   */
  configure?(consumer: MiddlewareConsumer): void;
}
