import { Injectable, Reflector, type CanActivate, type ExecutionContext } from "@aponiajs/common";
import { httpErrors } from "../errors/http-error.ts";

/**
 * Access control guard verifying role claims extracted via Reflector metadata.
 *
 * Reads `roles` metadata declared on route handlers or controller classes.
 * Also checks `isPublic` metadata to allow unauthenticated public access.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  readonly #reflector: Reflector;

  constructor(reflector: Reflector) {
    this.#reflector = reflector;
  }

  /**
   * Evaluates role authorization for the incoming request context.
   *
   * @param context - The execution context.
   * @returns True if allowed, throws forbidden/unauthorized otherwise.
   */
  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.#reflector.getAllAndOverride<boolean>("isPublic", [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const requiredRoles = this.#reflector.getAllAndOverride<readonly string[]>("roles", [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = (request as unknown as { user?: { roles?: readonly string[] } }).user;

    if (!user || !user.roles || !Array.isArray(user.roles)) {
      throw httpErrors.forbidden("User does not possess required roles.");
    }

    const hasRole = requiredRoles.some((role) => user.roles?.includes(role));
    if (!hasRole) {
      throw httpErrors.forbidden("User does not possess required roles.");
    }

    return true;
  }
}
