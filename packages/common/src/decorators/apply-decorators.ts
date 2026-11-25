import type { RouteMethodDecorator } from "../interfaces/decorators.interface.ts";

/** Every decorator shape this package and its platforms expose. */
type ComposableDecorator =
  | ClassDecorator
  | MethodDecorator
  | PropertyDecorator
  | RouteMethodDecorator;

/**
 * Composes several decorators into one, applied in declaration order.
 *
 * Mirrors Nest's `applyDecorators`. This workspace uses `experimentalDecorators`,
 * so every composable decorator is a function: the composed decorator applies a
 * member as a class decorator when it is used on a class, as a property
 * decorator when it decorates a field, and as a method decorator otherwise.
 *
 * @param decorators - The decorators to apply, in declaration order.
 * @returns One decorator that applies every member.
 *
 * @example
 * ```ts
 * const Roles = (...roles: string[]) => SetMetadata("roles", roles);
 *
 * @Controller("reports")
 * class ReportsController {
 *   @applyDecorators(Get("daily"), Roles("admin"))
 *   daily() {}
 * }
 * ```
 */
export function applyDecorators(
  ...decorators: readonly ComposableDecorator[]
): ClassDecorator & MethodDecorator & PropertyDecorator {
  return ((
    target: object,
    propertyKey?: string | symbol,
    descriptor?: TypedPropertyDescriptor<unknown>,
  ): void => {
    for (const decorator of decorators) {
      if (propertyKey === undefined) {
        (decorator as ClassDecorator)(target as unknown as Function);
      } else if (descriptor === undefined) {
        (decorator as PropertyDecorator)(target, propertyKey);
      } else {
        (decorator as unknown as MethodDecorator)(target, propertyKey, descriptor);
      }
    }
  }) as ClassDecorator & MethodDecorator & PropertyDecorator;
}
