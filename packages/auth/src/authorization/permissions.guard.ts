import {
  Inject,
  Injectable,
  Reflector,
  type CanActivate,
  type ExecutionContext,
  type RouteContext,
} from "@aponiajs/common";
import { httpErrors } from "@aponiajs/platform-elysia";
import type { AuthUser } from "../module/auth.types.ts";

/** Requires every permission a route declares. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  readonly #reflector: Reflector;

  constructor(@Inject(Reflector) reflector: Reflector) {
    this.#reflector = reflector;
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.#reflector.getAllAndOverride<boolean>("isPublic", [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const required = this.#reflector.getAllAndOverride<readonly string[]>("permissions", [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required === undefined || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest() as RouteContext & { user?: AuthUser };
    const granted = request.user?.permissions;
    if (!Array.isArray(granted) || !required.every((permission) => granted.includes(permission))) {
      throw httpErrors.forbidden("User does not possess the required permissions.");
    }
    return true;
  }
}
