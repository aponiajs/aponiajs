import { Inject, Injectable } from "@aponiajs/common";
import { RequestContextService } from "@aponiajs/platform-elysia";
import { AUTH_USER } from "./auth.constants.ts";
import type { AuthUser } from "../module/auth.types.ts";

/** The request-scoped authenticated user. */
@Injectable()
export class AuthService {
  readonly #requestContext: RequestContextService;

  /** @internal Construct through `AuthModule.register`. */
  constructor(@Inject(RequestContextService) requestContext: RequestContextService) {
    this.#requestContext = requestContext;
  }

  /** The user the current request authenticated, if any. */
  current(): AuthUser | undefined {
    return this.#requestContext.current()?.get(AUTH_USER);
  }

  /** @internal Enters the authenticated user into the request context. */
  enter(user: AuthUser): void {
    this.#requestContext.current()?.set(AUTH_USER, user);
  }
}
