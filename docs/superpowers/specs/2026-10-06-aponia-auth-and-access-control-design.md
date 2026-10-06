# Aponia Auth & Access Control System — Design Specification

## Overview

This specification introduces comprehensive authentication and authorization foundations to AponiaJS:

1. **Metadata & Custom Decorators (`SetMetadata`, `Reflector`, `createParamDecorator`)** in `@aponiajs/common`:
   - Enables ergonomic parameter extraction from `RouteContext` (e.g. `@CurrentUser()`, `@Token()`).
   - Enables route/controller level metadata annotation (e.g. `@Roles("admin")`, `@Public()`).
   - Provides `Reflector` service to inspect metadata on handlers and controller classes across execution context.
2. **Access Control Primitives (`AuthGuard`, `RolesGuard`)** in `@aponiajs/platform-elysia`:
   - `AuthGuard`: Abstract / base authentication guard inspecting request credentials or bearer tokens.
   - `RolesGuard`: Role-based access control guard reading roles defined via `SetMetadata` / `@Roles()`.

---

## 1. Contracts in `@aponiajs/common`

### Custom Parameter Decorators (`createParamDecorator`)

```ts
export type CustomParamFactory<TData = unknown, TOutput = unknown> = (
  data: TData | undefined,
  context: RouteContext,
) => TOutput;

export function createParamDecorator<TData = unknown, TOutput = unknown>(
  factory: CustomParamFactory<TData, TOutput>,
): (data?: TData, ...pipes: readonly PipeType[]) => ParameterDecorator;
```

**Example:**

```ts
export const CurrentUser = createParamDecorator<string | undefined, unknown>((data, ctx) => {
  const user = (ctx as any).user;
  return data ? user?.[data] : user;
});

@Get("me")
getMe(@CurrentUser() user: User, @CurrentUser("email") email: string) {
  return { user, email };
}
```

### Route Metadata & Reflector (`SetMetadata`, `Reflector`)

```ts
export function SetMetadata<K = string, V = unknown>(key: K, value: V): CustomDecorator;

@Injectable()
export class Reflector {
  get<T = unknown>(key: unknown, target: object | ClassToken<unknown>): T | undefined;
  getAllAndOverride<T = unknown>(
    key: unknown,
    targets: readonly (object | ClassToken<unknown>)[],
  ): T | undefined;
  getAllAndMerge<T extends unknown[] = unknown[]>(
    key: unknown,
    targets: readonly (object | ClassToken<unknown>)[],
  ): T;
}
```

**Convenience Decorators:**

```ts
export const Roles = (...roles: readonly string[]) => SetMetadata("roles", roles);
export const Public = () => SetMetadata("isPublic", true);
```

---

## 2. Platform Guards in `@aponiajs/platform-elysia`

### `AuthGuard`

Base guard checking authentication headers or bearer tokens with customizable extraction:

```ts
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean | Promise<boolean>;
  protected getRequest(context: ExecutionContext): RouteContext;
  protected extractTokenFromHeader(request: Request): string | undefined;
}
```

### `RolesGuard`

Guard leveraging `Reflector` to verify authorized roles:

```ts
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean;
}
```

---

## 3. Invariants & Performance

1. `createParamDecorator` stores parameter metadata using `kind: "custom"` and records the factory function.
2. `route-compiler.ts` executes custom parameter factories ahead of parameter pipes, feeding factory output into pipes.
3. Zero overhead for standard route parameter mappings.
4. All descriptors and metadata remain frozen and immutable.
