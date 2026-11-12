# Authentication and Authorization

`@aponiajs/auth` adds bearer JWT authentication, role and permission guards,
request-scoped current user, refresh-token rotation, access-token revocation,
and Bun-native password hashing.

```ts
AuthModule.register({ jwt: { secret: process.env.JWT_SECRET! } });
```

```ts
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

`Roles()` requires at least one named role; `Permissions()` requires every named
permission. `Public()` bypasses authentication. `AuthGuard` stores the verified
user in the request context, so `AuthService.current()` works in handlers.

`JwtService` verifies with the configured secret, issuer, audience, and
algorithm list. A missing, invalid, or expired token answers `401`; a missing
role or permission answers `403` Problem Details. `PasswordService` hashes and
verifies through `Bun.password`.

## OpenID Connect

```ts
AuthModule.register({
  oidc: {
    issuer: "https://login.example.com",
    audience: "my-api",
    algorithms: ["RS256", "ES256"],
  },
});
```

`OidcService` reads `<issuer>/.well-known/openid-configuration`, requires the
document to name the configured issuer, and verifies tokens against the
provider's published key set. The document and the key set are cached until
`clear()`. A relocation, a non-JSON body, a different issuer, or a missing
`jwks_uri` fails with `OIDC_DISCOVERY_FAILED`; a token that fails verification
answers `401` like a local secret would. A registration states exactly one of
`jwt` or `oidc`.

## Token transport

`AuthGuard` reads `Authorization: Bearer <token>` by default. An application that
keeps the access token in an `HttpOnly` cookie can name it:

```ts
AuthModule.register({
  jwt: { secret: process.env.JWT_SECRET! },
  token: { cookieName: "aponia.at" },
});
```

The header still wins when both are present, and `scheme` changes the
`Authorization` scheme (`Token`, for example). A cookie transport carries the
request's credentials automatically, so unsafe requests need the CSRF policy
from `@aponiajs/security`; `SameSite` alone is not a substitute.

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

`sign()` uses the active key and writes its `kid` into the token header.
`verify()` accepts a token signed by any listed key, and a token with no `kid`
is tried against the default `secret` and then each rotation key. A token that
names a `kid` the list does not hold is refused with `401`, so removing an old
key from the list retires every token it signed. The default `secret` stays
required: it is what a token minted before rotation was signed with.

## Refresh tokens

```ts
AuthModule.register({
  jwt: { secret: process.env.JWT_SECRET! },
  refresh: { ttlMs: 30 * 24 * 60 * 60 * 1_000, maxTokens: 10_000 },
  revocation: { maxEntries: 10_000 },
});
```

`RefreshTokenService` issues opaque refresh tokens and stores only their
SHA-256 digest. Rotating a token consumes it and issues a replacement in the
same rotation family, so replaying a used token answers `INVALID_REFRESH_TOKEN`
and revokes the whole family (OAuth reuse detection). `revoke(token)` removes
one token and `revokeFamily(familyId)` removes every token descended from one
login.

Consumption is atomic when the store implements the optional
`consume(idHash)` operation; the built-in memory and Redis stores do. A custom
store without it falls back to `find` + `delete`, which still lets exactly one
concurrent rotation win but cannot detect reuse after the record is gone.

`RevocationService.isRevoked(jti)` is checked by `AuthGuard` for any verified
access token that carries a `jti` claim. Revoke one with
`revocation.revoke(jti, expiresAt)`: the entry is dropped once that expiry
passes.

`JwtService.sign()` mints a `jti` when the caller did not supply a non-empty
string, so a token the framework issued can be revoked. A caller-supplied `jti`
is preserved. A token minted elsewhere without a `jti` is accepted but cannot be
revocation-checked; if the application requires revocation for every token, mint
tokens through `JwtService` or reject tokens without a `jti` in its own verifier.

Both defaults are process-local and bounded. A multi-instance deployment passes
its own store instead:

```ts
AuthModule.register({
  jwt: { secret: process.env.JWT_SECRET! },
  refresh: { store: sharedRefreshStore },
  revocation: { store: sharedRevocationStore },
});
```

A supplied store implements the same contract the built-in one does
(`RefreshTokenStore` or `RevocationStore`), and an incomplete store fails the
registration with `INVALID_AUTH_OPTIONS` rather than at the first request.
`maxTokens` and `maxEntries` describe the built-in stores only.

The package is a foundation: distributed revocation and distributed refresh
stores are later layers, and the built-in stores stay process-local until then.

See the [package README](../packages/auth/README.md) for the full contract.
