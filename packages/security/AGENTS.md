# @aponiajs/security — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The security module, the response-header policy, and the signed double-submit
CSRF policy. It is a leaf: nothing in the framework depends on it.

| Domain    | Owns                                                              |
| --------- | ----------------------------------------------------------------- |
| `module/` | `SecurityModule.register`                                         |
| `policy/` | header defaults/validation, CSRF token issue/verify, plugin build |

`src/index.ts` is the only public barrel.

## Invariants

- **Headers are secure by default.** Do not weaken the CSP, frame denial,
  `nosniff`, no-referrer, HSTS, permissions policy, or cross-origin policies
  without an explicit opt-out.
- **A CSP nonce is per request.** The `{nonce}` placeholder is replaced in the
  request hook and the same value is what `getCspNonce(request)` answers; do not
  reuse a nonce across requests, and do not attach one when the policy states no
  placeholder.
- **A partial header override merges with the defaults.** Setting a field to
  `false` omits it; `headers: false` disables the whole plugin.
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
- **The plugin is global.** Headers run from the `request` hook, CSRF from a
  global `beforeHandle`, so both reach every mounted route and headers also
  reach a missing route.

## Tests

`tests/*.test.ts` under Bun, `tests-vp/*.conformance.ts` under Vite+. The Bun
lane boots a real application through `AponiaFactory.create` and drives it via
`application.handle`; it covers default/partial/disabled headers, cookie issue,
accepted and refused CSRF requests, excluded paths, and option refusals.
