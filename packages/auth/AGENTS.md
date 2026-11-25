# @aponiajs/auth — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The auth module, JWT service, bearer guard, authorization guards, request user
state, refresh-token rotation, access-token revocation, and password hashing.
It is a leaf: nothing in the framework depends on it.

| Domain                                                      | Owns                                                                  |
| ----------------------------------------------------------- | --------------------------------------------------------------------- |
| `auth.module.ts`, `auth.module-definition.ts`               | `AuthModule.forRoot`, options, and validation                         |
| `jwt.service.ts`                                            | Signing and verification through `jose`                               |
| `auth.guard.ts`, `auth.service.ts`, `claims.ts`             | The bearer guard, request user/session state, and claims              |
| `current-user.decorator.ts`, `authorization.decorator.ts`   | `@CurrentUser()`, `@CurrentSession()`, and role/permission decorators |
| `permissions.guard.ts`                                      | The authorization guard                                               |
| `oidc.service.ts`                                           | Discovery, key-set verification, and OIDC options                     |
| `refresh-token.service.ts`, `memory-refresh-token.store.ts` | Opaque refresh tokens, rotation families, and the built-in store      |
| `revocation.service.ts`, `memory-revocation.store.ts`       | The revoked access-token `jti` set and its built-in store             |
| `password/password-hasher.service.ts`                       | Bun password hashing and verification                                 |
| `auth.constants.ts`                                         | Tokens and defaults the registration and guard read                   |
| `interfaces/`                                               | The auth, OIDC, refresh, revocation, and verifier contracts           |

`src/index.ts` is the only public barrel.

## Invariants

- **The request user lives in the platform request context.** The guard runs in
  a different async context than the handler; private AsyncLocalStorage is not
  enough. `AuthService` reads `RequestContextService`.
- **`AuthModule` imports `RequestContextModule.forRoot()`.** The registration is
  shared per normalized header, so `TenantModule` may import it too. Do not add a
  second request-context header: one `RequestContextService` token cannot
  disambiguate two storages.
- **The registration is a `ConfigurableModuleBuilder` definition with one arm.**
  `MODULE_OPTIONS_TOKEN` is the `AUTH_MODULE_OPTIONS` token, and `isGlobal` and
  `globalGuard` are the definition-shaping extras, both defaulting to true as
  `@nestjs/authentication` does. `globalGuard: true` adds
  `{ provide: APP_GUARD, useValue: AuthGuard }`; `globalGuard: false` leaves the
  guard to each route. `register` remains the deprecated alias.
  `registerAsync` is refused: the `jwt`/`oidc` arm decides which verifier
  provider exists, and a container factory cannot change a provider list.
  Resolve an asynchronous configuration before registering.
- **`@CurrentUser()` and `@CurrentSession()` read the route context.** `AuthGuard`
  writes `user` and a frozen `{ user, token, claims }` session onto the
  `RouteContext`; both decorators answer `null` on a `@Public()` route and
  outside a request. Do not read the request directly in application code.
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

`src/**/*.spec.ts` under Bun, `test/*.conformance.ts` under Vite+. The Bun
lane boots a real application through `AponiaFactory.create`, signs tokens with
`JwtService`, and exercises public, protected, role, permission, and invalid
token paths. Password tests are Bun-only because `Bun.password` is not a Node API.
