import { createParamDecorator, type RouteContext } from "@aponiajs/common";
import type { AuthSession, AuthUser } from "./interfaces/auth.interface.ts";

/**
 * The authenticated user for the current request, or `null`.
 *
 * Mirrors `@nestjs/authentication`'s `@CurrentUser()`: the optional key picks
 * one claim. `AuthGuard` writes the value onto the route context, so a handler
 * decorated with `@Public()` reads `null` rather than throwing.
 *
 * @param key - One claim to read; omitted means the whole user.
 * @returns The parameter decorator.
 */
export const CurrentUser = createParamDecorator<string | undefined, AuthUser | null>(
  (key, context: RouteContext) => {
    const user = (context as RouteContext & { readonly user?: AuthUser }).user ?? null;
    return key !== undefined && user !== null ? (user[key] as AuthUser) : user;
  },
);

/**
 * The session the current request authenticated with, or `null`.
 *
 * Mirrors `@nestjs/authentication`'s `@CurrentSession()`: the value carries the
 * user, the opaque token, and its verified claims.
 *
 * @returns The parameter decorator.
 */
export const CurrentSession = createParamDecorator<unknown, AuthSession | null>(
  (_data, context: RouteContext) =>
    (context as RouteContext & { readonly session?: AuthSession }).session ?? null,
);
