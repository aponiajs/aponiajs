# Threat Model

This page records what the framework defends against, where each defense lives,
and what it deliberately leaves to the application. It is the internal half of
the external security review: a reviewer can trace every claim to code and tests.

## Trust boundaries

- **Client to application.** Untrusted HTTP and WebSocket input crosses here.
  Validation, authentication, tenancy, rate limiting, idempotency, CSRF, CORS,
  and security headers are the controls.
- **Application to dependency.** The container resolves providers; a module sees
  only what its imports export.
- **Application to outbound service.** The HTTP client crosses here with SSRF
  checks, timeouts, response bounds, and redirect re-validation.
- **Application to operator surfaces.** Devtools and MCP expose compiled state;
  both are opt-in.
- **Process to shared state.** Stores are process-local by default; a deployment
  replaces them with shared implementations.

## Threats and controls

| Threat                                       | Control                                                                                                 | Where                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Forged or expired access token               | Signature, issuer, audience, and algorithm checks; unknown `kid` refused                                | [`auth`](../packages/auth/AGENTS.md)                   |
| Refresh-token replay                         | Rotation consumes the old token; a replayed token is refused; families can be revoked                   | [`auth`](../packages/auth/AGENTS.md)                   |
| Session fixation                             | `SessionService.regenerate` deletes the old id before issuing a new one                                 | [`session`](../packages/session/AGENTS.md)             |
| Cross-site request forgery                   | Signed double-submit cookie token, unsafe methods only, explicit exclusions                             | [`security`](../packages/security/AGENTS.md)           |
| Cross-site WebSocket hijacking               | `origins` allowlist on the handshake, refused before upgrade                                            | [`websockets.md`](./websockets.md)                     |
| Credential or tenant leakage across tenants  | Tenant bound to a verified principal or resolver; header is opt-in selection, never authorization       | [`tenancy`](../packages/tenancy/AGENTS.md)             |
| Duplicate side effects from retried requests | `Idempotency-Key` replay, body fingerprint, atomic store claim, and caller/tenant scope                 | [`idempotency`](../packages/idempotency/AGENTS.md)     |
| Request floods and brute force               | Fixed-window rate limiting with standard headers and `Retry-After`                                      | [`rate-limit`](../packages/rate-limit/AGENTS.md)       |
| SSRF through user-supplied URLs              | Scheme, credential, hostname, and address checks; validated address pinned; every redirect re-validated | [`http`](../packages/http/AGENTS.md)                   |
| Oversized responses                          | Bounded response body read with a hard limit                                                            | [`http`](../packages/http/AGENTS.md)                   |
| Leaked internals in errors                   | Problem Details without stack or cause; unexpected failures become `500`                                | [`errors`](./learn/10-errors.md)                       |
| Ambiguous dependency resolution              | Graph compile rejects duplicates, cycles, unexported tokens, and ambiguity                              | [`dependency-injection.md`](./dependency-injection.md) |
| Unauthorized devtools access                 | Opt-in registration, disabled in production by configuration                                            | [`devtools.md`](./devtools.md)                         |
| Agent tools that mutate a project            | MCP is read-only by default; write and exec need explicit flags                                         | [`mcp.md`](./mcp.md)                                   |
| Cache stampede                               | `wrap` shares one factory run per key                                                                   | [`cache`](../packages/cache/AGENTS.md)                 |

## Residual risks

- **Version negotiation is a path rewrite at the fetch boundary.** Header and
  media-type strategies rewrite a request to the version's `/vN` mount before
  routing, so those versions stay reachable by URI as well. A version no
  handler declared answers `400`; a route mounted outside the version prefix,
  and every unversioned route, is forwarded untouched. OpenAPI and inspection
  still name the versioned paths.
- **Built-in stores are process-local.** Sessions, rate limits, cache, refresh
  tokens, revocations, the queue backlog, and idempotency do not share state
  between processes. A multi-instance deployment must supply shared stores.
- **The queue is not a broker.** A durable store keeps a backlog across a
  restart, but nothing claims a job, so one consumer owns one backlog.
- **Rate limiting is a fixed window.** A burst at a window boundary can exceed
  the intended average; the bound is per window, not a token bucket.
- **Password policy is the application's.** `PasswordService` hashes and
  verifies; it does not enforce length, breach checks, or rotation.
- **No WAF or proxy hardening is bundled.** Headers, CORS, and limits are
  application-level controls; a deployment still owns its edge.
- **A message transport authenticates nobody.** `@aponiajs/microservices`
  validates the envelope, target, and reply allowlist, and can bound in-flight
  work, but it does not identify a caller or validate a handler's payload. A
  service exposed beyond a trusted network must authenticate the producer and
  authorize the pattern before dispatch.
- **A gateway, not the adapter, authenticates a serverless call.**
  `@aponiajs/serverless` translates the API Gateway or Web Fetch envelope into
  the application's own request; authorizer policy, CORS, and timeouts stay at
  the gateway or in the application.
- **The dependency audit is advisory at high severity.** A vulnerability below
  that threshold or one disclosed after a release is not automatically blocked.

## Review checklist

1. Confirm every public route has an authentication decision and, where it
   carries tenant data, a tenancy decision.
2. Confirm WebSocket gateways that a browser reaches declare `origins`.
3. Confirm devtools are disabled in production and MCP capabilities are granted
   deliberately.
4. Confirm stores are shared where more than one instance serves traffic.
5. Confirm outbound URLs are not user-controlled without the client's SSRF
   policy, and that `allowPrivateNetworks` stays off.
6. Confirm secrets are at least 32 characters and rotated with `keys`.
7. Confirm an idempotency key is required on money-moving or otherwise
   non-repeatable mutations.
