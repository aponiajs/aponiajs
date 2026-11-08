import { SetMetadata } from "@aponiajs/common";

/** Requires at least one of the named roles. */
export function Roles(...roles: string[]): ClassDecorator & MethodDecorator {
  return SetMetadata("roles", Object.freeze([...roles]));
}

/** Requires every named permission. */
export function Permissions(...permissions: string[]): ClassDecorator & MethodDecorator {
  return SetMetadata("permissions", Object.freeze([...permissions]));
}

/** Allows a route without authentication. */
export function Public(): ClassDecorator & MethodDecorator {
  return SetMetadata("isPublic", true);
}
