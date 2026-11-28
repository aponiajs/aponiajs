# @aponiajs/http — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The outbound HTTP client, the module, the SSRF policy, and their contracts. It
is a leaf: nothing in the framework depends on it.

| Domain                                                        | Owns                                                                                         |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `http-client.service.ts`, `http-client.providers.ts`          | `HttpService` (exported as `HttpClient`), the interceptor chain, and providers               |
| `http.module.ts`, `http.module-definition.ts`                 | `HttpModule.forRoot`/`register`, the builder definitions, the options tokens, and validation |
| `inject-http-client.decorator.ts`, `http-client.constants.ts` | `@InjectHttpClient` and the root and per-client tokens                                       |
| `security/`                                                   | URL policy, DNS address checks, and error redaction                                          |
| `interfaces/`                                                 | The client and service contracts                                                             |

`src/index.ts` is the only public barrel. The module mirrors
`@nestjs/http-client`: `forRoot`/`forRootAsync` register app-wide defaults and
**no client**; `register`/`registerAsync` create one client each, under
`HttpClient` or the `HttpClient:<name>` token `getHttpClientToken(name)`
returns. `HTTP_CLIENT_MODULE_OPTIONS` is the root token,
`MODULE_OPTIONS_TOKEN` the per-client token, and `isGlobal` is the
definition-shaping extra on a client. An interceptor is a class, an instance,
or a function; a class is resolved from the container when provided and
constructed with no dependencies otherwise.

## Invariants

- **Secure by default.** Only `http:` and `https:` are allowed; credentials in
  a URL are refused; `Host` cannot be supplied; private, loopback, link-local,
  metadata, carrier-grade NAT, multicast, and reserved addresses are blocked.
  The IPv6 translation ranges `rfc6052` and `rfc6145` and the deprecated
  IPv4-compatible form are blocked as well.
- **Every hostname is resolved and every address checked.** Do not replace the
  resolver check with a hostname string check alone. The default resolver uses
  the runtime's DNS lookup; a test supplies its own. The validated address is
  pinned for the connection with the original `Host` and TLS SNI
  (`pinResolvedAddress`, default on), so the runtime cannot resolve the hostname
  a second time to a private address.
- **Every redirect is re-validated.** A redirect with a request body is refused
  rather than replayed. The `error` and `manual` policies are explicit.
- **Responses are bounded and errors are redacted.** The timeout covers the
  body read, not only the headers. Never include a response body, query string,
  or credentials in an `AponiaError` detail. Use `safeUrl`.
- **Retries are idempotent, or keyed.** `GET`, `HEAD`, `OPTIONS`, `PUT`, and
  `DELETE` may retry; `POST` and `PATCH` retry only when the request states an
  `idempotencyKey`, which is also sent as the header. `Retry-After` on a
  retryable answer replaces the exponential delay, capped at 30 seconds. Never
  add a retry that replays a body without a key.
- **`allowPrivateNetworks` is an explicit opt-out.** It must stay off by default
  and must be documented as unsafe for user-supplied URLs.
- **Every client follows the SSRF policy, and root defaults merge per client.**
  A named client validates its URL, addresses, redirects, and response bound
  exactly as the default does. Root headers merge key by key under the client's
  own; a client's option wins on every other field.
- **An interceptor sees the validated request, not a bypass.** The chain wraps
  the same SSRF-safe send, so an interceptor may adjust headers or the URL but
  cannot skip address validation or the response bound.
- **The fetch and resolver are injectable.** Tests and adapters supply them;
  the package does not reach the network in its own test lanes.

## Tests

`src/**/*.spec.ts` under Bun, `test/*.conformance.ts` under Vite+. Both lanes
use an injected fetch and resolver, so no case reaches the network. The Bun lane
covers blocked URLs, private addresses, redirects, size limits, timeouts,
retries, Standard Schema validation, and option refusals.
