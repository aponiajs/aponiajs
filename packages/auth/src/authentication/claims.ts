import type { AuthUser } from "../module/auth.types.ts";

/** Lowers verified JWT claims into the frozen user a request carries. */
export function mapVerifiedClaims(payload: Record<string, unknown>): AuthUser {
  const id =
    typeof payload.sub === "string" || typeof payload.sub === "number"
      ? payload.sub
      : typeof payload.id === "string" || typeof payload.id === "number"
        ? payload.id
        : undefined;
  const roles = stringArray(payload.roles);
  const permissions = stringArray(payload.permissions);
  return Object.freeze({
    ...payload,
    ...(id === undefined ? {} : { id }),
    ...(roles === undefined ? {} : { roles }),
    ...(permissions === undefined ? {} : { permissions }),
  });
}

function stringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? Object.freeze([...value])
    : undefined;
}
