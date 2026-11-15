# @aponiajs/http — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The outbound HTTP client, the module, the SSRF policy, and their contracts. It
is a leaf: nothing in the framework depends on it.

| Domain      | Owns                                                           |
| ----------- | -------------------------------------------------------------- |
| `client/`   | `HttpService`, request options, response, and resolved options |
| `module/`   | `HttpModule.register`, the options token, and validation       |
| `security/` | URL policy, DNS address checks, and error redaction            |

`src/index.ts` is the only public barrel.

## Invariants

- **Secure by default.** Only `http:` and `https:` are allowed; credentials in
  a URL are refused; `Host` cannot be supplied; private, loopback, link-local,
  metadata, carrier-grade NAT, multicast, and reserved addresses are blocked.
- **Every hostname is resolved and every address checked.** Do not replace the
  resolver check with a hostname string check alone. The default resolver uses
  the runtime's DNS lookup; a test supplies its own. The validated address is
  pinned for the connection with the original `Host` and TLS SNI
  (`pinResolvedAddress`, default on), so the runtime cannot resolve the hostname
  a second time to a private address.
- **Every redirect is re-validated.** A redirect with a request body is refused
  rather than replayed. The `error` and `manual` policies are explicit.
- **Responses are bounded and errors are redacted.** Never include a response
  body, query string, or credentials in an `AponiaError` detail. Use `safeUrl`.
- **Retries are idempotent, or keyed.** `GET`, `HEAD`, `OPTIONS`, `PUT`, and
  `DELETE` may retry; `POST` and `PATCH` retry only when the request states an
  `idempotencyKey`, which is also sent as the header. `Retry-After` on a
  retryable answer replaces the exponential delay, capped at 30 seconds. Never
  add a retry that replays a body without a key.
- **`allowPrivateNetworks` is an explicit opt-out.** It must stay off by default
  and must be documented as unsafe for user-supplied URLs.
- **The fetch and resolver are injectable.** Tests and adapters supply them;
  the package does not reach the network in its own test lanes.

## Tests

`tests/*.test.ts` under Bun, `tests-vp/*.conformance.ts` under Vite+. Both lanes
use an injected fetch and resolver, so no case reaches the network. The Bun lane
covers blocked URLs, private addresses, redirects, size limits, timeouts,
retries, Standard Schema validation, and option refusals.
