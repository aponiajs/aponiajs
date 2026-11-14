# @aponiajs/security

Conservative response headers and signed double-submit CSRF protection for
AponiaJS.

```bash
bun add @aponiajs/security@alpha
```

## Use it

```ts
import { Module } from "@aponiajs/common";
import { SecurityModule } from "@aponiajs/security";

@Module({
  imports: [
    SecurityModule.register({
      csrf: { secret: process.env.CSRF_SECRET! },
    }),
  ],
})
export class AppModule {}
```

`headers` is enabled by default. `csrf` is opt-in because it is only meaningful
for cookie-based sessions.

## Default headers

| Header                         | Default                                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `content-security-policy`      | `default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; form-action 'self'` |
| `x-frame-options`              | `DENY`                                                                                               |
| `x-content-type-options`       | `nosniff`                                                                                            |
| `referrer-policy`              | `no-referrer`                                                                                        |
| `strict-transport-security`    | `max-age=31536000; includeSubDomains`                                                                |
| `permissions-policy`           | `camera=(), microphone=(), geolocation=()`                                                           |
| `cross-origin-opener-policy`   | `same-origin`                                                                                        |
| `cross-origin-resource-policy` | `same-origin`                                                                                        |

Override any field, or set it to `false` to omit it. `headers: false` disables
the header plugin. The headers are applied to matched routes and missing routes.

### CSP nonce

A `{nonce}` placeholder in the CSP is replaced with a fresh per-request nonce,
and the handler reads the same value through `getCspNonce(request)`:

```ts
SecurityModule.register({
  headers: { contentSecurityPolicy: "default-src 'self'; script-src 'nonce-{nonce}'" },
});

@Get()
page(@Req() request: Request) {
  return `<script nonce="${getCspNonce(request)}">…</script>`;
}
```

Without the placeholder the header is sent unchanged and `getCspNonce` answers
`undefined`.

## CSRF

The token is a signed nonce stored in a readable cookie. A safe request without
the cookie receives one; every unsafe request must echo the same value in the
configured header.

```ts
SecurityModule.register({
  csrf: {
    secret: process.env.CSRF_SECRET!,
    cookieName: "aponia.csrf",
    headerName: "x-csrf-token",
    exclude: ["/webhooks/stripe"],
  },
});
```

- The secret must be at least 32 characters.
- The cookie is `HttpOnly: false` because the double-submit token must be read
  by the application's own client.
- `secure` defaults to `true`, `sameSite` defaults to `lax`, and the path
  defaults to `/`.
- `methods` defaults to `POST`, `PUT`, `PATCH`, and `DELETE`.
- An excluded path is skipped entirely.
- A missing, mismatched, or tampered token answers `403` Problem Details.

## Limits

This package implements response headers and CSRF only. It is not an
authentication package, an authorization package, a session store, or a
rate limiter; pair it with `@aponiajs/rate-limit` and the upcoming auth/session
packages.

## Bootstrap

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule);
await application.listen(Number(Bun.env.PORT ?? 3000));
```

## Documentation

- [Published packages](../../docs/packages.md)
- [AponiaJS architecture](../../docs/architecture-and-style.md)
- [npm](https://www.npmjs.com/package/@aponiajs/security)
