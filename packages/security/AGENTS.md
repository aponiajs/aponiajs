# @aponiajs/security — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The security module, the response-header policy, and the signed double-submit
CSRF policy. Both policies are neutral `HttpPolicy` values the shared request
pipeline runs on every platform. It is a leaf: nothing in the framework depends
on it.

| Domain        | Owns                                                                      |
| ------------- | ------------------------------------------------------------------------- |
| `module/`     | `SecurityModule.forRoot`                                                  |
| `policy/`     | header defaults/validation, CSRF token issue/verify, neutral policy build |
| `interfaces/` | the option, header, and CSRF contracts                                    |

`src/index.ts` is the only public barrel. Type-only contracts live in
`interfaces/<name>.interface.ts`.

## Invariants

- **Headers are secure by default.** Do not weaken the CSP, frame denial,
  `nosniff`, no-referrer, HSTS, permissions policy, or cross-origin policies
  without an explicit opt-out.
- **A CSP nonce is per request.** The `{nonce}` placeholder is replaced in the
  request hook and the same value is what `getCspNonce(request)` answers; do not
  reuse a nonce across requests, and do not attach one when the policy states no
  placeholder.
- **A partial header override merges with the defaults.** Setting a field to
  `false` omits it; `headers: false` disables the header policy.
- **CSRF is opt-in.** It is only meaningful for cookie-based sessions; do not
  enable it silently for token-authenticated APIs.
- **The CSRF cookie is readable on purpose.** Double-submit requires the client
  to echo the cookie value. The token is an HMAC-signed nonce; never accept an
  unsigned or mismatched value.
- **Use timing-safe comparison.** The signature is compared with
  `timingSafeEqual`; never compare secrets with `===`.
- **Errors are redacted.** A refusal is a `403` Problem Details answer; do not
  include the token, cookie, secret, or stack.
- **Configuration failures are `AponiaError` with
  `INVALID_SECURITY_OPTIONS`.** Keep the code and the frozen issue list.
- **Both policies are global.** The header policy answers the response phase and
  the CSRF policy runs before routing, so both reach every mounted route and the
  headers also reach a missing route.

## Tests

`src/**/*.spec.ts` under Bun, `test/*.conformance.ts` under Vite+. The Bun
lane boots a real application through `AponiaFactory.create` and drives it via
`application.handle`; it covers default/partial/disabled headers, cookie issue,
accepted and refused CSRF requests, excluded paths, and option refusals.
