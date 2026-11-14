import {
  Inject,
  Injectable,
  Reflector,
  type CanActivate,
  type ExecutionContext,
  type RouteContext,
} from "@aponiajs/common";
import { httpErrors } from "@aponiajs/platform-elysia";
import { AuthService } from "./auth.service.ts";
import { AUTH_TOKEN_OPTIONS, AUTH_VERIFIER } from "./auth.constants.ts";
import type { AuthVerifier } from "./token-verifier.types.ts";
import type { AuthUser, ResolvedAuthTokenOptions } from "../module/auth.types.ts";
import { RevocationService } from "../revocation/revocation.service.ts";

/** Verifies a bearer JWT and enters the user into the request context. */
@Injectable()
export class AuthGuard implements CanActivate {
  readonly #verifier: AuthVerifier;
  readonly #auth: AuthService;
  readonly #reflector: Reflector;
  readonly #revocation: RevocationService;
  readonly #tokenOptions: ResolvedAuthTokenOptions;

  constructor(
    @Inject(AUTH_VERIFIER) verifier: AuthVerifier,
    @Inject(AUTH_TOKEN_OPTIONS) tokenOptions: ResolvedAuthTokenOptions,
    @Inject(AuthService) auth: AuthService,
    @Inject(Reflector) reflector: Reflector,
    @Inject(RevocationService) revocation: RevocationService,
  ) {
    this.#verifier = verifier;
    this.#tokenOptions = tokenOptions;
    this.#auth = auth;
    this.#reflector = reflector;
    this.#revocation = revocation;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const isPublic = this.#reflector.getAllAndOverride<boolean>("isPublic", [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const token = readToken(request.request, this.#tokenOptions);
    if (token === undefined) {
      throw httpErrors.unauthorized("Authentication token is missing.");
    }

    let user: AuthUser;
    try {
      user = await this.#verifier.verify(token);
    } catch {
      throw httpErrors.unauthorized("Invalid or expired authentication token.");
    }

    const jti = typeof user.jti === "string" ? user.jti : undefined;
    if (jti !== undefined && (await this.#revocation.isRevoked(jti))) {
      throw httpErrors.unauthorized("Authentication token has been revoked.");
    }
    this.#auth.enter(user);
    (request as RouteContext & { user?: AuthUser }).user = user;
    return true;
  }
}

function readToken(request: Request, options: ResolvedAuthTokenOptions): string | undefined {
  const authorization = request.headers.get("authorization");
  if (authorization !== null) {
    const [scheme, token] = authorization.split(" ");
    if (scheme?.toLowerCase() === options.scheme.toLowerCase() && token) {
      return token;
    }
  }
  if (options.cookieName === undefined) {
    return undefined;
  }
  const cookie = request.headers.get("cookie");
  if (cookie === null) {
    return undefined;
  }
  for (const entry of cookie.split(";")) {
    const [name, ...rest] = entry.trim().split("=");
    if (name === options.cookieName) {
      const value = rest.join("=");
      if (value === "") {
        return undefined;
      }
      try {
        return decodeURIComponent(value);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
