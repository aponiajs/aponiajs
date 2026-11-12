# @aponiajs/auth — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The auth module, JWT service, bearer guard, authorization guards, request user
state, refresh-token rotation, access-token revocation, and password hashing.
It is a leaf: nothing in the framework depends on it.

| Domain            | Owns                                                  |
| ----------------- | ----------------------------------------------------- |
| `module/`         | `AuthModule.register`, options, and validation        |
| `jwt/`            | Signing and verification through `jose`               |
| `authentication/` | Bearer guard, current user, and request-context token |
| `authorization/`  | Role/permission decorators and guards                 |
| `password/`       | Bun password hashing and verification                 |
| `oidc/`           | Discovery, key-set verification, and OIDC options     |
| `refresh/`        | Opaque refresh tokens, rotation families, stores      |
| `revocation/`     | Revoked access-token `jti` set and store              |

`src/index.ts` is the only public barrel.

## Invariants

- **The request user lives in the platform request context.** The guard runs in
  a different async context than the handler; private AsyncLocalStorage is not
  enough. `AuthService` reads `RequestContextService`.
- **`AuthModule` imports `RequestContextModule.forRoot()`.** The registration is
  shared per normalized header, so `TenantModule` may import it too. Do not add a
  second request-context header: one `RequestContextService` token cannot
  disambiguate two storages.
- **Tokens are verified with issuer/audience/algorithm checks.** A token that
  names a `kid` is verified only with that key; a token with no `kid` is tried
  against the default secret and then every rotation key. Never accept a
  token by decoding it without verification.
- **`401` is authentication, `403` is authorization.** Keep the distinction.
- **The header wins over the cookie.** `token.cookieName` is an opt-in
  transport for an HttpOnly token; a cookie-authenticated unsafe request needs
  CSRF protection, so do not present it as a replacement for `@aponiajs/security`.
- **The JWT secret is at least 32 characters.** Configuration failures are
  `INVALID_AUTH_OPTIONS`; token failures are `INVALID_AUTH_TOKEN` internally and
  `401` Problem Details at the boundary.
- **Password hashing uses Bun.** Never implement a password KDF by hand.
- **Refresh tokens are opaque and digest-stored.** Never persist the raw token;
  rotation consumes the old token before issuing the replacement, and a reused
  token is `INVALID_REFRESH_TOKEN` and revokes its whole family. The built-in
  stores implement `consume` atomically; a custom store without it falls back to
  `find` + `delete`, which lets one rotation win but cannot detect reuse after
  the record is gone.
- **Revocation is checked before the user enters the request context.**
  `AuthGuard` verifies the signature, then the `jti` set, then calls
  `AuthService.enter`. `JwtService.sign()` mints a `jti` when the caller did not
  supply a non-empty string and preserves one that is supplied, so a
  framework-issued token is revocable; a foreign token without a `jti` is
  accepted but not revocation-checked.
- **The built-in stores are process-local and bounded.** Distributed state needs
  a store supplied through `refresh.store` or `revocation.store`; validate its
  shape at registration so a missing method fails the boot, and keep the cap
  options documented as belonging to the built-in stores only. The refresh
  store's consumed-token tombstones share its record cap: without it, one client
  rotating a token in a loop grows the process without bound and makes every
  store operation scan an ever-larger map. An evicted tombstone weakens reuse
  detection for that old token only, and the token is already gone.

## Tests

`tests/*.test.ts` under Bun, `tests-vp/*.conformance.ts` under Vite+. The Bun
lane boots a real application through `AponiaFactory.create`, signs tokens with
`JwtService`, and exercises public, protected, role, permission, and invalid
token paths. Password tests are Bun-only because `Bun.password` is not a Node API.
