# Security Policy

## Supported versions

The **published alpha line** is supported with security fixes on its newest
release (`0.6.0-alpha.39` at the time of writing). Older alpha releases receive
no fixes; upgrade to the newest published release before reporting a problem in
an older one.

The `1.0.0-beta.N` development line in this repository is **not published yet**
and is therefore not a supported distribution channel. It becomes supported when
the beta line is published; until then, a report against it is handled as a
development-branch issue, not as a shipped release.

## Reporting a vulnerability

Report a suspected vulnerability privately through GitHub's private
vulnerability reporting on the repository's Security tab. Do not open a public
issue for an exploitable problem. Include the affected package and version, a
reproduction, and the impact you observed. You will get an acknowledgement and a
status update; a fix ships with a release note that names the package and the
behavior that changed.

## Scope

The framework owns the contracts and the adapters in `packages/`. An application
built with it owns its handlers, its data model, and the stores it supplies.

In scope:

- dependency graph and container behavior that can expose a provider across a
  module boundary;
- route mounting, validation, enhancer ordering, and error mapping;
- authentication, authorization, session, CSRF, CORS, security headers, rate
  limiting, tenancy, idempotency, and WebSocket handshake policies in the
  packages that provide them;
- the SSRF checks, response bounds, and redirect policy of the outbound HTTP
  client;
- the MCP and devtools surfaces, including their default exposure.

Out of scope:

- a store, broker, database, or reverse proxy the application supplies;
- an application's own authorization decisions and data access;
- denial of service that requires unbounded resources the application chose to
  expose without a package limit.

## Security model

The reference points are [`docs/threat-model.md`](docs/threat-model.md) and the
package guides. The short version:

- A provider is visible only where the module graph exports it; the container
  refuses ambiguous resolutions instead of picking one.
- Application failures are RFC 9457 Problem Details without a stack or cause; a
  handler's unexpected exception becomes a `500` reported through the system
  logger.
- Cookies are signed, `HttpOnly`, and `Secure` by default; CSRF uses a signed
  double-submit token; sessions can be regenerated after a privilege change.
- The outbound HTTP client blocks private, loopback, link-local, and metadata
  targets by default and re-validates every redirect.
- Devtools are opt-in and should be disabled in production; the MCP surface is
  read-only unless write or exec capabilities are granted explicitly.
- The built-in stores (sessions, rate limits, cache, refresh tokens,
  revocations, queue backlog, idempotency) are process-local and bounded unless
  the application supplies a shared implementation.

## Dependency and supply-chain policy

Runtime dependencies are kept small and reviewed. CI runs the dependency audit
at high severity for every push and pull request, and the release lane packages
the workspaces from frozen installs. A new runtime dependency needs a maintained
upstream, TypeScript declarations, a compatible license, and a reason the
framework cannot own the behavior itself.

## Hardening checklist for a deployment

1. Disable devtools in production (`enabled: false`).
2. Supply a shared store for sessions, rate limits, refresh tokens,
   revocations, and idempotency when more than one instance runs.
3. Set `origins` on every WebSocket gateway reachable from a browser.
4. Keep `allowPrivateNetworks` off and supply a pinned `fetch` only when a
   deployment needs one.
5. Set a real JWT secret of at least 32 characters and rotate it with
   `keys`/`activeKid`.
6. Terminate TLS in front of the application and keep HSTS enabled once the
   domain is ready.
