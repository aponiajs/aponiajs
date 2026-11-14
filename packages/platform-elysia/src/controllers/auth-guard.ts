import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
  type RouteContext,
} from "@aponiajs/common";
import { httpErrors } from "../errors/http-error.ts";

/**
 * Base guard inspecting Authorization bearer tokens and request credentials.
 *
 * Applications can extend this guard or use it directly by overriding token validation.
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
   * Validates extracted token. Subclasses override this method to verify signatures/claims.
   */
  protected validateToken(token: string, _context: ExecutionContext): boolean | Promise<boolean> {
    return token.length > 0;
  }
}
