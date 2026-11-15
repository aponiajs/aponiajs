# @aponiajs/auth

JWT authentication, role and permission guards, refresh-token rotation,
access-token revocation, and Bun-native password hashing for AponiaJS.

```bash
bun add @aponiajs/auth@alpha
```

## Use it

```ts
import { Module } from "@aponiajs/common";
import { AuthModule } from "@aponiajs/auth";

@Module({
  imports: [AuthModule.register({ jwt: { secret: process.env.JWT_SECRET! } })],
})
export class AppModule {}
```

```ts
import { Controller, Get, UseGuards } from "@aponiajs/common";
import {
  AuthGuard,
  AuthService,
  Permissions,
  Public,
  Roles,
  RolesGuard,
  PermissionsGuard,
} from "@aponiajs/auth";

@Controller("users")
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Get("health")
  health() {
    return "ok";
  }

  @Roles("admin")
  @Permissions("users:read")
  @Get()
  list() {
    return { userId: this.auth.current()?.id };
  }
}
```

## What it provides

- `JwtService` verifies HS256 tokens with issuer, audience, and algorithm checks, and signs test or service tokens.
- `AuthGuard` extracts the bearer token, verifies it, and stores the user in the request context.
- `AuthService.current()` reads the authenticated user inside handlers.
- `Roles()` requires at least one named role; `Permissions()` requires every named permission.
- `Public()` bypasses authentication for a route or controller.
- `PasswordService` uses `Bun.password.hash` and `Bun.password.verify`.
- `RefreshTokenService` issues, rotates, and revokes opaque refresh tokens; only a SHA-256 digest is stored.
- `RevocationService` records revoked access-token `jti` claims until their expiry, and `AuthGuard` checks them.

## Token transport

`AuthGuard` reads `Authorization: Bearer <token>`. A cookie transport is opted
in with `token: { cookieName: "aponia.at" }`; the header still wins when both are
present, and `token.scheme` renames the authorization scheme. A cookie token
needs CSRF protection on unsafe requests — pair it with `@aponiajs/security`.

## Key rotation

```ts
AuthModule.register({
  jwt: {
    secret: process.env.JWT_SECRET!,
    keys: [
      { kid: "2026-01", secret: process.env.JWT_SECRET_OLD! },
      { kid: "2026-06", secret: process.env.JWT_SECRET! },
    ],
    activeKid: "2026-06",
  },
});
```

Tokens are signed with the active key and carry its `kid`. Verification accepts
any listed key, and a token with no `kid` is tried against the default secret and
each rotation key, so an old secret stops working only when its key leaves the
list.

## Refresh tokens and revocation

```ts
AuthModule.register({
  jwt: { secret: process.env.JWT_SECRET! },
  refresh: { ttlMs: 30 * 24 * 60 * 60 * 1_000, maxTokens: 10_000 },
  revocation: { maxEntries: 10_000 },
});
```

```ts
import { Injectable } from "@aponiajs/common";
import { RefreshTokenService, RevocationService } from "@aponiajs/auth";

@Injectable()
class Sessions {
  constructor(
    private readonly refresh: RefreshTokenService,
    private readonly revocation: RevocationService,
  ) {}

  async rotate(userId: string, jti: string, expiresAt: number): Promise<string> {
    const issued = await this.refresh.issue(userId);
    const rotated = await this.refresh.rotate(issued.token); // the old token is consumed
    await this.refresh.revokeFamily(rotated.familyId); // sign the family out
    await this.revocation.revoke(jti, expiresAt); // reject one access token
    return rotated.token;
  }
}
```

## OpenID Connect

```ts
AuthModule.register({ oidc: { issuer: "https://login.example.com", audience: "my-api" } });
```

`OidcService` reads the provider's discovery document, pins the configured
issuer, and verifies tokens against the published key set. The document and key
set are cached; `clear()` re-reads them. A registration states exactly one of
`jwt` or `oidc`.

Rotation keeps the family id, so a replayed token is refused with
`INVALID_REFRESH_TOKEN`. `MemoryRefreshTokenStore` and `MemoryRevocationStore`
are bounded and process-local, including the tombstones reuse detection keeps;
an application that runs more than one instance supplies a store that shares
state:

```ts
AuthModule.register({
  jwt: { secret: process.env.JWT_SECRET! },
  refresh: { store: sharedRefreshStore },
  revocation: { store: sharedRevocationStore },
});
```

A store that does not implement its contract fails the registration with
`INVALID_AUTH_OPTIONS`.

## Security defaults

- The JWT secret must be at least 32 characters.
- A missing, invalid, or expired token answers `401`.
- A missing role or permission answers `403` Problem Details.
- The package mounts no route, reads no environment variable, and stores no secret outside the registration.
- `RolesGuard` and `PermissionsGuard` run after `AuthGuard`; declare them in that order.
- A rotated refresh token cannot be used twice; a reused token revokes its whole family, and revoking a family invalidates every descendant.
- `JwtService.sign()` mints a `jti` when none is supplied; a token minted elsewhere without one is accepted but not revocation-checked.

## Limits

This foundation covers bearer JWTs, role/permission checks, refresh rotation,
single-instance revocation, OIDC discovery, and password hashing. Distributed
revocation and distributed refresh stores are later layers.

## Bootstrap

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule);
await application.listen(Number(Bun.env.PORT ?? 3000));
```

## Documentation

- [Agent surface](../../docs/agent/README.md)
- [Published packages](../../docs/packages.md)
- [npm](https://www.npmjs.com/package/@aponiajs/auth)
