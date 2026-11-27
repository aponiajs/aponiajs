import { Injectable } from "../decorators/decorators.ts";
import { type CanActivate, type ExecutionContext } from "../interfaces/enhancer.interface.ts";
import { type RouteContext } from "../interfaces/route-schema.interface.ts";
import { httpErrors } from "../exceptions/http-error.ts";

/**
 * Base guard inspecting Authorization bearer tokens and request credentials.
 *
 * This base guard denies every token until a subclass overrides validation. An
 * application that needs bearer-token authentication uses `@aponiajs/auth`,
 * whose guard verifies a configured JWT or OIDC provider.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  /**
   * Evaluates authentication for the incoming request context.
   *
   * @param context - The execution context.
   * @returns True if authenticated, false or throws if rejected.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = this.getRequest(context);
    const token = this.extractTokenFromHeader(request.request);

    if (!token) {
      throw httpErrors.unauthorized("Authentication token is missing.");
    }

    const isValid = await this.validateToken(token, context);
    if (!isValid) {
      throw httpErrors.unauthorized("Invalid or expired authentication token.");
    }

    return true;
  }

  /**
   * Helper extracting RouteContext from the execution context.
   */
  protected getRequest(context: ExecutionContext): RouteContext {
    return context.switchToHttp().getRequest();
  }

  /**
   * Extracts Bearer token from the standard Authorization header.
   */
  protected extractTokenFromHeader(request: Request): string | undefined {
    const authorization =
      request.headers.get("authorization") ?? request.headers.get("Authorization");
    if (!authorization) {
      return undefined;
    }

    const [scheme, token] = authorization.split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !token) {
      return undefined;
    }

    return token;
  }

  /**
   * Validates an extracted token. Subclasses override this method to verify
   * signatures and claims. The default refuses every token.
   */
  protected validateToken(token: string, _context: ExecutionContext): boolean | Promise<boolean> {
    void token;
    return false;
  }
}
