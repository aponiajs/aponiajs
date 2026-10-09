import type { EdenRouteSet, InferredEdenRoutes, RouteDefinition } from "./route-eden.types.ts";

/**
 * Defines a set of routes associated with a path prefix for Eden Treaty.
 *
 * Schemas can be provided inline (TypeBox, Zod, etc.) or as separated DTO classes
 * (using `createDto` or `@Validation`). DTO classes require no route paths and
 * remain pure data models.
 *
 * @param prefix - The base path prefix for the controller or feature (e.g. "users").
 * @param routes - The declared route list with methods, paths, and schemas.
 * @returns A frozen route set carrying the inferred Eden Treaty `~routes` type.
 *
 * @example
 * ```ts
 * export const userRoutes = defineRoutes("users", [
 *   { method: "GET", path: ":id", schema: { response: UserDto } },
 *   { method: "POST", path: "", schema: { body: CreateUserDto, response: UserDto } },
 * ] as const);
 *
 * export const app = await AponiaFactory.createNative(AppModule);
 * export type App = WithEdenRoutes<typeof app, typeof userRoutes>;
 * ```
 */
export function defineRoutes<
  const TPrefix extends string,
  const TRoutes extends readonly RouteDefinition[],
>(prefix: TPrefix, routes: TRoutes): EdenRouteSet<TPrefix, TRoutes> {
  return Object.freeze({
    prefix,
    routes: Object.freeze([...routes]) as unknown as TRoutes,
  }) as EdenRouteSet<TPrefix, TRoutes>;
}

/**
 * Creates a type-level contract helper for controllers.
 *
 * @returns A phantom type marker that can be implemented or checked by controllers.
 */
export function createEdenContract<
  const TPrefix extends string,
  const TRoutes extends readonly RouteDefinition[],
>(): InferredEdenRoutes<TPrefix, TRoutes> {
  return {} as InferredEdenRoutes<TPrefix, TRoutes>;
}
